/**
 * electron/igdbClient.js
 *
 * Klient IGDB API (https://api.igdb.com) — pobieranie okładek gier,
 * screenshotów, opisów i metadanych.
 *
 * IGDB wymaga rejestracji aplikacji na Twitch Developer Console.
 * Dane uwierzytelniające ustaw w zmiennych środowiskowych lub electron-store:
 *   IGDB_CLIENT_ID     = twój client_id z Twitch
 *   IGDB_CLIENT_SECRET = twój client_secret z Twitch
 *
 * Token OAuth jest cachowany w electron-store i odświeżany automatycznie.
 */

const axios = require('axios')

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/token'
const IGDB_BASE_URL   = 'https://api.igdb.com/v4'
const IMAGE_BASE      = 'https://images.igdb.com/igdb/image/upload'

// Image size variants
const IMG_SIZE = {
  thumb:   't_thumb',           // 90x128
  cover:   't_cover_big',       // 264x374
  hero:    't_1080p',           // 1920x1080
  screenshot: 't_screenshot_big' // 889x500
}

class IGDBClient {
  constructor(store) {
    this.store       = store     // electron-store instance
    this.clientId     = process.env.IGDB_CLIENT_ID     || store.get('igdb.clientId',     '')
    this.clientSecret = process.env.IGDB_CLIENT_SECRET || store.get('igdb.clientSecret', '')
    this._token      = null
    this._tokenExpiry = 0
  }

  // ── OAuth token ────────────────────────────────────────────────────────────
  async _getToken() {
    const now = Date.now() / 1000
    if (this._token && now < this._tokenExpiry - 60) return this._token

    // Try cache
    const cached = this.store.get('igdb.token')
    if (cached && cached.expiry > now + 60) {
      this._token       = cached.access_token
      this._tokenExpiry = cached.expiry
      return this._token
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Brak konfiguracji IGDB. Ustaw IGDB_CLIENT_ID i IGDB_CLIENT_SECRET.')
    }

    const { data } = await axios.post(TWITCH_AUTH_URL, null, {
      params: {
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        grant_type:    'client_credentials',
      },
      timeout: 8000,
    })

    this._token       = data.access_token
    this._tokenExpiry = now + data.expires_in
    this.store.set('igdb.token', { access_token: this._token, expiry: this._tokenExpiry })
    return this._token
  }

  // ── Raw IGDB query ─────────────────────────────────────────────────────────
  async _query(endpoint, body) {
    const token = await this._getToken()
    const { data } = await axios.post(`${IGDB_BASE_URL}/${endpoint}`, body, {
      headers: {
        'Client-ID':    this.clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      timeout: 10000,
    })
    return data
  }

  // ── Build image URL from hash ─────────────────────────────────────────────
  imageUrl(imageId, size = 'cover') {
    if (!imageId) return null
    return `${IMAGE_BASE}/${IMG_SIZE[size] || IMG_SIZE.cover}/${imageId}.jpg`
  }

  // ── Search for a game ──────────────────────────────────────────────────────
  async searchGame(title) {
    const results = await this._query('games', `
      search "${title}";
      fields name, cover.image_id, summary, rating, first_release_date,
             genres.name, screenshots.image_id, involved_companies.company.name;
      where version_parent = null;
      limit 5;
    `)
    return results
  }

  // ── Get cover URL for a game title ────────────────────────────────────────
  async getCoverUrl(title, size = 'cover') {
    try {
      const results = await this.searchGame(title)
      if (!results || results.length === 0) return null
      const game = results[0]
      if (!game.cover?.image_id) return null
      return this.imageUrl(game.cover.image_id, size)
    } catch (e) {
      console.warn(`[IGDB] getCoverUrl failed for "${title}":`, e.message)
      return null
    }
  }

  // ── Get full metadata for a game ──────────────────────────────────────────
  async getGameMetadata(title) {
    try {
      const results = await this.searchGame(title)
      if (!results || results.length === 0) return null
      const g = results[0]
      return {
        igdbId:      g.id,
        title:       g.name,
        coverUrl:    g.cover ? this.imageUrl(g.cover.image_id, 'cover') : null,
        heroUrl:     g.screenshots?.[0] ? this.imageUrl(g.screenshots[0].image_id, 'hero') : null,
        screenshots: (g.screenshots || []).slice(0, 8).map(s => this.imageUrl(s.image_id, 'screenshot')),
        description: g.summary || null,
        rating:      g.rating ? Math.round(g.rating) / 10 : null,
        releaseYear: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
        genres:      (g.genres || []).map(gen => gen.name),
        developer:   g.involved_companies?.[0]?.company?.name || null,
      }
    } catch (e) {
      console.warn(`[IGDB] getGameMetadata failed for "${title}":`, e.message)
      return null
    }
  }

  // ── Batch enrich games in DB with IGDB data ───────────────────────────────
  async enrichDatabase(db, limit = 20) {
    const games = db.prepare(
      'SELECT id, title FROM games WHERE cover_url IS NULL LIMIT ?'
    ).all(limit)

    const updateStmt = db.prepare(`
      UPDATE games
      SET cover_url = ?, description = COALESCE(description, ?), rating = COALESCE(NULLIF(rating,0), ?)
      WHERE id = ?
    `)

    let enriched = 0
    for (const game of games) {
      try {
        const meta = await this.getGameMetadata(game.title)
        if (meta) {
          updateStmt.run(meta.coverUrl, meta.description, meta.rating, game.id)
          enriched++
          // Rate limit: IGDB allows 4 req/sec
          await new Promise(r => setTimeout(r, 260))
        }
      } catch (e) {
        console.warn(`[IGDB] enrich failed for ${game.title}:`, e.message)
      }
    }
    return enriched
  }

  // ── Register IPC handlers ─────────────────────────────────────────────────
  register(ipcMain, db) {
    ipcMain.handle('igdb:getCover', async (_, { title, size }) => {
      try {
        const url = await this.getCoverUrl(title, size || 'cover')
        return { success: true, url }
      } catch (e) {
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('igdb:getMetadata', async (_, { title }) => {
      try {
        const meta = await this.getGameMetadata(title)
        return { success: true, meta }
      } catch (e) {
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('igdb:enrichAll', async () => {
      try {
        const count = await this.enrichDatabase(db)
        return { success: true, enriched: count }
      } catch (e) {
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('igdb:setCredentials', async (_, { clientId, clientSecret }) => {
      this.clientId     = clientId
      this.clientSecret = clientSecret
      this.store.set('igdb.clientId',     clientId)
      this.store.set('igdb.clientSecret', clientSecret)
      // Clear cached token
      this._token       = null
      this._tokenExpiry = 0
      this.store.delete('igdb.token')
      return { success: true }
    })

    ipcMain.handle('igdb:hasCredentials', async () => {
      return { has: !!(this.clientId && this.clientSecret) }
    })
  }
}

module.exports = IGDBClient

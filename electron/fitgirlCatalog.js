/**
 * electron/fitgirlCatalog.js
 *
 * Obsługuje 3 widoki:
 *  1. popular  — https://fitgirl-repacks.site/pop-repacks/
 *  2. top150   — https://fitgirl-repacks.site/top-repack/
 *  3. all      — https://fitgirl-repacks.site/all-my-repacks-a-z/ (paginacja lcp_page0)
 */

const axios   = require('axios')
const cheerio = require('cheerio')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

const VIEWS = {
  popular: { url: 'https://fitgirl-repacks.site/pop-repacks/',              label: 'Pop Repacks' },
  top150:  { url: 'https://fitgirl-repacks.site/popular-repacks-of-the-year/', label: 'Top 150'     },
  all:     { url: 'https://fitgirl-repacks.site/all-my-repacks-a-z/',          label: 'Wszystkie'   },
}

const PAGE_URL = (n) => `${VIEWS.all.url}?lcp_page0=${n}#lcp_instance_0`

function urlToSlug(url) {
  const m = url.replace(/\/$/, '').match(/\/([^/?#]+)$/)
  return m ? m[1] : null
}

// Parsuj listę gier z dowolnej strony FitGirl (A-Z, Popular, Top150)
function parseGameLinks(html) {
  const $ = cheerio.load(html)
  const games = []
  const seen  = new Set()

  // Szukaj linków w kilku możliwych kontenerach
  const selectors = [
    '#lcp_instance_0 a',
    '.lcp_catlist a',
    '.entry-content a[href*="fitgirl-repacks.site"]',
  ]

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const href  = ($(el).attr('href') || '').split('?')[0].split('#')[0].replace(/\/$/, '')
      const title = $(el).text().trim()
      if (!title || title.length < 2 || !href) return
      if (!href.includes('fitgirl-repacks.site')) return
      if (href.includes('/category/') || href.includes('/tag/') ||
          href.includes('/page/') || href.includes('/author/')) return
      const slug = urlToSlug(href)
      if (!slug || slug.length < 3 || seen.has(slug)) return
      seen.add(slug)
      games.push({ title, url: href + '/', slug })
    })
    if (games.length > 0) break
  }

  // Znajdź maxPage z paginatora lcp
  let maxPage = 1
  $('.lcp_paginator a, .lcp_paginator span').each((_, el) => {
    const href = $(el).attr('href') || ''
    const m = href.match(/lcp_page0=(\d+)/)
    if (m) { const n = parseInt(m[1]); if (n > maxPage) maxPage = n }
    const num = parseInt($(el).text().trim())
    if (!isNaN(num) && num > maxPage) maxPage = num
  })

  return { games, maxPage }
}

class FitGirlCatalog {
  constructor(db) {
    this.db = db
    this._initTable()
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fg_catalog (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        source    TEXT NOT NULL DEFAULT 'fitgirl',
        slug      TEXT NOT NULL,
        title     TEXT NOT NULL,
        url       TEXT NOT NULL,
        cover_url TEXT,
        synced_at INTEGER DEFAULT (strftime('%s','now')),
        UNIQUE(source, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_fg_title  ON fg_catalog(title);
      CREATE INDEX IF NOT EXISTS idx_fg_source ON fg_catalog(source);
    `)
  }

  // ── Pobierz listę gier ze strony popular/top150 (galeria obrazków) ─────────
  // Strona ma obrazki-linki: <a href="URL_GRY"><img src="okładka"></a>
  async fetchSinglePage(viewKey) {
    const view = VIEWS[viewKey]
    if (!view) return []

    const allGames = []
    const seen = new Set()

    try {
      console.log(`[Catalog] Pobieranie ${viewKey}: ${view.url}`)
      const { data } = await axios.get(view.url, { headers: HEADERS, timeout: 20000 })
      const $ = cheerio.load(data)

      // Galeria — linki zawierające obrazki prowadzące do stron gier
      // Struktura: <a href="https://fitgirl-repacks.site/gra/"><img src="okładka" alt="Tytuł"></a>
      $('a[href*="fitgirl-repacks.site"] img, .entry-content a img, article a img, .gallery a img').each((_, el) => {
        const a    = $(el).parent('a')
        const href = (a.attr('href') || '').split('?')[0].split('#')[0].replace(/\/$/, '') + '/'
        const slug = urlToSlug(href)

        // Tytuł z alt obrazka lub z tytułu linka
        let title = $(el).attr('alt') || $(el).attr('title') || a.attr('title') || ''
        title = title.trim()

        // Jeśli brak tytułu — wygeneruj ze sluga
        if (!title && slug) {
          title = slug.replace(/-fitgirl-repack.*/i,'').replace(/-/g,' ')
            .replace(/\b\w/g, c => c.toUpperCase()).trim()
        }

        if (!slug || seen.has(slug)) return
        if (!href.includes('fitgirl-repacks.site')) return
        if (href.includes('/category/') || href.includes('/tag/') ||
            href.includes('/page/') || href.includes('/wp-content/')) return
        if (slug.length < 3) return

        // Pobierz też URL obrazka jako okładkę
        const coverUrl = $(el).attr('src') || $(el).attr('data-src') || null

        seen.add(slug)
        allGames.push({ title, url: href, slug, cover_url: coverUrl })
      })

      // Fallback — jeśli galeria nie zadziałała, szukaj linków z tytułami
      if (allGames.length === 0) {
        console.log(`[Catalog] Galeria pusta — próbuję linki tekstowe`)
        $('a[href*="fitgirl-repacks.site"]').each((_, el) => {
          const href  = ($(el).attr('href') || '').split('?')[0].split('#')[0].replace(/\/$/, '') + '/'
          const title = $(el).text().trim()
          const slug  = urlToSlug(href)
          if (!title || title.length < 3 || !slug || seen.has(slug)) return
          if (href.includes('/category/') || href.includes('/tag/') || href.includes('/page/')) return
          if (!href.includes('fitgirl-repacks.site')) return
          seen.add(slug)
          allGames.push({ title, url: href, slug, cover_url: null })
        })
      }

      console.log(`[Catalog] ${viewKey} łącznie: ${allGames.length} gier`)
    } catch (e) {
      console.warn(`[Catalog] Błąd ${viewKey}:`, e.message)
    }

    return allGames
  }

  // ── Synchronizacja ────────────────────────────────────────────────────────
  async syncCatalog(source = 'fitgirl', onProgress) {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO fg_catalog (source, slug, title, url) VALUES (?, ?, ?, ?)'
    )
    let totalAdded = 0

    try {
      // Strona 1 — A-Z
      const { data: html1 } = await axios.get(PAGE_URL(1), { headers: HEADERS, timeout: 30000 })
      const { games: games1, maxPage } = parseGameLinks(html1)
      console.log(`[Catalog] Strona 1: ${games1.length} | Stron łącznie: ${maxPage}`)

      this.db.transaction(g => { for (const x of g) insert.run(source, x.slug, x.title, x.url) })(games1)
      totalAdded += games1.length
      if (onProgress) onProgress({ page: 1, maxPage, added: totalAdded })

      for (let page = 2; page <= maxPage; page++) {
        try {
          const { data } = await axios.get(PAGE_URL(page), { headers: HEADERS, timeout: 20000 })
          const { games } = parseGameLinks(data)
          this.db.transaction(g => { for (const x of g) insert.run(source, x.slug, x.title, x.url) })(games)
          totalAdded += games.length
          console.log(`[Catalog] Strona ${page}/${maxPage}: +${games.length}`)
          if (onProgress) onProgress({ page, maxPage, added: totalAdded })
          await new Promise(r => setTimeout(r, 350))
        } catch (e) {
          console.warn(`[Catalog] Błąd strony ${page}:`, e.message)
        }
      }

      const total = this.db.prepare('SELECT COUNT(*) as c FROM fg_catalog WHERE source=?').get(source).c
      return { success: true, added: totalAdded, total }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  // ── Wyszukiwanie ──────────────────────────────────────────────────────────
  search(query, source = 'fitgirl', limit = 100) {
    if (!query || !query.trim()) {
      return this.db.prepare(
        'SELECT * FROM fg_catalog WHERE source=? ORDER BY title ASC LIMIT ?'
      ).all(source, limit)
    }
    const words = query.trim().split(/\s+/).filter(w => w.length >= 1)
    const cond  = words.map(() => 'LOWER(title) LIKE ?').join(' AND ')
    return this.db.prepare(
      `SELECT * FROM fg_catalog WHERE ${cond} AND source=? ORDER BY title ASC LIMIT ?`
    ).all(...words.map(w => `%${w.toLowerCase()}%`), source, limit)
  }

  // ── Strona gry ────────────────────────────────────────────────────────────
  async getGamePage(url) {
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 })
      const $ = cheerio.load(data)
      const magnets = []
      $('a[href^="magnet:"]').each((_, el) => {
        const m = $(el).attr('href')
        if (m && !magnets.includes(m)) magnets.push(m)
      })
      let coverUrl = null
      $('.entry-content img').each((_, el) => {
        if (coverUrl) return
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || ''
        if (!src.startsWith('http')) return
        const w = parseInt($(el).attr('width') || '999')
        const h = parseInt($(el).attr('height') || '999')
        if (w < 150 || h < 150) return
        const s = src.toLowerCase()
        if (s.includes('avatar') || s.includes('emoji') || s.includes('icon') ||
            s.includes('qr') || s.includes('bitcoin') || s.includes('banner') || s.includes('logo')) return
        if (!src.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) return
        coverUrl = src
      })
      let description = ''
      $('.entry-content p').each((_, el) => {
        if (description.length > 400) return
        const t = $(el).text().trim()
        if (t.length > 50 && !t.toLowerCase().includes('magnet') &&
            !t.toLowerCase().includes('repack') && !t.toLowerCase().includes('fitgirl')) {
          description += t + ' '
        }
      })
      return { success: true, magnets, coverUrl, description: description.trim().slice(0, 600) || null }
    } catch (e) {
      return { success: false, magnets: [], coverUrl: null, error: e.message }
    }
  }

  async fetchCover(slug, source, url) {
    const row = this.db.prepare('SELECT cover_url FROM fg_catalog WHERE slug=? AND source=?').get(slug, source)
    if (row?.cover_url) return row.cover_url
    const page = await this.getGamePage(url)
    if (page.coverUrl) {
      this.db.prepare('UPDATE fg_catalog SET cover_url=? WHERE slug=? AND source=?').run(page.coverUrl, slug, source)
      return page.coverUrl
    }
    return null
  }

  stats(source) {
    if (source) {
      const row = this.db.prepare('SELECT COUNT(*) as c, MAX(synced_at) as last FROM fg_catalog WHERE source=?').get(source)
      return { count: row.c, lastSync: row.last, source }
    }
    return this.db.prepare('SELECT source, COUNT(*) as c, MAX(synced_at) as last FROM fg_catalog GROUP BY source').all()
  }

  clear(source) {
    this.db.prepare('DELETE FROM fg_catalog WHERE source=?').run(source)
    return { success: true }
  }

  register(ipcMain, win) {
    const emit = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d) }
    ipcMain.handle('fg:sync',        async (_, d={}) => this.syncCatalog(d.source||'fitgirl', p => emit('fg:sync:progress', p)))
    ipcMain.handle('fg:search',      async (_, d={}) => this.search(d.query||'', d.source||'fitgirl', d.limit||100))
    ipcMain.handle('fg:stats',       async (_, d={}) => this.stats(d.source))
    ipcMain.handle('fg:getPage',     async (_, d)    => this.getGamePage(d.url))
    ipcMain.handle('fg:fetchCover',  async (_, d)    => this.fetchCover(d.slug, d.source||'fitgirl', d.url))
    ipcMain.handle('fg:clear',       async (_, d={}) => this.clear(d.source||'fitgirl'))
    // Pobierz listę popular/top150 bezpośrednio (bez zapisywania do DB)
    ipcMain.handle('fg:fetchView',   async (_, { view }) => this.fetchSinglePage(view))
  }
}

module.exports = FitGirlCatalog

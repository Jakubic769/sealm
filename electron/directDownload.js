/**
 * electron/directDownload.js
 *
 * Pobiera gry przez bezpośrednie linki HTTP z FitGirl
 * (DataNodes, FuckingFast, MultiUpload) zamiast torrenta.
 * Działa za każdym NAT/CGNAT bez żadnej konfiguracji.
 */

const axios   = require('axios')
const cheerio = require('cheerio')
const path    = require('path')
const fs      = require('fs')
const https   = require('https')
const http    = require('http')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
  'Accept-Language': 'en-US,en;q=0.9',
}

class DirectDownloadManager {
  constructor(win, db) {
    this.win    = win
    this.db     = db
    this.active = new Map()  // downloadId → { request, interval }
  }

  _log(msg) {
    console.log('[DirectDL]', msg)
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send('torrent:log', String(msg))
  }

  _emit(ch, d) {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send(ch, d)
  }

  // ── Pobierz linki bezpośrednie ze strony gry ──────────────────────────────
  async scrapeDirectLinks(gameUrl) {
    this._log(`Scraping linków bezpośrednich z: ${gameUrl}`)
    try {
      const { data } = await axios.get(gameUrl, { headers: HEADERS, timeout: 15000 })
      const $ = cheerio.load(data)

      const links = []

      // FitGirl używa "Click to show direct links" — linki są w ukrytych divach
      // lub bezpośrednio w treści jako linki do hosterów
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || ''
        const text  = $(el).text().trim()

        // Szukaj linków do popularnych hosterów
        const hosters = [
          'datanodes.to', 'fuckingfast.co', 'buzzheavier.com',
          'gofile.io', '1fichier.com', 'nitroflare.com',
          'rapidgator.net', 'pixeldrain.com', 'uploadhaven.com',
          'multiup.io', 'send.cm', 'ddownload.com'
        ]

        if (hosters.some(h => href.includes(h))) {
          links.push({ url: href, hoster: href.split('/')[2], text })
          this._log(`Znaleziono link: ${href.split('/')[2]} → ${href.slice(0,60)}`)
        }
      })

      return links
    } catch(e) {
      this._log(`Scraping error: ${e.message}`)
      return []
    }
  }

  // ── Pobierz plik przez HTTP ───────────────────────────────────────────────
  async downloadFile(url, destFolder, filename, downloadId, onProgress) {
    return new Promise((resolve, reject) => {
      const filePath = path.join(destFolder, filename)
      const file = fs.createWriteStream(filePath)

      const protocol = url.startsWith('https') ? https : http

      const req = protocol.get(url, { headers: HEADERS }, res => {
        // Obsłuż redirect
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          fs.unlink(filePath, () => {})
          return this.downloadFile(res.headers.location, destFolder, filename, downloadId, onProgress)
            .then(resolve).catch(reject)
        }

        if (res.statusCode !== 200) {
          file.close()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        const total     = parseInt(res.headers['content-length'] || '0')
        let downloaded  = 0
        let lastTime    = Date.now()
        let lastBytes   = 0

        res.on('data', chunk => {
          downloaded += chunk.length
          const now      = Date.now()
          const elapsed  = (now - lastTime) / 1000
          const speed    = elapsed > 0 ? (downloaded - lastBytes) / elapsed : 0
          lastTime  = now
          lastBytes = downloaded

          const progress = total > 0 ? Math.round(downloaded / total * 1000) / 10 : 0
          const etaSec   = speed > 0 && total > 0 ? Math.round((total - downloaded) / speed) : null

          if (onProgress) onProgress({ progress, speedKbps: Math.round(speed/1024), etaSec, downloaded, total })
        })

        res.pipe(file)

        file.on('finish', () => {
          file.close()
          resolve(filePath)
        })
      })

      req.on('error', e => {
        file.close()
        fs.unlink(filePath, () => {})
        reject(e)
      })

      // Zapisz request żeby móc anulować
      this.active.get(downloadId).request = req
    })
  }

  // ── Główna metoda ─────────────────────────────────────────────────────────
  async add({ downloadId, gameUrl, savePath, gameTitle }) {
    this._log(`\n=== DIRECT DOWNLOAD ===\nGra: ${gameTitle}\nFolder: ${savePath}`)

    if (!gameUrl)  return { success: false, error: 'Brak URL strony gry' }
    if (!savePath) return { success: false, error: 'Select folder' }

    try { fs.mkdirSync(savePath, { recursive: true }) } catch {}

    this.active.set(downloadId, { request: null })
    this._updateStatus(downloadId, 'downloading', 0)

    // Pobierz linki bezpośrednie
    const links = await this.scrapeDirectLinks(gameUrl)

    if (links.length === 0) {
      this._log('Brak linków bezpośrednich — FitGirl wymaga przejścia przez stronę')
      this._updateStatus(downloadId, 'error', 0)
      this._emit('torrent:error', { downloadId,
        error: 'Brak linków bezpośrednich. Użyj linku magnet lub pobierz przez przeglądarkę.' })
      return { success: false, error: 'Brak linków bezpośrednich' }
    }

    this._log(`Znaleziono ${links.length} linków bezpośrednich`)
    this._emit('torrent:metadata', { downloadId,
      name: gameTitle,
      links: links.map(l => ({ hoster: l.hoster, url: l.url }))
    })

    // Pobierz pierwszy dostępny plik (część 1)
    const firstLink = links[0]
    const filename  = firstLink.url.split('/').pop() || `${gameTitle.replace(/[^a-z0-9]/gi, '_')}.part1.rar`

    this._log(`Pobieranie: ${firstLink.url}`)

    try {
      const filePath = await this.downloadFile(
        firstLink.url, savePath, filename, downloadId,
        ({ progress, speedKbps, etaSec }) => {
          this._emit('torrent:progress', { downloadId, progress, speedKbps, etaSec, peers: 1 })
          this._updateProgress(downloadId, progress, speedKbps, etaSec)
        }
      )

      this._log(`✅ Downloaded: ${filePath}`)
      this._updateStatus(downloadId, 'completed', 100)
      this._emit('torrent:done', { downloadId, savePath, gameTitle })
      this.active.delete(downloadId)

      // Otwórz folder z plikami
      const { shell } = require('electron')
      await shell.openPath(savePath)

      return { success: true, mode: 'direct', links: links.length }
    } catch(e) {
      this._log(`Download error: ${e.message}`)
      this._updateStatus(downloadId, 'error', 0)
      this._emit('torrent:error', { downloadId, error: e.message })
      this.active.delete(downloadId)
      return { success: false, error: e.message }
    }
  }

  remove(downloadId) {
    const e = this.active.get(downloadId)
    if (e?.request) e.request.destroy()
    this.active.delete(downloadId)
    return { success: true }
  }

  _updateStatus(id, s, p) {
    try { this.db.prepare('UPDATE downloads SET status=?,progress=? WHERE id=?').run(s,p,id) } catch {}
  }
  _updateProgress(id, p, s, e) {
    try { this.db.prepare('UPDATE downloads SET progress=?,speed_kbps=?,eta_seconds=? WHERE id=?').run(p,s,e,id) } catch {}
  }
}

module.exports = DirectDownloadManager

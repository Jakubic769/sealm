/**
 * electron/torrentManager.js
 * WebTorrent w main process — jedyne pewne rozwiązanie w .asar
 */

const path = require('path')
const fs   = require('fs')

const TRACKERS = [
  'udp://130.162.100.98:1337/announce',
  'udp://161.97.67.210:80/announce',
  'udp://207.241.226.186:6969/announce',
  'udp://207.241.224.124:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://acxx.de:6969/announce',
  'udp://black.tracker.group:6969/announce',
  'udp://bt1.archive.org:6969/announce',
  'udp://bt2.archive.org:6969/announce',
  'https://tracker.gbitt.info/announce',
  'https://opentracker.i2p.rocks/announce',
  'https://tracker.nanoha.org/announce',
  'http://tracker.bt4g.com:2095/announce',
  'http://open.acgnxtracker.com/announce',
]

const DHT_BOOTSTRAP = [
  '87.98.162.88:6881',
  'dht.transmissionbt.com:6881',
  'dht.libtorrent.org:25401',
  'router.bittorrent.com:6881',
  'router.utorrent.com:6881',
]

class TorrentManager {
  constructor(win, db) {
    this.win    = win
    this.db     = db
    this.client = null
    this.active = new Map()
    this._initPromise = null
  }

  _log(msg) {
    console.log('[Torrent]', msg)
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send('torrent:log', String(msg))
  }

  _emit(ch, d) {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send(ch, d)
  }

  async _init() {
    if (this.client)       return this.client
    if (this._initPromise) return this._initPromise

    this._initPromise = (async () => {
      this._log('Inicjalizacja WebTorrent...')
      try {
        const wtModule   = await import('webtorrent')
        const WebTorrent = wtModule.default || wtModule
        this._log(`WebTorrent ${WebTorrent.VERSION} | WEBRTC: ${WebTorrent.WEBRTC_SUPPORT}`)

        this.client = new WebTorrent({
          maxConns:    500,
          uploadLimit: 0,
          dht:         { bootstrap: DHT_BOOTSTRAP },
          utp:         true,
          lsd:         true,
          natUpnp:     true,
          natPmp:      true,
          // WebRTC z STUN serwerami — przebija NAT bez port forwarding
          tracker: {
            rtcConfig: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                { urls: 'stun:stun.cloudflare.com:3478' },
                // TURN serwery — relay gdy STUN nie wystarczy (symetryczny NAT)
                {
                  urls: 'turn:openrelay.metered.ca:80',
                  username: 'openrelayproject',
                  credential: 'openrelayproject'
                },
                {
                  urls: 'turn:openrelay.metered.ca:443',
                  username: 'openrelayproject',
                  credential: 'openrelayproject'
                },
                {
                  urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                  username: 'openrelayproject',
                  credential: 'openrelayproject'
                },
              ]
            }
          }
        })

        this.client.on('listening', () => {
          this._log(`Port: ${this.client.torrentPort} | UPnP aktywny`)
        })

        this.client.on('error', e => this._log(`client error: ${e.message}`))

        await new Promise(r => {
          const t = setTimeout(r, 8000)
          this.client.dht?.once('ready', () => { clearTimeout(t); r() })
          if (!this.client.dht) { clearTimeout(t); r() }
        })

        const n = this.client.dht?.toJSON?.()?.nodes?.length || 0
        this._log(`✅ Gotowy | DHT: ${n} nodes`)
        return this.client
      } catch(e) {
        this._log(`❌ init: ${e.message}`)
        this._initPromise = null
        return null
      }
    })()

    return this._initPromise
  }

  async add({ downloadId, magnetUri, savePath, gameTitle }) {
    this._log(`\n=== POBIERANIE ===\nGra: ${gameTitle}\nFolder: ${savePath}`)

    if (!magnetUri) return { success: false, error: 'Brak linku magnet' }
    if (!savePath)  return { success: false, error: 'Select folder' }
    if (this.active.has(downloadId)) return { success: false, error: 'Already active' }

    try { fs.mkdirSync(savePath, { recursive: true }) } catch {}

    const client = await this._init()
    if (!client) return this._fallback(downloadId, magnetUri, gameTitle)

    this._updateStatus(downloadId, 'downloading', 0)

    let mag = magnetUri
    for (const tr of TRACKERS) {
      const e = encodeURIComponent(tr)
      if (!mag.includes(e)) mag += `&tr=${e}`
    }

    try {
      const torrent = client.add(mag, { path: savePath, announce: TRACKERS })
      const entry   = { torrent, interval: null }
      this.active.set(downloadId, entry)

      torrent.on('infoHash', () => {
        this._log(`InfoHash: ${torrent.infoHash}`)
        this._emit('torrent:infoHash', { downloadId, infoHash: torrent.infoHash })

        // Ręcznie szukaj peerów przez DHT i dodawaj je bezpośrednio
        if (client.dht) {
          this._log('DHT lookup dla: ' + torrent.infoHash)
          client.dht.lookup(torrent.infoHash, (err, n) => {
            this._log(`DHT lookup zakończony: ${err ? err.message : 'OK'} | znaleziono ${n || 0} nodes`)
          })
          client.dht.on('peer', (peer, infoHash, from) => {
            if (infoHash.toString('hex') !== torrent.infoHash) return
            const addr = `${peer.host}:${peer.port}`
            this._log(`DHT peer znaleziony: ${addr}`)
            try { torrent.addPeer(addr) } catch {}
          })
        }
      })

      torrent.on('metadata', () => {
        this._log(`📦 ${torrent.name} | ${Math.round((torrent.length||0)/1024/1024)}MB`)
        this._emit('torrent:metadata', { downloadId, name: torrent.name, size: torrent.length })
      })

      torrent.on('wire', wire => {
        this._log(`🔗 Peer: ${wire.remoteAddress} | ${torrent.numPeers} łącznie`)
        this._emit('torrent:peer', { downloadId, address: wire.remoteAddress, totalPeers: torrent.numPeers })
      })

      torrent.on('warning', w => {
        const m = String(w?.message || w)
        if (!m.includes('timed out') && !m.includes('ENOTFOUND') &&
            !m.includes('fetch failed') && !m.includes('EAI_AGAIN') &&
            !m.includes('Non-200') && !m.includes('ECONNREFUSED'))
          this._log(`warning: ${m}`)
      })

      entry.interval = setInterval(() => {
        if (!torrent.client) { clearInterval(entry.interval); return }
        const progress  = Math.round(torrent.progress * 1000) / 10
        const speedKbps = Math.round(torrent.downloadSpeed / 1024)
        const etaSec    = torrent.timeRemaining ? Math.round(torrent.timeRemaining / 1000) : null
        this._emit('torrent:progress', { downloadId, progress, speedKbps, etaSec, peers: torrent.numPeers })
        this._updateProgress(downloadId, progress, speedKbps, etaSec)
      }, 2000)

      setTimeout(() => {
        if (!this.active.has(downloadId)) return
        const n = this.client?.dht?.toJSON?.()?.nodes?.length || 0
        this._log(`[20s] peers=${torrent.numPeers} dht=${n}`)
        if (torrent.numPeers === 0)
          this._emit('torrent:warning', { downloadId, warning: `Brak peerów po 20s. DHT: ${n} nodes.` })
      }, 20000)

      torrent.on('done', () => {
        clearInterval(entry.interval)
        this._log(`✅ Downloaded: ${torrent.name}`)
        this._updateStatus(downloadId, 'installing', 100)
        this._emit('torrent:done', { downloadId, savePath, gameTitle, name: torrent.name })
        torrent.destroy()
        this.active.delete(downloadId)
        this._launchSetup(savePath, downloadId, gameTitle)
      })

      torrent.on('error', e => {
        clearInterval(entry.interval)
        this._log(`❌ ${e.message}`)
        this._updateStatus(downloadId, 'error', 0)
        this._emit('torrent:error', { downloadId, error: e.message })
        this.active.delete(downloadId)
      })

      return { success: true, mode: 'webtorrent' }
    } catch(e) {
      this._log(`add error: ${e.message}`)
      return { success: false, error: e.message }
    }
  }

  async _fallback(downloadId, magnetUri, gameTitle) {
    const { shell } = require('electron')
    this._log('Fallback: klient systemowy')
    try {
      await shell.openExternal(magnetUri)
      this._updateStatus(downloadId, 'downloading', 0)
      return { success: true, mode: 'system' }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  async _launchSetup(dest, downloadId, gameTitle) {
    const { shell } = require('electron')
    try {
      const hits = this._findFiles(dest, 'setup.exe')
      if (hits.length) {
        this._log(`▶ ${hits[0]}`)
        this._emit('torrent:installer_launched', { downloadId, installer: hits[0], gameTitle })
        await shell.openPath(hits[0])
        this._watchInstall(path.dirname(hits[0]), downloadId, gameTitle)
      } else {
        await shell.openPath(dest)
      }
    } catch(e) { this._log(`launcher: ${e.message}`) }
  }

  _watchInstall(dir, downloadId, gameTitle) {
    const t = setTimeout(() => w?.close(), 600000)
    let w
    try {
      w = fs.watch(dir, { recursive: true }, async (ev, filename) => {
        if (!filename || !/\.exe$/i.test(filename)) return
        if (/setup|install|unins|redist|vcredist|directx|dotnet/i.test(filename)) return
        const p = path.join(dir, filename)
        if (!fs.existsSync(p)) return
        clearTimeout(t); w.close()
        this._log(`🎮 Zainstalowano: ${p}`)
        this._emit('torrent:game_installed', { downloadId, gameTitle, exePath: p, installDir: dir })
        this._addToLibrary(gameTitle, p, dir)
      })
    } catch(e) { clearTimeout(t) }
  }

  async _addToLibrary(gameTitle, exePath, installPath) {
    try {
      const { v4: uuidv4 } = require('uuid')
      const game = this.db.prepare('SELECT id FROM games WHERE LOWER(title) LIKE ? LIMIT 1')
        .get(`%${(gameTitle||'').slice(0,15).toLowerCase()}%`)
      if (!game) return
      const user = this.db.prepare('SELECT id FROM users LIMIT 1').get()
      if (!user) return
      const exists = this.db.prepare('SELECT id FROM library WHERE game_id=?').get(game.id)
      if (exists) {
        this.db.prepare('UPDATE library SET executable=?,install_path=? WHERE game_id=?')
          .run(exePath, installPath, game.id)
      } else {
        this.db.prepare('INSERT INTO library (id,user_id,game_id,executable,install_path) VALUES (?,?,?,?,?)')
          .run(uuidv4(), user.id, game.id, exePath, installPath)
      }
      this._log(`✅ Biblioteka: ${gameTitle}`)
    } catch(e) { this._log(`library: ${e.message}`) }
  }

  _findFiles(dir, name, out = []) {
    try {
      for (const e of fs.readdirSync(dir)) {
        const p = path.join(dir, e)
        if (fs.statSync(p).isDirectory()) this._findFiles(p, name, out)
        else if (e.toLowerCase() === name) out.push(p)
      }
    } catch {}
    return out
  }

  _updateStatus(id, s, p) {
    try { this.db.prepare('UPDATE downloads SET status=?,progress=? WHERE id=?').run(s, p, id) } catch {}
  }
  _updateProgress(id, p, s, e) {
    try { this.db.prepare('UPDATE downloads SET progress=?,speed_kbps=?,eta_seconds=? WHERE id=?').run(p, s, e, id) } catch {}
  }

  pause(id)  { const e = this.active.get(id); e?.torrent?.pause();  return { success: true } }
  resume(id) { const e = this.active.get(id); e?.torrent?.resume(); return { success: true } }
  remove(id) {
    const e = this.active.get(id)
    if (e) { clearInterval(e.interval); e.torrent?.destroy(); this.active.delete(id) }
    return { success: true }
  }

  register(ipcMain) {
    ipcMain.handle('torrent:start',  async (_, d)            => this.add(d))
    ipcMain.handle('torrent:pause',  async (_, { downloadId }) => this.pause(downloadId))
    ipcMain.handle('torrent:resume', async (_, { downloadId }) => this.resume(downloadId))
    ipcMain.handle('torrent:remove', async (_, { downloadId }) => this.remove(downloadId))
    ipcMain.handle('torrent:list',   async ()                => Array.from(this.active.keys()))
    ipcMain.handle('torrent:ping',   async ()                => ({ ready: !!this.client }))
  }

  destroy() {
    for (const [, e] of this.active) { clearInterval(e.interval); e.torrent?.destroy() }
    if (this.client) this.client.destroy()
  }
}

module.exports = TorrentManager

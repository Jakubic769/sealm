/**
 * electron/aria2Manager.js
 *
 * aria2c jako subprocess — prawdziwy klient BitTorrent.
 * Działa za NAT/CGNAT bez port forwarding.
 * Komunikacja przez JSON-RPC na localhost.
 */

const path    = require('path')
const fs      = require('fs')
const { spawn } = require('child_process')
const http    = require('http')

const RPC_PORT   = 6800
const RPC_SECRET = 'sealm_aria2_secret'

class Aria2Manager {
  constructor(win, db) {
    this.win      = win
    this.db       = db
    this.process  = null
    this.active   = new Map()  // gid → { downloadId, gameTitle, savePath, interval }
    this._ready   = false
  }

  _log(msg) {
    console.log('[aria2]', msg)
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send('torrent:log', String(msg))
  }

  _emit(ch, d) {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send(ch, d)
  }

  // ── Znajdź aria2c.exe ─────────────────────────────────────────────────────
  _getAria2Path() {
    const { app } = require('electron')

    // W skompilowanej wersji — bin/ obok app.asar
    const candidates = [
      path.join(process.resourcesPath || '', 'bin', 'aria2c.exe'),
      path.join(app.getAppPath(), '..', 'bin', 'aria2c.exe'),
      path.join(__dirname, '..', 'bin', 'aria2c.exe'),
      // Systemowa instalacja
      'aria2c',
      'aria2c.exe',
    ]

    for (const p of candidates) {
      try {
        if (p.includes('aria2c.exe') && fs.existsSync(p)) {
          this._log(`aria2c found: ${p}`)
          return p
        }
        if (!p.includes(path.sep)) return p  // systemowy
      } catch {}
    }

    return null
  }

  // ── Uruchom aria2c jako daemon ────────────────────────────────────────────
  async start() {
    if (this._ready) return true

    const aria2Path = this._getAria2Path()
    if (!aria2Path) {
      this._log('aria2c not found — using WebTorrent fallback')
      return false
    }

    const { app } = require('electron')
    const sessionDir = path.join(app.getPath('userData'), 'aria2')
    fs.mkdirSync(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, 'session.txt')
    // Always start fresh — old session.txt may contain broken trackers from previous runs
    fs.writeFileSync(sessionFile, '')

    // ── ORIGINAL WORKING CONFIG (restored from session history) ────────────
    const args = [
      '--enable-rpc=true',
      `--rpc-listen-port=${RPC_PORT}`,
      `--rpc-secret=${RPC_SECRET}`,
      '--rpc-listen-all=false',
      '--enable-dht=true',
      '--enable-dht6=false',
      '--enable-peer-exchange=true',
      '--bt-enable-lpd=true',
      '--bt-save-metadata=true',
      '--seed-time=0',
      '--max-connection-per-server=16',
      '--split=16',
      '--min-split-size=5M',
      '--bt-max-peers=200',
      `--dht-file-path=${path.join(sessionDir, 'dht.dat')}`,
      `--save-session=${sessionFile}`,
      '--log-level=notice',
      '--bt-tracker=udp://tracker.opentrackr.org:1337/announce,udp://open.stealth.si:80/announce,udp://tracker.torrent.eu.org:451/announce,udp://tracker.dler.org:6969/announce,udp://tracker.qu.ax:6969/announce,https://tracker.gbitt.info/announce,udp://bt1.archive.org:6969/announce,udp://bt2.archive.org:6969/announce',
      '--bt-require-crypto=false',
      '--bt-min-crypto-level=plain',
      '--follow-torrent=mem',
      '--async-dns=false',
      '--connect-timeout=60',
      '--timeout=600',
      '--retry-wait=30',
      '--max-tries=0',
      '--file-allocation=none',
      // Exclude broken trackers from FitGirl magnets
      '--bt-exclude-tracker=http://opentor.org/announce,https://opentor.org/announce,http://opentor.org:1337/announce',
      // More aggressive peer search
      '--bt-max-peers=500',
      '--bt-request-peer-speed-limit=0',
      // Keep downloading even with few peers
      '--bt-stop-timeout=0',
    ]

    // input-file tylko jeśli niepusty
    // session.txt is always cleared on start, so no --input-file needed

    // Only delete dht.dat if corrupted (too small) — preserve it between sessions
    // Keeping dht.dat = faster peer discovery on next download
    const dhtFile = path.join(sessionDir, 'dht.dat')
    if (fs.existsSync(dhtFile)) {
      try {
        const size = fs.statSync(dhtFile).size
        if (size < 100) {
          fs.unlinkSync(dhtFile)
          this._log('dht.dat corrupted — removed, will rebuild')
        } else {
          this._log('dht.dat OK (' + size + ' bytes) — reusing routing table')
        }
      } catch {}
    }

    this._log(`Starting aria2c: ${aria2Path}`)

    return new Promise(resolve => {
      this.process = spawn(aria2Path, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      this.process.stdout.on('data', d => {
        const msg = d.toString().trim()
        if (!msg) return
        // Filter out noisy tracker DNS errors — they don't affect download via DHT
        if (msg.includes('errorCode=19') && msg.includes('Failed to resolve')) return
        if (msg.includes('errorCode=22') && msg.includes('response status')) return
        if (msg.includes('Download aborted') && msg.includes('tracker')) return
        if (msg.includes('errorCode=1') && msg.includes('SSL/TLS')) return
        this._log(`[aria2c] ${msg}`)
        // aria2c jest gotowy gdy wypisuje cokolwiek — nie czekaj na specyficzny tekst
        if (!this._ready) {
          setTimeout(async () => {
            try {
              const v = await this._rpc('aria2.getVersion', [])
              if (v && !this._ready) {
                this._ready = true
                this._log(`✅ aria2c ready | version: ${v.version}`)
                resolve(true)
              }
            } catch {}
          }, 1000)
        }
      })

      this.process.stderr.on('data', d => {
        this._log(`[aria2c stderr] ${d.toString().trim()}`)
      })

      this.process.on('exit', code => {
        this._log(`aria2c exited (code: ${code})`)
        this._ready = false
      })

      this.process.on('error', e => {
        this._log(`aria2c error: ${e.message}`)
        this._ready = false
        resolve(false)
      })

      setTimeout(() => {
        if (!this._ready) {
          // Spróbuj połączyć przez RPC — może już działa
          this._rpc('aria2.getVersion', []).then(v => {
            if (v) {
              this._ready = true
              this._log(`✅ aria2c RPC OK: v${v.version}`)
              resolve(true)
            } else {
              resolve(false)
            }
          }).catch(() => resolve(false))
        }
      }, 5000)
    })
  }

  // ── JSON-RPC call ─────────────────────────────────────────────────────────
  async _rpc(method, params = [], retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this._rpcOnce(method, params)
      } catch(e) {
        if (attempt < retries && (e.message.includes('timeout') || e.message.includes('ECONNREFUSED'))) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)))  // backoff: 500ms, 1000ms
          continue
        }
        throw e
      }
    }
  }

  async _rpcOnce(method, params = []) {
    // Serialize RPC calls — only one at a time to prevent overload
    if (this._rpcBusy) {
      await new Promise(r => setTimeout(r, 100))
    }
    this._rpcBusy = true
    try {
      return await new Promise((resolve, reject) => {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params: [`token:${RPC_SECRET}`, ...params],
        })

        const req = http.request({
          hostname: '127.0.0.1',
          port:     RPC_PORT,
          path:     '/jsonrpc',
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
        }, res => {
          let data = ''
          res.on('data', d => data += d)
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              if (json.error) reject(new Error(json.error.message))
              else resolve(json.result)
            } catch(e) { reject(e) }
          })
        })

        req.on('error', reject)
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('RPC timeout')) })
        req.write(body)
        req.end()
      })
    } finally {
      this._rpcBusy = false
    }
  }

  // ── Dodaj pobieranie ──────────────────────────────────────────────────────
  async add({ downloadId, magnetUri, savePath, gameTitle }) {
    this._log(`\n=== DOWNLOAD (aria2) ===\nGame: ${gameTitle}\nFolder: ${savePath}`)

    if (!magnetUri) return { success: false, error: 'No magnet link' }
    if (!savePath)  return { success: false, error: 'Select folder' }

    const ok = await this.start()
    if (!ok) return { success: false, error: 'aria2c not available — install aria2' }

    try { fs.mkdirSync(savePath, { recursive: true }) } catch {}

    try {
      const gid = await this._rpc('aria2.addUri', [
        [magnetUri],
        {
          dir: savePath,
          'bt-seed-unverified': 'false',
          'seed-time': '0',
          'max-download-limit': '0',
        }
      ])

      this._log(`✅ Added to aria2: GID=${gid}`)
      this.active.set(gid, { downloadId, gameTitle, savePath })

      this._updateStatus(downloadId, 'downloading', 0)

      // Śledź postęp przez RPC
      const interval = setInterval(() => this._pollProgress(gid), 3000)
      this.active.get(gid).interval = interval

      return { success: true, mode: 'aria2', gid }
    } catch(e) {
      this._log(`RPC add error: ${e.message}`)
      return { success: false, error: e.message }
    }
  }

  async _pollProgress(gid) {
    const entry = this.active.get(gid)
    if (!entry) return
    if (entry._polling) return
    entry._polling = true

    try {
      const status = await this._rpc('aria2.tellStatus', [gid])
      const { downloadId, gameTitle, savePath } = entry
      const ariaStatus = status.status

      // ── followedBy: aria2 created a child GID, switch to tracking it ──────
      // This happens after metadata download (GID1→GID2) AND after
      // file download completes and aria2 starts verification (GID2→GID3)
      // We MUST NOT fire torrent:done when GID2 completes — only when
      // there is no more followedBy (final GID)
      if (status.followedBy && status.followedBy.length > 0) {
        const nextGid = status.followedBy[0]
        if (!this.active.has(nextGid)) {
          // Always start next GID as 'connecting' — let phase detection figure it out
          this._log(`GID ${gid} → next GID ${nextGid}`)
          clearInterval(entry.interval)
          this.active.delete(gid)
          const nextEntry = { ...entry, interval: null, _polling: false, _phase: 'connecting', _done: false }
          this.active.set(nextGid, nextEntry)
          nextEntry.interval = setInterval(() => this._pollProgress(nextGid), 3000)
        }
        return
      }

      const total      = parseInt(status.totalLength)     || 0
      const downloaded = parseInt(status.completedLength) || 0
      const speed      = parseInt(status.downloadSpeed)   || 0
      const seeders    = parseInt(status.numSeeders)      || 0
      const peers      = parseInt(status.connections)     || 0
      const verified   = parseInt(status.verifiedLength)  || 0
      const progress   = total > 0 ? Math.round(downloaded / total * 1000) / 10 : 0

      // ── Determine current phase ───────────────────────────────────────────
      // metadata  : GID1, small .torrent file download
      // connecting: active, total=0, speed=0 (searching for peers)
      // allocating: active, total>0, speed=0, downloaded=0 (writing file structure)
      // downloading: normal download
      // verifying  : active, speed=0, verifiedLength>0 (hash check after download)
      let phase = entry._phase || 'metadata'

      if (ariaStatus === 'active') {
        if (total === 0 && speed === 0 && downloaded === 0) {
          phase = 'connecting'
        } else if (total > 0 && downloaded === 0 && speed === 0 && verified === 0) {
          phase = 'allocating'
        } else if (verified > 0 && speed === 0) {
          phase = 'verifying'
        } else if (total > 0) {
          phase = 'downloading'
        }
      }

      // ── Update phase on entry ─────────────────────────────────────────────
      entry._phase = phase

      // ── Emit progress with correct phase ──────────────────────────────────
      const etaSec = speed > 0 && total > downloaded
        ? Math.round((total - downloaded) / speed) : null

      // Only log meaningful state changes
      if (phase === 'downloading' && (speed > 0 || progress > 0)) {
        const mb      = (downloaded/1024/1024).toFixed(0)
        const totalMb = (total/1024/1024).toFixed(0)
        const eta     = etaSec
          ? etaSec > 3600 ? `${Math.round(etaSec/3600)}h` : `${Math.round(etaSec/60)}m`
          : '—'
        this._log(`${progress.toFixed(1)}% | ${mb}/${totalMb}MB | ${Math.round(speed/1024)}KB/s | ${seeders} seeders | ETA: ${eta}`)
      } else if (phase !== 'downloading' && phase !== (entry._lastLogPhase)) {
        this._log(`Phase: ${phase}`)
        entry._lastLogPhase = phase
      }

      this._emit('torrent:progress', {
        downloadId, progress, speedKbps: Math.round(speed/1024),
        etaSec, peers: seeders, phase,
        totalBytes: total, downloadedBytes: downloaded,
      })
      if (phase === 'downloading') {
        this._updateProgress(downloadId, progress, Math.round(speed/1024), etaSec)
      }

      // ── Complete: ONLY fire done on the FINAL GID (no followedBy) ─────────
      if (ariaStatus === 'complete') {
        if (entry._done) return
        // Extra guard: if total > 0 but downloaded = 0, this is just file allocation complete
        // The real download GID will follow — don't fire done yet
        if (total > 0 && downloaded < total * 0.99) {
          this._log(`Complete signal but only ${progress}% downloaded — waiting for real download GID`)
          return
        }
        entry._done = true
        clearInterval(entry.interval)
        this.active.delete(gid)
        this._log(`✅ Download complete: ${gameTitle}`)
        this._log(`📁 Files saved to: ${savePath}`)
        this._log(`Click "Install" to run setup.exe`)
        this._updateStatus(downloadId, 'completed', 100)
        this._emit('torrent:done', { downloadId, savePath, gameTitle })
      }

      else if (ariaStatus === 'error') {
        clearInterval(entry.interval)
        this.active.delete(gid)
        const errMsg = status.errorMessage || `Error code: ${status.errorCode}` || 'Unknown error'
        this._log(`❌ Error: ${errMsg}`)
        this._updateStatus(downloadId, 'error', 0)
        this._emit('torrent:error', { downloadId, error: errMsg })
      }

      else if (ariaStatus === 'removed') {
        clearInterval(entry.interval)
        this.active.delete(gid)
      }

    } catch(e) {
      if (!e.message.includes('timeout') && !e.message.includes('ECONNREFUSED') && !e.message.includes('GID')) {
        this._log(`Poll error: ${e.message}`)
      }
    } finally {
      if (this.active.get(gid)) this.active.get(gid)._polling = false
    }
  }

  async pause(downloadId) {
    for (const [gid, e] of this.active) {
      if (e.downloadId === downloadId) {
        await this._rpc('aria2.pause', [gid]).catch(() => {})
        return { success: true }
      }
    }
    return { success: false }
  }

  async resume(downloadId) {
    for (const [gid, e] of this.active) {
      if (e.downloadId === downloadId) {
        await this._rpc('aria2.unpause', [gid]).catch(() => {})
        return { success: true }
      }
    }
    return { success: false }
  }

  async remove(downloadId) {
    for (const [gid, e] of this.active) {
      if (e.downloadId === downloadId) {
        clearInterval(e.interval)
        await this._rpc('aria2.remove', [gid]).catch(() => {})
        this.active.delete(gid)
        return { success: true }
      }
    }
    return { success: true }
  }

  async _launchSetup(dest, downloadId, gameTitle) {
    const { shell } = require('electron')
    try {
      const hits = this._findFiles(dest, 'setup.exe')
      if (hits.length) {
        this._log(`▶ ${hits[0]}`)
        this._emit('torrent:installer_launched', { downloadId, installer: hits[0], gameTitle })
        await shell.openPath(hits[0])
      } else {
        await shell.openPath(dest)
      }
    } catch(e) { this._log(`launcher: ${e.message}`) }
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
    try { this.db.prepare('UPDATE downloads SET status=?,progress=? WHERE id=?').run(s,p,id) } catch {}
  }
  _updateProgress(id, p, s, e) {
    try { this.db.prepare('UPDATE downloads SET progress=?,speed_kbps=?,eta_seconds=? WHERE id=?').run(p,s,e,id) } catch {}
  }

  register(ipcMain) {
    ipcMain.handle('torrent:start',  async (_, d)            => this.add(d))
    ipcMain.handle('torrent:pause',  async (_, { downloadId }) => this.pause(downloadId))
    ipcMain.handle('torrent:resume', async (_, { downloadId }) => this.resume(downloadId))
    ipcMain.handle('torrent:remove', async (_, { downloadId }) => this.remove(downloadId))
    ipcMain.handle('torrent:list',   async ()                => Array.from(this.active.values()).map(e => e.downloadId))
    ipcMain.handle('torrent:ping',   async ()                => ({ ready: this._ready }))
  }

  destroy() {
    for (const e of this.active.values()) clearInterval(e.interval)
    if (this.process) {
      this.process.kill()
      this._log('aria2c zatrzymany')
    }
  }
}

module.exports = Aria2Manager

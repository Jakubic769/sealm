/**
 * electron/updater.js
 *
 * Automatyczne aktualizacje launchera SEALM przez electron-updater.
 * Używa GitHub Releases jako źródła aktualizacji.
 *
 * Konfiguracja w package.json → "build" → "publish":
 * {
 *   "provider": "github",
 *   "owner":    "twoj-github-nick",
 *   "repo":     "sealm"
 * }
 *
 * Wysyła zdarzenia IPC do renderera:
 *   updater:checking       — trwa sprawdzanie
 *   updater:available      — dostępna nowa wersja { version, releaseNotes }
 *   updater:not-available  — brak aktualizacji
 *   updater:progress       — postęp pobierania { percent, speed, total }
 *   updater:downloaded     — gotowa do instalacji
 *   updater:error          — błąd { message }
 */

class Updater {
  constructor(win, notificationManager) {
    this.win                 = win
    this.notificationManager = notificationManager
    this.autoUpdater         = null
    this._initialized        = false
  }

  // ── Init (lazy — only in production) ──────────────────────────────────────
  _init() {
    if (this._initialized) return
    this._initialized = true

    try {
      const { autoUpdater } = require('electron-updater')
      this.autoUpdater = autoUpdater

      autoUpdater.autoDownload    = false   // Ask user first
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('checking-for-update', () => {
        this._emit('updater:checking', {})
      })

      autoUpdater.on('update-available', (info) => {
        this._emit('updater:available', {
          version:      info.version,
          releaseDate:  info.releaseDate,
          releaseNotes: info.releaseNotes,
        })
        if (this.notificationManager) {
          this.notificationManager.updateAvailable({ version: info.version })
        }
      })

      autoUpdater.on('update-not-available', () => {
        this._emit('updater:not-available', {})
      })

      autoUpdater.on('download-progress', (progress) => {
        this._emit('updater:progress', {
          percent:       Math.round(progress.percent),
          transferred:   progress.transferred,
          total:         progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        })
      })

      autoUpdater.on('update-downloaded', (info) => {
        this._emit('updater:downloaded', { version: info.version })
      })

      autoUpdater.on('error', (err) => {
        console.error('[Updater] error:', err.message)
        this._emit('updater:error', { message: err.message })
      })

    } catch (e) {
      console.warn('[Updater] electron-updater not available:', e.message)
    }
  }

  _emit(channel, data) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  check() {
    this._init()
    if (!this.autoUpdater) return
    // Only check in packaged app
    const { app } = require('electron')
    if (!app.isPackaged) {
      this._emit('updater:not-available', { dev: true })
      return
    }
    this.autoUpdater.checkForUpdates()
  }

  download() {
    if (!this.autoUpdater) return
    this.autoUpdater.downloadUpdate()
  }

  install() {
    if (!this.autoUpdater) return
    this.autoUpdater.quitAndInstall(false, true)
  }

  // ── Register IPC handlers ─────────────────────────────────────────────────
  register(ipcMain) {
    ipcMain.handle('updater:check',    async () => { this.check();    return { success: true } })
    ipcMain.handle('updater:download', async () => { this.download(); return { success: true } })
    ipcMain.handle('updater:install',  async () => { this.install();  return { success: true } })

    // Forward updater events to renderer via preload listeners
    ;['updater:checking','updater:available','updater:not-available',
      'updater:progress','updater:downloaded','updater:error'].forEach(ch => {
      ipcMain.removeAllListeners(ch)
    })
  }
}

module.exports = Updater

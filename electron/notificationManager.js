/**
 * electron/notificationManager.js
 *
 * Obsługuje natywne powiadomienia systemowe Electron:
 *  - Nowa wiadomość czatu (ogólna / DM)
 *  - Pobieranie zakończone
 *  - Instalacja zakończona
 *  - Aktualizacja launchera dostępna
 *
 * Szanuje ustawienia użytkownika (przekazane z renderera przez IPC).
 */

const { Notification, nativeImage, shell, app } = require('electron')
const path = require('path')

class NotificationManager {
  constructor(win) {
    this.win       = win
    this.settings  = {
      enabled:      true,
      chatMessages: true,
      downloads:    true,
      sound:        true,
    }
    this._dmQueue  = []   // unread DM count for tray badge
    this._unreadDM = 0
  }

  // ── Apply settings from renderer ───────────────────────────────────────────
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings }
  }

  // ── Check if system supports notifications ─────────────────────────────────
  isSupported() {
    return Notification.isSupported()
  }

  // ── Generic notification ───────────────────────────────────────────────────
  _notify({ title, body, icon, onClick, urgency = 'normal' }) {
    if (!this.settings.enabled) return
    if (!Notification.isSupported()) return

    const iconPath = icon || this._defaultIcon()

    const n = new Notification({
      title,
      body,
      icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
      silent: !this.settings.sound,
      urgency,
      timeoutType: 'default',
      // Windows: show app in taskbar
      toastXml: undefined,
    })

    if (onClick) n.on('click', onClick)
    n.show()
    return n
  }

  _defaultIcon() {
    // Try to find app icon
    const candidates = [
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(app.getAppPath(), 'public', 'icon.png'),
    ]
    for (const p of candidates) {
      try {
        require('fs').accessSync(p)
        return p
      } catch {}
    }
    return null
  }

  // ── Chat notification ──────────────────────────────────────────────────────
  newMessage({ username, body, isDM = false, channel = 'general' }) {
    if (!this.settings.chatMessages) return
    // Don't notify if window is focused
    if (this.win && this.win.isFocused()) return

    const title = isDM ? `💬 ${username} (prywatna)` : `# ${channel}`
    const preview = body.length > 80 ? body.slice(0, 77) + '…' : body

    if (isDM) this._unreadDM++

    this._notify({
      title,
      body: isDM ? preview : `${username}: ${preview}`,
      urgency: isDM ? 'critical' : 'normal',
      onClick: () => {
        if (this.win) {
          this.win.show()
          this.win.focus()
          this.win.webContents.send('navigate', isDM ? '/chat?dm=1' : '/chat')
        }
        if (isDM) this._unreadDM = 0
      },
    })
  }

  // ── Download complete notification ─────────────────────────────────────────
  downloadComplete({ gameTitle, sizeMB, installPath }) {
    if (!this.settings.downloads) return

    this._notify({
      title: '⬇ Pobieranie zakończone',
      body: `${gameTitle} (${Math.round(sizeMB / 1024)} GB) — uruchamianie instalatora…`,
      urgency: 'normal',
      onClick: () => {
        if (this.win) { this.win.show(); this.win.webContents.send('navigate', '/downloads') }
      },
    })
  }

  // ── Install complete notification ──────────────────────────────────────────
  installComplete({ gameTitle }) {
    if (!this.settings.downloads) return

    this._notify({
      title: '✅ Instalacja zakończona',
      body: `${gameTitle} jest gotowa do gry!`,
      urgency: 'low',
      onClick: () => {
        if (this.win) { this.win.show(); this.win.webContents.send('navigate', '/library') }
      },
    })
  }

  // ── Update available notification ──────────────────────────────────────────
  updateAvailable({ version }) {
    this._notify({
      title: '🔄 Aktualizacja SEALM',
      body: `Wersja ${version} is available. Kliknij aby zainstalować.`,
      urgency: 'normal',
    })
  }

  // ── Register IPC handlers ──────────────────────────────────────────────────
  register(ipcMain) {
    ipcMain.handle('notifications:settings', async (_, settings) => {
      this.updateSettings(settings)
      return { success: true }
    })

    ipcMain.handle('notifications:test', async () => {
      this._notify({
        title: '🎮 SEALM',
        body: 'Powiadomienia działają poprawnie!',
      })
      return { success: true }
    })
  }
}

module.exports = NotificationManager

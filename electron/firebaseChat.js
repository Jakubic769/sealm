/**
 * electron/firebaseChat.js
 *
 * Czat online przez Firebase Realtime Database.
 * Zastępuje chatServer.js (lokalny WebSocket) — teraz wszyscy
 * użytkownicy SEALM na całym świecie widzą te same wiadomości.
 *
 * Struktura bazy Firebase:
 *   /messages/general/{id}  — wiadomości ogólne
 *   /messages/dm/{uid1_uid2}/{id} — wiadomości prywatne
 *   /online/{userId}        — status online (heartbeat)
 *   /typing/{channel}/{userId} — wskaźnik pisania
 */

const path = require('path')

class FirebaseChat {
  constructor(win, db) {
    this.win    = win
    this.db     = db
    this.admin  = null
    this.rtdb   = null
    this._onlineInterval = null
    this._listeners      = []
    this._currentUserId  = null
  }

  // ── Inicjalizacja Firebase ────────────────────────────────────────────────
  async init() {
    try {
      const admin = require('firebase-admin')
      this.admin  = admin

      // Szukaj pliku klucza
      const keyPath = path.join(__dirname, 'sealm-firebase-key.json')
      const fs = require('fs')

      if (!fs.existsSync(keyPath)) {
        console.warn('[Firebase] Brak pliku sealm-firebase-key.json — czat online niedostępny')
        return false
      }

      const serviceAccount = require(keyPath)

      // Inicjalizuj tylko raz
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential:  admin.credential.cert(serviceAccount),
          databaseURL: serviceAccount.databaseURL || this._guessDbUrl(serviceAccount),
        })
      }

      this.rtdb = admin.database()
      console.log('[Firebase] Połączono z Realtime Database')
      return true
    } catch (e) {
      console.warn('[Firebase] Błąd inicjalizacji:', e.message)
      return false
    }
  }

  _guessDbUrl(serviceAccount) {
    // Jeśli brak databaseURL w kluczu, spróbuj zgadnąć z project_id
    const projectId = serviceAccount.project_id
    return `https://${projectId}-default-rtdb.firebaseio.com`
  }

  // ── Status online ─────────────────────────────────────────────────────────
  setOnline(userId, username) {
    if (!this.rtdb || !userId) return
    this._currentUserId = userId

    const ref = this.rtdb.ref(`online/${userId}`)
    ref.set({ username, timestamp: Date.now(), online: true })

    // Usuń przy rozłączeniu
    ref.onDisconnect().remove()

    // Heartbeat co 30s
    this._onlineInterval = setInterval(() => {
      ref.update({ timestamp: Date.now() })
    }, 30000)
  }

  setOffline(userId) {
    if (!this.rtdb || !userId) return
    clearInterval(this._onlineInterval)
    this.rtdb.ref(`online/${userId}`).remove()
    this._currentUserId = null
  }

  // ── Nasłuchuj wiadomości w czasie rzeczywistym ───────────────────────────
  listenChannel(channel, callback) {
    if (!this.rtdb) return () => {}

    const ref = this.rtdb.ref(`messages/${channel}`)
      .orderByChild('timestamp')
      .limitToLast(100)

    const handler = ref.on('child_added', (snap) => {
      const msg = { id: snap.key, ...snap.val() }
      callback(msg)
    })

    this._listeners.push({ ref, handler })
    return () => ref.off('child_added', handler)
  }

  // ── Wyślij wiadomość ─────────────────────────────────────────────────────
  async sendMessage({ senderId, username, channel = 'general', body, receiverId = null }) {
    if (!this.rtdb) return { success: false, error: 'Firebase niedostępny' }

    const channelKey = receiverId
      ? `dm/${[senderId, receiverId].sort().join('_')}`
      : `general`

    const msg = {
      senderId,
      username,
      body,
      timestamp: Date.now(),
      channel: channelKey,
    }

    const ref = this.rtdb.ref(`messages/${channelKey}`).push()
    await ref.set(msg)

    // Zapisz też lokalnie do SQLite
    try {
      const { v4: uuidv4 } = require('uuid')
      this.db.prepare(
        'INSERT OR IGNORE INTO messages (id, sender_id, receiver_id, channel, body) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), senderId, receiverId || null, channelKey, body)
    } catch {}

    return { success: true, message: { id: ref.key, ...msg } }
  }

  // ── Pobierz historię wiadomości ──────────────────────────────────────────
  async getHistory(channel = 'general', limit = 50) {
    if (!this.rtdb) return []
    try {
      const snap = await this.rtdb.ref(`messages/${channel}`)
        .orderByChild('timestamp')
        .limitToLast(limit)
        .once('value')

      const messages = []
      snap.forEach(child => {
        messages.push({ id: child.key, ...child.val() })
      })
      return messages
    } catch (e) {
      console.warn('[Firebase] getHistory error:', e.message)
      return []
    }
  }

  // ── Lista online ─────────────────────────────────────────────────────────
  async getOnlineUsers() {
    if (!this.rtdb) return []
    try {
      const snap = await this.rtdb.ref('online').once('value')
      const users = []
      const cutoff = Date.now() - 60000  // aktywni w ostatniej minucie
      snap.forEach(child => {
        const u = child.val()
        if (u.timestamp > cutoff) {
          users.push({ id: child.key, username: u.username })
        }
      })
      return users
    } catch (e) {
      return []
    }
  }

  // ── Wskaźnik pisania ─────────────────────────────────────────────────────
  setTyping(userId, username, channel) {
    if (!this.rtdb) return
    const ref = this.rtdb.ref(`typing/${channel}/${userId}`)
    ref.set({ username, timestamp: Date.now() })
    setTimeout(() => ref.remove(), 3000)
  }

  // ── Nasłuchuj online users ───────────────────────────────────────────────
  listenOnline(callback) {
    if (!this.rtdb) return () => {}
    const ref = this.rtdb.ref('online')
    const h = ref.on('value', (snap) => {
      const users = []
      const cutoff = Date.now() - 60000
      snap.forEach(child => {
        const u = child.val()
        if (u.timestamp > cutoff) users.push({ id: child.key, username: u.username })
      })
      callback(users)
    })
    return () => ref.off('value', h)
  }

  // ── IPC Handlers ─────────────────────────────────────────────────────────
  register(ipcMain) {
    const emit = (ch, d) => {
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(ch, d)
    }

    ipcMain.handle('firebase:init', async () => {
      const ok = await this.init()
      return { success: ok }
    })

    ipcMain.handle('firebase:setOnline', async (_, { userId, username }) => {
      this.setOnline(userId, username)
      return { success: true }
    })

    ipcMain.handle('firebase:setOffline', async (_, { userId }) => {
      this.setOffline(userId)
      return { success: true }
    })

    ipcMain.handle('firebase:sendMessage', async (_, data) => {
      return this.sendMessage(data)
    })

    ipcMain.handle('firebase:getHistory', async (_, { channel, limit }) => {
      return this.getHistory(channel, limit)
    })

    ipcMain.handle('firebase:getOnline', async () => {
      return this.getOnlineUsers()
    })

    ipcMain.handle('firebase:setTyping', async (_, { userId, username, channel }) => {
      this.setTyping(userId, username, channel)
      return { success: true }
    })

    // Nasłuchiwanie w czasie rzeczywistym — wysyłaj eventy do renderera
    ipcMain.handle('firebase:listenChannel', async (_, { channel }) => {
      // Usuń poprzedni listener dla tego kanału
      const unsubKey = `listen_${channel}`
      if (this[unsubKey]) { this[unsubKey](); delete this[unsubKey] }

      this[unsubKey] = this.listenChannel(channel, (msg) => {
        emit('firebase:message', msg)
      })
      return { success: true }
    })

    ipcMain.handle('firebase:listenOnline', async () => {
      if (this._unsubOnline) { this._unsubOnline() }
      this._unsubOnline = this.listenOnline((users) => {
        emit('firebase:onlineUsers', users)
      })
      return { success: true }
    })

    ipcMain.handle('firebase:hasKey', async () => {
      const fs = require('fs')
      const keyPath = require('path').join(__dirname, 'sealm-firebase-key.json')
      return { has: fs.existsSync(keyPath) }
    })
  }

  destroy() {
    clearInterval(this._onlineInterval)
    if (this._currentUserId) this.setOffline(this._currentUserId)
    this._listeners.forEach(({ ref, handler }) => ref.off('child_added', handler))
    if (this._unsubOnline) this._unsubOnline()
  }
}

module.exports = FirebaseChat

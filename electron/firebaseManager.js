/**
 * electron/firebaseManager.js
 *
 * Central Firebase manager for SEALM:
 * - Realtime chat (global + DM)
 * - Friends & online status
 * - Playtime stats synced to cloud
 * - Profile pictures via Imgur
 *
 * Firebase Realtime DB structure:
 *   /users/{uid}/           — username, email, avatar, createdAt
 *   /online/{uid}/          — { online, lastSeen, username }
 *   /chat/general/{id}/     — { uid, username, avatar, text, ts }
 *   /chat/dm/{roomId}/{id}/ — { uid, username, text, ts }
 *   /friends/{uid}/{fid}/   — { status: pending|accepted, ts, username }
 *   /playtime/{uid}/        — { totalMinutes, games: {title: minutes} }
 *   /notifications/{uid}/   — { type, from, text, ts, read }
 */

const path = require('path')
const fs   = require('fs')

class FirebaseManager {
  constructor(win, db) {
    this.win   = win
    this.db    = db   // SQLite local DB
    this.admin = null
    this.rtdb  = null
    this._uid  = null
    this._username = null
    this._heartbeat = null
    this._listeners = []
  }

  _log(msg) {
    console.log('[Firebase]', msg)
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send('torrent:log', `[Firebase] ${msg}`)
  }

  _emit(channel, data) {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send(channel, data)
  }

  get ready() { return !!this.rtdb }

  // ── Initialize Firebase connection ────────────────────────────────────────
  async init() {
    try {
      const admin   = require('firebase-admin')
      const keyPath = path.join(__dirname, 'sealm-firebase-key.json')

      if (!fs.existsSync(keyPath)) {
        this._log('sealm-firebase-key.json not found — online features disabled')
        this._log('Create Firebase project → download service account key → save as sealm-firebase-key.json')
        return false
      }

      const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'))

      if (admin.apps.length === 0) {
        const dbURL = sa.databaseURL || `https://${sa.project_id}-default-rtdb.firebaseio.com`
        admin.initializeApp({
          credential:  admin.credential.cert(sa),
          databaseURL: dbURL,
        })
        this._log(`Connected to ${dbURL}`)
      }

      this.admin = admin
      this.rtdb  = admin.database()
      this._log('Firebase ready ✅')
      return true
    } catch(e) {
      this._log(`Init error: ${e.message}`)
      return false
    }
  }

  // ── Presence / Online status ──────────────────────────────────────────────
  async setOnline(uid, username, avatar) {
    if (!this.ready) return
    this._uid = uid
    this._username = username

    const ref = this.rtdb.ref(`online/${uid}`)
    const data = { online: true, username, avatar: avatar || null, lastSeen: Date.now() }
    await ref.set(data).catch(() => {})

    // Auto set offline when Firebase connection drops
    ref.onDisconnect().update({ online: false, lastSeen: Date.now() }).catch(() => {})

    // Heartbeat every 25s to keep presence alive
    if (this._heartbeat) clearInterval(this._heartbeat)
    this._heartbeat = setInterval(() => {
      ref.update({ lastSeen: Date.now() }).catch(() => {})
    }, 25000)
  }

  async setOffline(uid) {
    if (!this.ready) return
    clearInterval(this._heartbeat)
    this._listeners.forEach(unsub => { try { unsub() } catch {} })
    this._listeners = []
    await this.rtdb.ref(`online/${uid}`).update({ online: false, lastSeen: Date.now() }).catch(() => {})
  }

  // Subscribe to online users list
  listenOnlineUsers(callback) {
    if (!this.ready) return () => {}
    const ref = this.rtdb.ref('online')
    const handler = snapshot => {
      const data = snapshot.val() || {}
      const users = Object.entries(data)
        .filter(([, v]) => v.online)
        .map(([uid, v]) => ({ id: uid, username: v.username, avatar: v.avatar, lastSeen: v.lastSeen }))
      callback(users)
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  async saveProfile(uid, { username, email, avatar }) {
    if (!this.ready) return
    await this.rtdb.ref(`users/${uid}`).update({
      username, email,
      avatar: avatar || null,
      updatedAt: Date.now(),
    }).catch(e => this._log(`saveProfile error: ${e.message}`))
  }

  async getProfile(uid) {
    if (!this.ready) return null
    const snap = await this.rtdb.ref(`users/${uid}`).once('value').catch(() => null)
    return snap?.val() || null
  }

  // ── Avatar via Imgur ──────────────────────────────────────────────────────
  async uploadAvatar(uid, imageBase64, mimeType = 'image/jpeg') {
    try {
      const axios = require('axios')
      // Use Imgur anonymous upload (client_id from public API)
      const IMGUR_CLIENT_ID = 'b9e47286a22dc3b'  // public SEALM app client
      const res = await axios.post('https://api.imgur.com/3/image', {
        image: imageBase64,
        type:  'base64',
        title: 'SEALM Avatar',
      }, {
        headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        timeout: 30000,
      })

      if (res.data?.success) {
        const avatarUrl = res.data.data.link
        await this.saveProfile(uid, { avatar: avatarUrl })
        // Update online presence with new avatar
        if (this._uid === uid) {
          await this.rtdb.ref(`online/${uid}`).update({ avatar: avatarUrl }).catch(() => {})
        }
        return { success: true, url: avatarUrl }
      }
      return { success: false, error: 'Imgur upload failed' }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async sendMessage(uid, username, avatar, text, channel = 'general', toUid = null) {
    if (!this.ready || !text?.trim()) return { success: false }
    try {
      const msg = {
        uid, username,
        avatar: avatar || null,
        text:   text.trim(),
        ts:     Date.now(),
      }
      const ref = toUid
        ? this.rtdb.ref(`chat/dm/${this._dmRoom(uid, toUid)}`).push()
        : this.rtdb.ref(`chat/${channel}`).push()

      await ref.set(msg)
      return { success: true }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  listenMessages(channel, toUid, callback) {
    if (!this.ready) return () => {}
    const ref = toUid
      ? this.rtdb.ref(`chat/dm/${this._dmRoom(this._uid, toUid)}`).limitToLast(50)
      : this.rtdb.ref(`chat/${channel}`).limitToLast(50)

    const handler = snapshot => {
      const data = snapshot.val() || {}
      const msgs = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => a.ts - b.ts)
      callback(msgs)
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  listenNewMessages(channel, toUid, callback) {
    if (!this.ready) return () => {}
    const ref = toUid
      ? this.rtdb.ref(`chat/dm/${this._dmRoom(this._uid, toUid)}`).limitToLast(1)
      : this.rtdb.ref(`chat/${channel}`).limitToLast(1)

    // Skip first emission (existing messages)
    let first = true
    const handler = snapshot => {
      if (first) { first = false; return }
      const data = snapshot.val() || {}
      const msgs = Object.values(data)
      if (msgs.length) callback(msgs[msgs.length - 1])
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  setTyping(uid, username, channel) {
    if (!this.ready) return
    const ref = this.rtdb.ref(`typing/${channel}/${uid}`)
    ref.set({ username, ts: Date.now() })
    setTimeout(() => ref.remove().catch(() => {}), 3000)
  }

  listenTyping(channel, callback) {
    if (!this.ready) return () => {}
    const ref = this.rtdb.ref(`typing/${channel}`)
    const handler = snap => {
      const data = snap.val() || {}
      const now = Date.now()
      const typing = Object.entries(data)
        .filter(([uid, v]) => v.ts > now - 4000 && uid !== this._uid)
        .map(([uid, v]) => ({ uid, username: v.username }))
      callback(typing)
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  _dmRoom(uid1, uid2) {
    return [uid1, uid2].sort().join('_')
  }

  // ── Friends ───────────────────────────────────────────────────────────────
  async sendFriendRequest(fromUid, fromUsername, toUid) {
    if (!this.ready) return { success: false }
    try {
      // Check if already friends or pending
      const existing = await this.rtdb.ref(`friends/${fromUid}/${toUid}`).once('value')
      if (existing.val()) return { success: false, error: 'Request already sent' }

      const ts = Date.now()
      await this.rtdb.ref(`friends/${fromUid}/${toUid}`).set({
        status: 'pending', direction: 'sent', username: '', ts
      })
      await this.rtdb.ref(`friends/${toUid}/${fromUid}`).set({
        status: 'pending', direction: 'received', username: fromUsername, ts
      })
      // Notification
      await this.rtdb.ref(`notifications/${toUid}`).push({
        type: 'friend_request', from: fromUid, fromUsername, ts, read: false
      })
      return { success: true }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  async acceptFriendRequest(uid, fromUid, fromUsername) {
    if (!this.ready) return { success: false }
    try {
      await this.rtdb.ref(`friends/${uid}/${fromUid}`).update({ status: 'accepted' })
      await this.rtdb.ref(`friends/${fromUid}/${uid}`).update({ status: 'accepted' })
      await this.rtdb.ref(`notifications/${fromUid}`).push({
        type: 'friend_accepted', from: uid, fromUsername: this._username, ts: Date.now(), read: false
      })
      return { success: true }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  async removeFriend(uid, friendUid) {
    if (!this.ready) return { success: false }
    try {
      await this.rtdb.ref(`friends/${uid}/${friendUid}`).remove()
      await this.rtdb.ref(`friends/${friendUid}/${uid}`).remove()
      return { success: true }
    } catch(e) {
      return { success: false, error: e.message }
    }
  }

  async getFriends(uid) {
    if (!this.ready) return []
    const snap = await this.rtdb.ref(`friends/${uid}`).once('value').catch(() => null)
    if (!snap?.val()) return []
    const friends = snap.val()
    // Get online status for each friend
    const result = []
    for (const [fid, data] of Object.entries(friends)) {
      const onlineSnap = await this.rtdb.ref(`online/${fid}`).once('value').catch(() => null)
      const online = onlineSnap?.val() || {}
      result.push({
        id: fid,
        username: data.username || online.username || fid,
        status: data.status,
        direction: data.direction,
        is_online: online.online || false,
        avatar: online.avatar || null,
        lastSeen: online.lastSeen || 0,
      })
    }
    return result
  }

  listenFriends(uid, callback) {
    if (!this.ready) return () => {}
    const ref = this.rtdb.ref(`friends/${uid}`)
    const handler = async () => {
      const friends = await this.getFriends(uid)
      callback(friends)
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  listenNotifications(uid, callback) {
    if (!this.ready) return () => {}
    const ref = this.rtdb.ref(`notifications/${uid}`).orderByChild('read').equalTo(false)
    const handler = snap => {
      const data = snap.val() || {}
      callback(Object.entries(data).map(([id, n]) => ({ id, ...n })))
    }
    ref.on('value', handler)
    const unsub = () => ref.off('value', handler)
    this._listeners.push(unsub)
    return unsub
  }

  async markNotificationRead(uid, notifId) {
    if (!this.ready) return
    await this.rtdb.ref(`notifications/${uid}/${notifId}`).update({ read: true }).catch(() => {})
  }

  // ── Playtime sync ─────────────────────────────────────────────────────────
  async syncPlaytime(uid, gameTitle, minutesPlayed) {
    if (!this.ready || !uid) return
    try {
      const ref = this.rtdb.ref(`playtime/${uid}`)
      const snap = await ref.once('value')
      const current = snap.val() || { totalMinutes: 0, games: {} }

      const gameKey = gameTitle.replace(/[.#$[\]]/g, '_').slice(0, 50)
      const gameMins = (current.games?.[gameKey] || 0) + minutesPlayed
      const totalMins = (current.totalMinutes || 0) + minutesPlayed

      await ref.set({
        totalMinutes: totalMins,
        lastPlayed: Date.now(),
        games: { ...(current.games || {}), [gameKey]: gameMins },
      })
    } catch(e) {
      this._log(`Playtime sync error: ${e.message}`)
    }
  }

  async getPlaytime(uid) {
    if (!this.ready) return null
    const snap = await this.rtdb.ref(`playtime/${uid}`).once('value').catch(() => null)
    return snap?.val() || null
  }

  // Search users by username
  async searchUsers(query) {
    if (!this.ready) return []
    try {
      const snap = await this.rtdb.ref('users')
        .orderByChild('username')
        .startAt(query)
        .endAt(query + '\uf8ff')
        .limitToFirst(10)
        .once('value')
      const data = snap.val() || {}
      return Object.entries(data).map(([uid, u]) => ({ id: uid, ...u }))
    } catch(e) {
      return []
    }
  }

  // Register new user to Firebase
  async registerUser(uid, username, email) {
    if (!this.ready) return
    try {
      await this.rtdb.ref(`users/${uid}`).set({
        username, email,
        avatar: null,
        createdAt: Date.now(),
      })
    } catch(e) {
      this._log(`registerUser error: ${e.message}`)
    }
  }

  // Register IPC handlers
  register(ipcMain) {
    const h = (name, fn) => {
      try { ipcMain.handle(name, fn) } catch {}
    }

    h('firebase:sendMessage', async (_, { uid, username, avatar, text, channel, toUid }) => {
      return this.sendMessage(uid, username, avatar, text, channel || 'general', toUid)
    })

    h('firebase:sendFriendRequest', async (_, { fromUid, fromUsername, toUid }) => {
      return this.sendFriendRequest(fromUid, fromUsername, toUid)
    })

    h('firebase:acceptFriend', async (_, { uid, fromUid, fromUsername }) => {
      return this.acceptFriendRequest(uid, fromUid, fromUsername)
    })

    h('firebase:removeFriend', async (_, { uid, friendUid }) => {
      return this.removeFriend(uid, friendUid)
    })

    h('firebase:getFriends', async (_, { uid }) => {
      return this.getFriends(uid)
    })

    h('firebase:searchUsers', async (_, { query }) => {
      return this.searchUsers(query)
    })

    h('firebase:getPlaytime', async (_, { uid }) => {
      return this.getPlaytime(uid)
    })

    h('firebase:getProfile', async (_, { uid }) => {
      return this.getProfile(uid)
    })

    h('firebase:uploadAvatar', async (_, { uid, imageBase64, mimeType }) => {
      return this.uploadAvatar(uid, imageBase64, mimeType)
    })

    h('firebase:setTyping', async (_, { uid, username, channel }) => {
      this.setTyping(uid, username, channel)
      return { success: true }
    })

    h('firebase:markNotificationRead', async (_, { uid, notifId }) => {
      await this.markNotificationRead(uid, notifId)
      return { success: true }
    })

    h('firebase:ready', async () => ({ ready: this.ready }))
  }

  destroy() {
    clearInterval(this._heartbeat)
    this._listeners.forEach(unsub => { try { unsub() } catch {} })
    if (this._uid) this.setOffline(this._uid).catch(() => {})
  }
}

module.exports = FirebaseManager

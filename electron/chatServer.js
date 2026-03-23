/**
 * electron/chatServer.js
 *
 * WebSocket serwer czatu działający wewnątrz procesu głównego Electron.
 * Obsługuje:
 *  - kanał ogólny (broadcast do wszystkich)
 *  - wiadomości prywatne 1:1
 *  - status online/offline użytkowników
 *  - history replay przy połączeniu
 *  - heartbeat (ping/pong co 30s)
 *
 * Port domyślny: 45678 (localhost only — nie wystawiony na zewnątrz)
 */

let WebSocketServer, OPEN
try {
  const ws = require('ws')
  WebSocketServer = ws.WebSocketServer
  OPEN = ws.OPEN
} catch(e) {
  throw new Error('ws package not installed. Run: npm install ws')
}

const WS_PORT    = 45678
const PING_MS    = 30_000
const HISTORY_N  = 50      // ile ostatnich wiadomości wysłać przy połączeniu

class ChatServer {
  constructor(db) {
    this.db      = db
    this.wss     = null
    this.clients = new Map()   // userId → Set<ws>
    this.pingTimer = null
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  start() {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT })

    this.wss.on('connection', (ws) => {
      ws._userId   = null
      ws._username = null
      ws._alive    = true

      ws.on('pong', () => { ws._alive = true })

      ws.on('message', (raw) => {
        let msg
        try { msg = JSON.parse(raw) } catch { return }
        this._handleMessage(ws, msg)
      })

      ws.on('close', () => this._handleDisconnect(ws))
      ws.on('error', (err) => console.error('[ChatServer] ws error:', err.message))
    })

    this.wss.on('error', (err) => {
      console.error('[ChatServer] server error:', err.message)
    })

    // Heartbeat — drop stale connections
    this.pingTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws._alive) { ws.terminate(); return }
        ws._alive = false
        ws.ping()
      })
    }, PING_MS)

    console.log(`[ChatServer] listening on ws://127.0.0.1:${WS_PORT}`)
    return WS_PORT
  }

  // ── Handle incoming message ────────────────────────────────────────────────
  _handleMessage(ws, msg) {
    switch (msg.type) {

      // Client authenticates right after connect
      case 'auth': {
        const session = this.db.prepare(`
          SELECT s.user_id, u.username
          FROM sessions s JOIN users u ON s.user_id = u.id
          WHERE s.token = ? AND s.expires_at > strftime('%s','now')
        `).get(msg.token)

        if (!session) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Nieprawidłowy token' }))
          ws.terminate()
          return
        }

        ws._userId   = session.user_id
        ws._username = session.username

        // Register in client map
        if (!this.clients.has(ws._userId)) this.clients.set(ws._userId, new Set())
        this.clients.get(ws._userId).add(ws)

        // Send auth OK
        this._send(ws, { type: 'auth_ok', userId: ws._userId, username: ws._username })

        // Replay recent general history
        const history = this.db.prepare(`
          SELECT m.*, u.username
          FROM messages m JOIN users u ON m.sender_id = u.id
          WHERE m.channel = 'general'
          ORDER BY m.sent_at DESC LIMIT ${HISTORY_N}
        `).all().reverse()
        this._send(ws, { type: 'history', messages: history })

        // Broadcast updated online list to everyone
        this._broadcastOnlineList()
        break
      }

      // Send a message to channel or DM
      case 'message': {
        if (!ws._userId) return
        const { v4: uuidv4 } = require('uuid')
        const id = uuidv4()
        const body = (msg.body || '').trim().slice(0, 2000)
        if (!body) return

        const channel    = msg.channel    || 'general'
        const receiverId = msg.receiverId || null

        // Persist
        this.db.prepare(
          'INSERT INTO messages (id, sender_id, receiver_id, channel, body) VALUES (?, ?, ?, ?, ?)'
        ).run(id, ws._userId, receiverId, channel, body)

        const saved = this.db.prepare(`
          SELECT m.*, u.username
          FROM messages m JOIN users u ON m.sender_id = u.id
          WHERE m.id = ?
        `).get(id)

        const packet = { type: 'message', message: saved }

        if (channel === 'general') {
          // Broadcast to all authenticated clients
          this._broadcast(packet)
        } else if (receiverId) {
          // DM: send to sender + receiver only
          this._sendToUser(ws._userId, packet)
          this._sendToUser(receiverId, packet)
        }
        break
      }

      // Typing indicator
      case 'typing': {
        if (!ws._userId) return
        const packet = {
          type: 'typing',
          userId:   ws._userId,
          username: ws._username,
          channel:  msg.channel || 'general',
          peerId:   msg.peerId  || null,
        }
        if (msg.channel === 'general') {
          this._broadcastExcept(ws._userId, packet)
        } else if (msg.peerId) {
          this._sendToUser(msg.peerId, packet)
        }
        break
      }

      default:
        break
    }
  }

  // ── Handle disconnect ──────────────────────────────────────────────────────
  _handleDisconnect(ws) {
    if (!ws._userId) return
    const sockets = this.clients.get(ws._userId)
    if (sockets) {
      sockets.delete(ws)
      if (sockets.size === 0) this.clients.delete(ws._userId)
    }
    this._broadcastOnlineList()
  }

  // ── Broadcast online user list ─────────────────────────────────────────────
  _broadcastOnlineList() {
    const onlineIds = Array.from(this.clients.keys())
    if (onlineIds.length === 0) return

    // Fetch usernames from DB
    const placeholders = onlineIds.map(() => '?').join(',')
    const users = this.db.prepare(
      `SELECT id, username FROM users WHERE id IN (${placeholders})`
    ).all(...onlineIds)

    this._broadcast({ type: 'online_list', users })
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _send(ws, data) {
    if (ws.readyState === OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  _broadcast(data) {
    const payload = JSON.stringify(data)
    this.wss.clients.forEach((ws) => {
      if (ws._userId && ws.readyState === OPEN) ws.send(payload)
    })
  }

  _broadcastExcept(excludeUserId, data) {
    const payload = JSON.stringify(data)
    this.wss.clients.forEach((ws) => {
      if (ws._userId && ws._userId !== excludeUserId && ws.readyState === OPEN) {
        ws.send(payload)
      }
    })
  }

  _sendToUser(userId, data) {
    const sockets = this.clients.get(userId)
    if (!sockets) return
    const payload = JSON.stringify(data)
    sockets.forEach((ws) => {
      if (ws.readyState === OPEN) ws.send(payload)
    })
  }

  // ── Stats (for IPC) ────────────────────────────────────────────────────────
  getOnlineCount() {
    return this.clients.size
  }

  getOnlineUsers() {
    return Array.from(this.clients.keys())
  }

  // ── Shutdown ───────────────────────────────────────────────────────────────
  stop() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.wss) this.wss.close()
  }
}

module.exports = { ChatServer, WS_PORT }

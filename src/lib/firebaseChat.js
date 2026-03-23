// src/lib/firebaseChat.js — Real-time global chat via Firebase
import {
  ref, push, onValue, off, serverTimestamp, query,
  orderByChild, limitToLast, set, onDisconnect,
} from 'firebase/database'
import { db } from './firebase'

const MESSAGES_LIMIT = 100

// ── Send message ──────────────────────────────────────────────────────────────
export async function sendMessage({ channelId = 'general', userId, username, body }) {
  const channelRef = ref(db, `chat/${channelId}`)
  await push(channelRef, {
    userId,
    username,
    body: body.trim(),
    sentAt: serverTimestamp(),
  })
}

// ── Subscribe to messages ─────────────────────────────────────────────────────
export function subscribeMessages(channelId = 'general', callback) {
  const q = query(
    ref(db, `chat/${channelId}`),
    orderByChild('sentAt'),
    limitToLast(MESSAGES_LIMIT)
  )
  const handler = (snap) => {
    const msgs = []
    snap.forEach(child => {
      msgs.push({ id: child.key, ...child.val() })
    })
    callback(msgs)
  }
  onValue(q, handler)
  return () => off(q, 'value', handler)
}

// ── Online presence ───────────────────────────────────────────────────────────
export function setOnline(uid, username) {
  if (!uid) return
  try {
    const presenceRef = ref(db, `presence/${uid}`)
    const usersRef    = ref(db, `users/${uid}`)
    const now = serverTimestamp()
    set(presenceRef, { uid, username, online: true, lastSeen: now })
    // Update users node too
    import('firebase/database').then(({ update }) => {
      update(usersRef, { online: true, lastSeen: now })
    }).catch(() => {})
    // Auto set offline on disconnect
    onDisconnect(presenceRef).update({ online: false, lastSeen: now })
    onDisconnect(usersRef).update({ online: false, lastSeen: now })
  } catch(e) { console.warn('[setOnline]', e.message) }
}

export function subscribeOnlineUsers(callback) {
  const presenceRef = ref(db, 'presence')
  const handler = (snap) => {
    const users = []
    snap.forEach(child => {
      const u = child.val()
      if (u.online) users.push(u)
    })
    callback(users)
  }
  onValue(presenceRef, handler)
  return () => off(presenceRef, 'value', handler)
}

// ── Typing indicator ──────────────────────────────────────────────────────────
export function setTyping(channelId, uid, username, isTyping) {
  const typingRef = ref(db, `typing/${channelId}/${uid}`)
  if (isTyping) {
    set(typingRef, { username, ts: Date.now() })
    onDisconnect(typingRef).remove()
  } else {
    set(typingRef, null)
  }
}

export function subscribeTyping(channelId, callback) {
  const typingRef = ref(db, `typing/${channelId}`)
  const handler = (snap) => {
    const typers = []
    const now = Date.now()
    snap.forEach(child => {
      const t = child.val()
      if (t && now - t.ts < 5000) typers.push(t.username)
    })
    callback(typers)
  }
  onValue(typingRef, handler)
  return () => off(typingRef, 'value', handler)
}

// ── Set offline ───────────────────────────────────────────────────────────────
export async function setOffline(uid) {
  if (!uid) return
  try {
    const { ref, update, serverTimestamp } = await import('firebase/database')
    const { db } = await import('./firebase')
    const now = serverTimestamp()
    // Update both presence AND users node
    await Promise.all([
      update(ref(db, `presence/${uid}`), { online: false, lastSeen: now }),
      update(ref(db, `users/${uid}`),    { online: false, lastSeen: now }),
    ])
  } catch(e) { console.warn('[setOffline]', e.message) }
}

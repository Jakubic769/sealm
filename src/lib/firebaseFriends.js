// src/lib/firebaseFriends.js — Friends system via Firebase
import {
  ref, set, get, push, onValue, off, remove, serverTimestamp, query, orderByChild, equalTo
} from 'firebase/database'
import { db } from './firebase'

// ── Send friend request ───────────────────────────────────────────────────────
export async function sendFriendRequest(fromUid, fromUsername, toUid) {
  // Check not already friends
  const existingSnap = await get(ref(db, `friends/${toUid}/${fromUid}`))
  if (existingSnap.exists()) return { success: false, error: 'Already friends' }

  // Check no pending request
  const pendingSnap = await get(ref(db, `friendRequests/${toUid}/${fromUid}`))
  if (pendingSnap.exists()) return { success: false, error: 'Request already sent' }

  await set(ref(db, `friendRequests/${toUid}/${fromUid}`), {
    fromUid,
    fromUsername,
    sentAt: serverTimestamp(),
  })
  return { success: true }
}

// ── Accept friend request ─────────────────────────────────────────────────────
export async function acceptFriendRequest(myUid, myUsername, fromUid) {
  // Get from username
  const reqSnap = await get(ref(db, `friendRequests/${myUid}/${fromUid}`))
  if (!reqSnap.exists()) return { success: false, error: 'Request not found' }
  const req = reqSnap.val()

  // Add both ways
  await set(ref(db, `friends/${myUid}/${fromUid}`), {
    uid: fromUid, username: req.fromUsername, since: serverTimestamp()
  })
  await set(ref(db, `friends/${fromUid}/${myUid}`), {
    uid: myUid, username: myUsername, since: serverTimestamp()
  })
  // Remove request
  await remove(ref(db, `friendRequests/${myUid}/${fromUid}`))
  return { success: true }
}

// ── Decline / remove friend ───────────────────────────────────────────────────
export async function declineFriendRequest(myUid, fromUid) {
  await remove(ref(db, `friendRequests/${myUid}/${fromUid}`))
  return { success: true }
}

export async function removeFriend(myUid, friendUid) {
  await remove(ref(db, `friends/${myUid}/${friendUid}`))
  await remove(ref(db, `friends/${friendUid}/${myUid}`))
  return { success: true }
}

// ── Subscribe to friends list ─────────────────────────────────────────────────
export function subscribeFriends(uid, callback) {
  const friendsRef = ref(db, `friends/${uid}`)
  const handler = async (snap) => {
    const friends = []
    const promises = []
    snap.forEach(child => {
      const f = child.val()
      promises.push(
        get(ref(db, `presence/${f.uid}`)).then(pSnap => {
          const presence = pSnap.val() || {}
          friends.push({ ...f, is_online: presence.online || false })
        })
      )
    })
    await Promise.all(promises)
    callback(friends)
  }
  onValue(friendsRef, handler)
  return () => off(friendsRef, 'value', handler)
}

// ── Subscribe to pending requests ─────────────────────────────────────────────
export function subscribePendingRequests(uid, callback) {
  const reqRef = ref(db, `friendRequests/${uid}`)
  const handler = (snap) => {
    const requests = []
    snap.forEach(child => requests.push({ id: child.key, ...child.val() }))
    callback(requests)
  }
  onValue(reqRef, handler)
  return () => off(reqRef, 'value', handler)
}

// ── Search users by username ──────────────────────────────────────────────────
export async function searchUsers(searchTerm) {
  const snap = await get(ref(db, 'users'))
  const results = []
  snap.forEach(child => {
    const u = child.val()
    if (u.username?.toLowerCase().includes(searchTerm.toLowerCase())) {
      results.push({ uid: child.key, username: u.username, avatarUrl: u.avatarUrl })
    }
  })
  return results.slice(0, 10)
}

// ── Sync playtime to Firebase ─────────────────────────────────────────────────
export async function syncPlaytime(uid, totalMinutes, gamesCount) {
  await set(ref(db, `users/${uid}/playtimeMinutes`), totalMinutes)
  await set(ref(db, `users/${uid}/gamesCount`), gamesCount)
}

// ── Sync user stats to Firebase ───────────────────────────────────────────────
export async function syncUserStats(uid, { playtimeMinutes, gamesCount, lastPlayed }) {
  const updates = {}
  if (playtimeMinutes !== undefined) updates.playtimeMinutes = playtimeMinutes
  if (gamesCount      !== undefined) updates.gamesCount      = gamesCount
  if (lastPlayed      !== undefined) updates.lastPlayed      = lastPlayed
  if (Object.keys(updates).length === 0) return
  try {
    const { ref, update } = await import('firebase/database')
    const { db } = await import('./firebase')
    await update(ref(db, `users/${uid}`), updates)
  } catch(e) { console.warn('[syncUserStats]', e.message) }
}

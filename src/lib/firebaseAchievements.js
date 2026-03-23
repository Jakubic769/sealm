// src/lib/firebaseAchievements.js — Achievements synced to Firebase Realtime DB
import { ref, set, get, update, push, serverTimestamp, onValue, off } from 'firebase/database'
import { db } from './firebase'

export const ACHIEVEMENTS = [
  { key: 'first_login',    title: 'Welcome to SEALM', desc: 'Log in for the first time',              icon: '🎮', points: 10  },
  { key: 'first_download', title: 'Downloader',        desc: 'Download your first game',              icon: '⬇',  points: 15  },
  { key: 'library_5',      title: 'Collector',         desc: 'Add 5 games to your library',           icon: '📚', points: 20  },
  { key: 'library_10',     title: 'Librarian',         desc: 'Add 10 games to your library',          icon: '🏛',  points: 40  },
  { key: 'playtime_10h',   title: 'Getting Hooked',    desc: 'Play a total of 10 hours',              icon: '⏱',  points: 25  },
  { key: 'playtime_100h',  title: 'No Life',           desc: 'Play a total of 100 hours',             icon: '💀', points: 100 },
  { key: 'playtime_500h',  title: 'Legend',            desc: 'Play a total of 500 hours',             icon: '👑', points: 500 },
  { key: 'first_review',   title: 'Critic',            desc: 'Write your first review',               icon: '✍',  points: 10  },
  { key: 'reviews_10',     title: 'Reviewer',          desc: 'Write 10 reviews',                      icon: '📝', points: 50  },
  { key: 'chat_100',       title: 'Chatterbox',        desc: 'Send 100 chat messages',                icon: '💬', points: 30  },
  { key: 'first_friend',   title: 'First Friend',      desc: 'Add your first friend',                 icon: '🤝', points: 15  },
  { key: 'friends_5',      title: 'Popular',           desc: 'Have 5 friends at the same time',       icon: '👥', points: 40  },
  { key: 'night_owl',      title: 'Night Owl',         desc: 'Play between 2:00 and 5:00 AM',         icon: '🦉', points: 20  },
  { key: 'speed_runner',   title: 'Speed Runner',      desc: 'Launch a game within 10s of login',     icon: '⚡', points: 30  },
]

// ── Unlock achievement ────────────────────────────────────────────────────────
export async function unlockAchievement(uid, key) {
  if (!uid || !key) return false
  try {
    const ach = ACHIEVEMENTS.find(a => a.key === key)
    if (!ach) return false

    // Check if already unlocked
    const snap = await get(ref(db, `achievements/${uid}/${key}`))
    if (snap.exists()) return false  // already unlocked

    // Save to Firebase
    await set(ref(db, `achievements/${uid}/${key}`), {
      key,
      title:       ach.title,
      icon:        ach.icon,
      points:      ach.points,
      unlockedAt:  serverTimestamp(),
    })

    // Update total points in users node
    const userSnap = await get(ref(db, `users/${uid}/achievementPoints`))
    const current = userSnap.val() || 0
    await update(ref(db, `users/${uid}`), {
      achievementPoints: current + ach.points,
    })

    return ach  // return achievement data for toast notification
  } catch(e) {
    console.warn('[unlockAchievement]', e.message)
    return false
  }
}

// ── Check and unlock based on event ──────────────────────────────────────────
export async function checkAchievements(uid, event, data = {}) {
  if (!uid) return []
  const unlocked = []

  try {
    switch(event) {
      case 'login': {
        const r = await unlockAchievement(uid, 'first_login')
        if (r) unlocked.push(r)
        // Speed runner — check if launched game within 10s
        if (data.loginTime && Date.now() - data.loginTime < 10000) {
          const r2 = await unlockAchievement(uid, 'speed_runner')
          if (r2) unlocked.push(r2)
        }
        break
      }
      case 'download': {
        const r = await unlockAchievement(uid, 'first_download')
        if (r) unlocked.push(r)
        break
      }
      case 'library': {
        const count = data.count || 0
        if (count >= 5)  { const r = await unlockAchievement(uid, 'library_5');  if (r) unlocked.push(r) }
        if (count >= 10) { const r = await unlockAchievement(uid, 'library_10'); if (r) unlocked.push(r) }
        break
      }
      case 'playtime': {
        const totalHours = (data.totalMinutes || 0) / 60
        if (totalHours >= 10)  { const r = await unlockAchievement(uid, 'playtime_10h');  if (r) unlocked.push(r) }
        if (totalHours >= 100) { const r = await unlockAchievement(uid, 'playtime_100h'); if (r) unlocked.push(r) }
        if (totalHours >= 500) { const r = await unlockAchievement(uid, 'playtime_500h'); if (r) unlocked.push(r) }
        // Night Owl — check time
        const hour = new Date().getHours()
        if (hour >= 2 && hour < 5) {
          const r2 = await unlockAchievement(uid, 'night_owl')
          if (r2) unlocked.push(r2)
        }
        break
      }
      case 'review': {
        const count = data.count || 1
        if (count >= 1)  { const r = await unlockAchievement(uid, 'first_review'); if (r) unlocked.push(r) }
        if (count >= 10) { const r = await unlockAchievement(uid, 'reviews_10');   if (r) unlocked.push(r) }
        break
      }
      case 'chat': {
        const count = data.count || 0
        if (count >= 100) { const r = await unlockAchievement(uid, 'chat_100'); if (r) unlocked.push(r) }
        break
      }
      case 'friend': {
        const count = data.count || 0
        if (count >= 1) { const r = await unlockAchievement(uid, 'first_friend'); if (r) unlocked.push(r) }
        if (count >= 5) { const r = await unlockAchievement(uid, 'friends_5');    if (r) unlocked.push(r) }
        break
      }
    }
  } catch(e) {
    console.warn('[checkAchievements]', e.message)
  }

  return unlocked
}

// ── Get all achievements for user ─────────────────────────────────────────────
export async function getUserAchievements(uid) {
  if (!uid) return { list: ACHIEVEMENTS.map(a => ({ ...a, unlocked: false })), unlocked: 0, total: ACHIEVEMENTS.length, points: 0, percent: 0 }
  try {
    const snap = await get(ref(db, `achievements/${uid}`))
    const unlockedMap = snap.val() || {}
    console.log('[achievements] loaded:', Object.keys(unlockedMap))
    const list = ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked:   !!unlockedMap[a.key],
      unlockedAt: unlockedMap[a.key]?.unlockedAt || null,
    }))
    const unlockedCount = list.filter(a => a.unlocked).length
    const totalPoints   = list.filter(a => a.unlocked).reduce((s, a) => s + a.points, 0)
    return {
      list,
      unlocked: unlockedCount,
      total:    ACHIEVEMENTS.length,
      points:   totalPoints,
      percent:  Math.round(unlockedCount / ACHIEVEMENTS.length * 100),
    }
  } catch(e) {
    console.error('[achievements] load error:', e.code, e.message)
    return { list: ACHIEVEMENTS.map(a => ({ ...a, unlocked: false })), unlocked: 0, total: ACHIEVEMENTS.length, points: 0, percent: 0 }
  }
}

// ── Subscribe to achievements (realtime) ──────────────────────────────────────
export function subscribeAchievements(uid, callback) {
  if (!uid) {
    callback({ list: ACHIEVEMENTS.map(a => ({ ...a, unlocked: false })), unlocked: 0, total: ACHIEVEMENTS.length, points: 0, percent: 0 })
    return () => {}
  }
  const achRef = ref(db, `achievements/${uid}`)
  const handler = (snap) => {
    const unlockedMap = snap.val() || {}
    // Always return all achievements, marking unlocked ones
    const list = ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked:   !!unlockedMap[a.key],
      unlockedAt: unlockedMap[a.key]?.unlockedAt || null,
    }))
    const unlockedCount = list.filter(a => a.unlocked).length
    const totalPoints   = list.filter(a => a.unlocked).reduce((s, a) => s + a.points, 0)
    callback({
      list,
      unlocked: unlockedCount,
      total:    ACHIEVEMENTS.length,
      points:   totalPoints,
      percent:  Math.round(unlockedCount / ACHIEVEMENTS.length * 100),
    })
  }
  onValue(achRef, handler)
  return () => off(achRef, 'value', handler)
}

// ── Track counters in Firebase ────────────────────────────────────────────────
export async function incrementCounter(uid, counter) {
  if (!uid) return 0
  try {
    const snap = await get(ref(db, `counters/${uid}/${counter}`))
    const val  = (snap.val() || 0) + 1
    await set(ref(db, `counters/${uid}/${counter}`), val)
    return val
  } catch { return 0 }
}

export async function getCounter(uid, counter) {
  if (!uid) return 0
  try {
    const snap = await get(ref(db, `counters/${uid}/${counter}`))
    return snap.val() || 0
  } catch { return 0 }
}

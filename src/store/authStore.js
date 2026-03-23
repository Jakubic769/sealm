// src/store/authStore.js — Auth via Firebase
import { create } from 'zustand'
import toast from 'react-hot-toast'
import { firebaseLogin, firebaseRegister, firebaseLogout, firebaseUpdateProfile } from '../lib/firebaseAuth'
import { checkAchievements } from '../lib/firebaseAchievements'
import { syncUserStats } from '../lib/firebaseFriends'
import { setOnline, setOffline } from '../lib/firebaseChat'
import { syncPlaytime } from '../lib/firebaseFriends'

export const useAuthStore = create((set, get) => ({
  user:    null,
  loading: true,

  // ── Register ────────────────────────────────────────────────────────────────
  register: async ({ username, email, password }) => {
    set({ loading: true })
    try {
      const result = await firebaseRegister({ username, email, password })
      if (result.success) {
        set({ user: result.user, loading: false })
        window._sealmUser = result.user
        setOnline(result.user.uid, result.user.username)
        toast.success(`Welcome, ${result.user.username}! 🎮`)
        setTimeout(() => {
          window.sealm?.achievements?.trigger?.({ event: 'login', userId: result.user.uid, username: result.user.username, email: result.user.email })
        }, 1000)
        return { success: true }
      }
      set({ loading: false })
      return { success: false, error: result.error }
    } catch(e) {
      set({ loading: false })
      return { success: false, error: e.message }
    }
  },

  // ── Login ───────────────────────────────────────────────────────────────────
  login: async ({ email, password }) => {
    set({ loading: true })
    try {
      const result = await firebaseLogin({ email, password })
      if (result.success) {
        set({ user: result.user, loading: false })
        window._sealmUser = result.user
        setOnline(result.user.uid, result.user.username)
        toast.success(`Welcome back, ${result.user.username}! 🎮`)
        setTimeout(() => {
          window.sealm?.achievements?.trigger?.({ event: 'login', userId: result.user.uid, username: result.user.username, email: result.user.email })
        }, 1000)
        return { success: true }
      }
      set({ loading: false })
      return { success: false, error: result.error }
    } catch(e) {
      set({ loading: false })
      return { success: false, error: e.message }
    }
  },

  // ── Logout ──────────────────────────────────────────────────────────────────
  logout: async () => {
    const { user } = get()
    const uid = user?.uid || user?.id
    if (uid) await setOffline(uid)
    await firebaseLogout(uid)
    set({ user: null })
    window._sealmUser = null
  },

  // ── Update profile ──────────────────────────────────────────────────────────
  updateProfile: async (updates) => {
    const { user } = get()
    if (!user) return { success: false, error: 'Not logged in' }

    // Cooldown checks (7 days username, 3 days password)
    const now = Math.floor(Date.now() / 1000)
    const DAY = 86400
    if (updates.username && updates.username !== user.username) {
      const lastChange = user.username_changed_at || 0
      const daysLeft = Math.ceil(7 - (now - lastChange) / DAY)
      if (daysLeft > 0) return { success: false, error: `Username can be changed in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` }
    }

    const result = await firebaseUpdateProfile({ uid: user.uid, ...updates })
    if (result.success) {
      const updatedUser = {
        ...user,
        ...(updates.username && { username: updates.username, username_changed_at: now }),
        ...(updates.avatarUrl !== undefined && { avatarUrl: updates.avatarUrl }),
        ...(updates.bio !== undefined && { bio: updates.bio }),
      }
      set({ user: updatedUser })
      window._sealmUser = updatedUser
    }
    return result
  },

  // ── Sync playtime to Firebase ───────────────────────────────────────────────
  syncPlaytime: async (totalMinutes, gamesCount) => {
    const { user } = get()
    if (user?.uid) {
      await syncPlaytime(user.uid, totalMinutes, gamesCount).catch(() => {})
    }
  },

  // ── Validate session (app start) ────────────────────────────────────────────
  validate: async () => {
    set({ loading: false })
    return { success: true }
  },

  // ── Sync stats to Firebase ───────────────────────────────────────────────────
  syncStats: async () => {
    const { user } = useAuthStore.getState()
    const uid = user?.uid || user?.id
    if (!uid || !window.sealm?.library?.list) return
    try {
      const lib = await window.sealm.library.list({ userId: uid })
      if (!lib) return
      const totalMin   = lib.reduce((s, i) => s + (i.playtime_min || 0), 0)
      const gamesCount = lib.length
      await syncUserStats(uid, { playtimeMinutes: totalMin, gamesCount })
      // Check playtime achievements
      const unlocked = await checkAchievements(uid, 'playtime', { totalMinutes: totalMin })
      unlocked.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
      // Check library achievements
      const unlocked2 = await checkAchievements(uid, 'library', { count: gamesCount })
      unlocked2.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
    } catch(e) { console.warn('[syncStats]', e.message) }
  },

  setUser: (user) => {
    set({ user })
    window._sealmUser = user
  },

  setLoading: (loading) => set({ loading }),
}))

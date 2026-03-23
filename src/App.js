import React, { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import { onAuthChange } from './lib/firebaseAuth'
import { setOnline } from './lib/firebaseChat'
import { get, ref } from 'firebase/database'
import { db } from './lib/firebase'

import AuthLayout        from './components/auth/AuthLayout'
import AppLayout         from './components/layout/AppLayout'
import LibraryPage       from './components/library/LibraryPage'
import DownloadsPage     from './components/downloads/DownloadsPage'
import ChatPage          from './components/chat/ChatPage'
import SettingsPage      from './components/settings/SettingsPage'
import ProfilePage       from './components/profile/ProfilePage'
import GameDetailPage    from './components/game/GameDetailPage'
import AchievementsPage  from './components/achievements/AchievementsPage'
import FitGirlPage       from './components/fitgirl/FitGirlPage'
import FitGirlDetailPage from './components/fitgirl/FitGirlDetailPage'
import FriendsPage       from './components/friends/FriendsPage'
import AchievementToastProvider from './components/ui/AchievementToast'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg-base)' }}>
      <div style={{ fontFamily:'var(--font-display)', color:'var(--accent-violet-bright)', letterSpacing:3, fontSize:13 }}>
        LOADING…
      </div>
    </div>
  )
  return user ? children : <Navigate to="/auth" replace />
}

export default function App() {
  const { setUser, setLoading } = useAuthStore()

  useEffect(() => {
    // Listen to Firebase auth state — handles session persistence automatically
    const unsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        // Get profile from Realtime DB
        try {
          const snap = await get(ref(db, `users/${firebaseUser.uid}`))
          const profile = snap.val() || {}
          const user = {
            id:        firebaseUser.uid,
            uid:       firebaseUser.uid,
            username:  profile.username || firebaseUser.displayName || firebaseUser.email.split('@')[0],
            email:     firebaseUser.email,
            avatarUrl: profile.avatarUrl || null,
            bio:       profile.bio || '',
          }
          setUser(user)
          window._sealmUser = user
          setOnline(user.uid, user.username)
          // Ensure local SQLite user exists BEFORE any achievements trigger
          if (window.sealm?.users?.ensureLocal) {
            window.sealm.users.ensureLocal({ userId: user.uid, username: user.username, email: user.email })
          }
        } catch(e) {
          console.error('Profile load error:', e)
          setUser(null)
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    // Set offline when app is closing
    const handleBeforeQuit = async () => {
      try {
        const uid = window._sealmUser?.uid || window._sealmUser?.id
        if (uid) {
          const { setOffline } = await import('./lib/firebaseChat')
          await setOffline(uid)
        }
      } catch {}
    }

    // Listen via preload bridge
    const ipcPreload = window.sealm
    if (ipcPreload) {
      // Use addEventListener on window for custom events from preload
      window.addEventListener('sealm:before-quit', handleBeforeQuit)
    }

    // Also handle page unload
    window.addEventListener('beforeunload', handleBeforeQuit)

    // Sync playtime to Firebase when game session ends
    const handlePlaytimeUpdate = () => {
      // Import dynamically to avoid circular deps
      import('./store/authStore').then(({ useAuthStore }) => {
        useAuthStore.getState().syncStats?.()
      }).catch(() => {})
    }
    if (window.sealm?.torrent?.onProgress) {
      // Listen for playtime:updated via IPC events
      const electron = window.require?.('electron')
      electron?.ipcRenderer?.on('playtime:updated', handlePlaytimeUpdate)
    }

    // Navigation from tray
    if (window.sealm?.onNavigate) {
      const unsubNav = window.sealm.onNavigate(route => { window.location.hash = route })
      return () => { unsub(); unsubNav() }
    }
    return unsub
  }, [])

  return (
    <HashRouter>
      <AchievementToastProvider>
        <Toaster position="bottom-right" toastOptions={{
          style: { background:'#1e2a3a', color:'#f0f4ff', border:'1px solid rgba(139,92,246,0.35)', fontFamily:"'Exo 2', sans-serif", fontSize:'13px', borderRadius:'8px' },
          success: { iconTheme: { primary:'#10b981', secondary:'#f0f4ff' } },
          error:   { iconTheme: { primary:'#ef4444', secondary:'#f0f4ff' } },
        }}/>

        <Routes>
          <Route path="/auth" element={<AuthLayout/>}/>
          <Route path="/" element={<ProtectedRoute><AppLayout/></ProtectedRoute>}>
            <Route index                                    element={<Navigate to="/fitgirl" replace/>}/>
            <Route path="library"                           element={<LibraryPage/>}/>
            <Route path="downloads"                         element={<DownloadsPage/>}/>
            <Route path="chat"                              element={<ChatPage/>}/>
            <Route path="settings"                          element={<SettingsPage/>}/>
            <Route path="profile"                           element={<ProfilePage/>}/>
            <Route path="game/:id"                          element={<GameDetailPage/>}/>
            <Route path="achievements"                      element={<AchievementsPage/>}/>
            <Route path="fitgirl"                           element={<FitGirlPage/>}/>
            <Route path="fitgirl/game/:source/:slug"        element={<FitGirlDetailPage/>}/>
            <Route path="friends"                           element={<FriendsPage/>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </AchievementToastProvider>
    </HashRouter>
  )
}

import { create } from 'zustand'
import toast from 'react-hot-toast'
import { waitForSealm } from '../lib/sealm'

export const useDownloadsStore = create((set, get) => ({
  downloads:       [],
  loading:         false,
  _unsubscribers:  [],
  _pollInterval:   null,

  fetch: async (userId) => {
    try {
      const sealm = await waitForSealm()
      set({ loading: true })
      const downloads = await sealm.downloads.list({ userId })
      set({ downloads: downloads || [] })
    } catch (e) {
      console.warn('[downloads] fetch:', e.message)
    } finally {
      set({ loading: false })
    }
  },

  addDownload: async ({ userId, gameId, gameTitle, magnetUri }) => {
    try {
      const sealm = await waitForSealm()
      const result = await sealm.downloads.add({ userId, gameId, magnetUri })
      if (result.success) {
        toast.success(`⬇ Added to queue: ${gameTitle}`)
        await get().fetch(userId)
        if (magnetUri) {
          const dl = get().downloads.find(d => d.game_id === gameId && d.status === 'queued')
          if (dl) {
            await sealm.torrent.start({ downloadId: dl.id, magnetUri, savePath: null })
          }
        }
      } else {
        toast.error(result.error)
      }
      return result
    } catch (e) {
      toast.error('Error adding to queue')
      return { success: false, error: e.message }
    }
  },

  removeDownload: async ({ id, userId, magnetUri }) => {
    try {
      const sealm = await waitForSealm()
      if (magnetUri) await sealm.torrent.remove({ magnetUri, deleteFiles: false }).catch(() => {})
      await sealm.downloads.remove({ id })
      get().fetch(userId)
    } catch (e) {
      console.warn('[downloads] remove:', e.message)
    }
  },

  subscribeToTorrentEvents: async (userId) => {
    try {
      const sealm = await waitForSealm()
      const unsubProgress = sealm.torrent.onProgress((data) => {
        set(state => ({
          downloads: state.downloads.map(d =>
            d.id === data.downloadId
              ? { ...d, progress: data.progress, speed_kbps: data.speedKbps, eta_seconds: data.etaSec, status: 'downloading' }
              : d
          )
        }))
      })
      const unsubDone = sealm.torrent.onDone((data) => {
        set(state => ({
          downloads: state.downloads.map(d =>
            d.id === data.downloadId ? { ...d, progress: 100, status: 'completed' } : d
          )
        }))
        const dl = get().downloads.find(d => d.id === data.downloadId)
        if (dl) {
          toast.success(`✅ Downloaded: ${dl.title}`)
          sealm.notifications.notifyDownloadDone({ gameTitle: dl.title, sizeMB: (dl.size_gb || 0) * 1024 })
        }
        // Report done to main process → triggers achievements (download + library)
        sealm.torrent.reportDone?.({ downloadId: data.downloadId })
        // Also trigger via IPC directly
        const user = window._sealmUser
        if (user?.id) {
          sealm.achievements?.trigger?.({ event: 'download', userId: user.uid || user.id })
        }
      })
      const unsubError = sealm.torrent.onError((data) => {
        set(state => ({
          downloads: state.downloads.map(d =>
            d.id === data.downloadId ? { ...d, status: 'error' } : d
          )
        }))
        toast.error('⚠ Download failed')
      })

      const unsubInstalled = typeof sealm.torrent.onInstalled === 'function'
        ? sealm.torrent.onInstalled((data) => {
            toast.success(`🎮 Gra zainstalowana: ${data.gameTitle || ''}`, { duration: 6000 })
          })
        : () => {}

      const unsubInstaller = typeof sealm.torrent.onInstallerLaunched === 'function'
        ? sealm.torrent.onInstallerLaunched((data) => {
            toast(`🔧 Uruchomiono instalator: ${data.gameTitle || ''}`, { icon: '🔧', duration: 4000 })
          })
        : () => {}

      set({ _unsubscribers: [unsubProgress, unsubDone, unsubError, unsubInstalled, unsubInstaller] })
    } catch (e) {
      console.warn('[downloads] subscribeToTorrentEvents:', e.message)
    }
  },

  // Symulacja postępu gdy torrent client niedostępny
  startPolling: (userId) => {
    const existing = get()._pollInterval
    if (existing) clearInterval(existing)
    const interval = setInterval(() => {
      set(state => ({
        downloads: state.downloads.map(d => {
          if (d.status !== 'downloading') return d
          const newProgress = Math.min(100, (d.progress || 0) + Math.random() * 0.5)
          const speed = 3000 + Math.random() * 12000
          if (newProgress >= 100) {
            toast.success(`✅ Downloaded: ${d.title}`)
            return { ...d, progress: 100, status: 'installing', speed_kbps: 0 }
          }
          return {
            ...d,
            progress: newProgress,
            speed_kbps: speed,
            eta_seconds: Math.round((100 - newProgress) * (d.size_gb || 10) * 1024 / speed)
          }
        })
      }))
    }, 2000)
    set({ _pollInterval: interval })
  },

  stopPolling: () => {
    const interval = get()._pollInterval
    if (interval) clearInterval(interval)
    set({ _pollInterval: null })
    get()._unsubscribers.forEach(fn => { try { fn() } catch {} })
    set({ _unsubscribers: [] })
  },
}))

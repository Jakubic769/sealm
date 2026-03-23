import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Download, RefreshCw, Database, X, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore }      from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import styles from './FitGirlPage.module.css'

export default function FitGirlPage() {
  const { user }             = useAuthStore()
  const { addDownload }      = useDownloadsStore()
  const [results, setResults]     = useState([])
  const [query, setQuery]         = useState('')
  const [stats, setStats]         = useState({ count: 0, lastSync: null })
  const [syncing, setSyncing]     = useState(false)
  const [syncProgress, setSyncProgress] = useState(null)
  const [downloading, setDownloading]   = useState(null)   // slug being processed
  const searchTimer = useRef(null)

  // Load stats on mount
  useEffect(() => {
    loadStats()
    // Show latest 50 on open
    doSearch('')
    // Listen for sync progress
    if (window.sealm?.fitgirl?.catalog?.onProgress) {
      const unsub = window.sealm.fitgirl.catalog.onProgress((p) => setSyncProgress(p))
      return unsub
    }
  }, [])

  const loadStats = async () => {
    if (!window.sealm) return
    const s = await window.sealm.fitgirl.catalog.stats()
    setStats(s || { count: 0, lastSync: null })
  }

  const doSearch = useCallback(async (q) => {
    if (!window.sealm) return
    const res = await window.sealm.fitgirl.catalog.search({ query: q, limit: 100 })
    setResults(res || [])
  }, [])

  const handleSearch = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(q), 300)
  }

  const handleSync = async () => {
    if (!window.sealm || syncing) return
    setSyncing(true)
    setSyncProgress(null)
    toast.loading('Synchronizuję katalog FitGirl...', { id: 'sync' })
    try {
      const res = await window.sealm.fitgirl.catalog.sync()
      toast.dismiss('sync')
      if (res.success) {
        toast.success(`✅ Dodano ${res.added} nowych gier (łącznie: ${res.total})`)
        await loadStats()
        doSearch(query)
      } else {
        toast.error(`Błąd: ${res.error}`)
      }
    } catch (e) {
      toast.dismiss('sync')
      toast.error('Błąd synchronizacji')
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const handleDownload = async (game) => {
    if (!user) return toast.error('Zaloguj się aby pobierać')
    if (downloading === game.slug) return
    setDownloading(game.slug)

    try {
      // Pobierz link magnet ze strony gry
      toast.loading(`🔍 Szukam magnet dla: ${game.title}`, { id: 'mg' })
      const res = await window.sealm.fitgirl.catalog.getMagnet({ url: game.url })
      toast.dismiss('mg')

      if (!res.success || res.magnets.length === 0) {
        toast.error('Nie znaleziono linku magnet na stronie')
        return
      }

      const magnetUri = res.magnets[0]
      toast.success('🧲 Znaleziono link magnet!')

      // Dodaj do kolejki pobierania
      // Szukaj gry w głównej tabeli lub utwórz tymczasowy wpis
      const existing = await window.sealm.games.list({ search: game.title })
      const gameId = existing?.[0]?.id

      if (gameId) {
        await addDownload({ userId: user.id, gameId, gameTitle: game.title, magnetUri })
      } else {
        // Gra nie ma wpisu w games — otwórz przez system torrent
        const { shell } = window.__electron || {}
        if (window.sealm.torrent) {
          await window.sealm.torrent.start({ downloadId: `fg-${game.slug}`, magnetUri, savePath: null })
          toast.success(`⬇ Pobieranie rozpoczęte: ${game.title}`)
        }
      }
    } catch (e) {
      toast.error('Błąd pobierania')
    } finally {
      setDownloading(null)
    }
  }

  const lastSyncStr = stats.lastSync
    ? new Date(stats.lastSync * 1000).toLocaleDateString('pl', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Nigdy'

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine} />
          <h2 className={styles.pageTitle}>FitGirl Repacks</h2>
          <p className={styles.pageSub}>
            <Database size={11} />
            {stats.count > 0 ? ` ${stats.count.toLocaleString()} gier w katalogu · Ostatnia sync: ${lastSyncStr}` : ' Katalog pusty — kliknij Synchronizuj'}
          </p>
        </div>
        <button
          className={`${styles.syncBtn} ${syncing ? styles.syncBtnActive : ''}`}
          onClick={handleSync}
          disabled={syncing}
          title="Pobierz pełną listę gier z FitGirl Repacks"
        >
          <RefreshCw size={13} className={syncing ? styles.spinning : ''} />
          {syncing ? (syncProgress ? `+${syncProgress.added}...` : 'Synchronizuję...') : 'Synchronizuj'}
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchBar}>
        <Search size={14} color="var(--text-muted)" />
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Szukaj gry z FitGirl Repacks... (np. Cyberpunk, GTA, Elden Ring)"
          value={query}
          onChange={handleSearch}
          autoFocus
        />
        {query && (
          <button className={styles.clearBtn} onClick={() => { setQuery(''); doSearch('') }}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Results count */}
      {results.length > 0 && (
        <p className={styles.resultsCount}>
          {query ? `${results.length} wyników dla "${query}"` : `Ostatnie ${results.length} gier`}
        </p>
      )}

      {/* Empty state */}
      {stats.count === 0 && !syncing && (
        <div className={styles.emptyState}>
          <Database size={40} color="var(--text-muted)" />
          <p>Katalog jest pusty</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Kliknij <strong>Synchronizuj</strong> aby pobrać listę ~4000 gier z FitGirl Repacks</p>
          <button className={styles.syncBtnBig} onClick={handleSync}>
            <RefreshCw size={14} /> Synchronizuj teraz
          </button>
        </div>
      )}

      {/* Sync progress */}
      {syncing && syncProgress && (
        <motion.div className={styles.progressBanner} initial={{ opacity:0 }} animate={{ opacity:1 }}>
          <RefreshCw size={13} className={styles.spinning} />
          Pobieranie katalogu... dodano {syncProgress.added} z {syncProgress.total} gier
        </motion.div>
      )}

      {/* Game list */}
      <div className={styles.list}>
        <AnimatePresence>
          {results.map((game, i) => (
            <motion.div
              key={game.slug}
              className={styles.row}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.01, 0.3) }}
              layout
            >
              <div className={styles.rowNum}>{i + 1}</div>
              <div className={styles.rowTitle}>
                <span className={styles.gameTitle}>{game.title}</span>
                <a
                  href={game.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.extLink}
                  title="Otwórz stronę FitGirl"
                  onClick={e => { e.preventDefault(); window.sealm && window.sealm.torrent && window.open(game.url) }}
                >
                  <ExternalLink size={10} />
                </a>
              </div>
              <button
                className={`${styles.dlBtn} ${downloading === game.slug ? styles.dlBtnActive : ''}`}
                onClick={() => handleDownload(game)}
                disabled={downloading === game.slug}
              >
                {downloading === game.slug
                  ? <><RefreshCw size={10} className={styles.spinning} /> Szukam...</>
                  : <><Download size={10} /> Pobierz</>
                }
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, Star, Download, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore }      from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import GameCover             from '../ui/GameCover'
import styles from './StorePage.module.css'

const GENRE_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'popular',  label: 'Popularne' },
  { key: 'new',      label: 'New' },
  { key: 'RPG',      label: 'RPG' },
  { key: 'Akcja',    label: 'Akcja' },
  { key: 'Racing',  label: 'Racing' },
  { key: 'Strategia',label: 'Strategia' },
]

const COVER_COLORS = {
  'g001': ['#1a0a2e','#3b1f5e','#c4b5fd'],
  'g002': ['#0d1b2a','#1e3a5f','#60a5fa'],
  'g003': ['#1a0a0a','#4a1818','#fca5a5'],
  'g004': ['#160a28','#3d1f6e','#d8b4fe'],
  'g005': ['#0a1a10','#1a5c2e','#6ee7b7'],
  'g006': ['#0a1628','#1e3a5f','#7dd3fc'],
  'g007': ['#1a1510','#503c14','#fde68a'],
  'g008': ['#0d1b2a','#1e3a5f','#93c5fd'],
  'g009': ['#1a0a0a','#5c1a1a','#f87171'],
  'g010': ['#101a0a','#2e5c1a','#86efac'],
  'g011': ['#0a1020','#1a2040','#a5b4fc'],
  'g012': ['#1a0010','#4a0030','#f9a8d4'],
  'g013': ['#0a1020','#1a2c48','#7dd3fc'],
  'g014': ['#0a0a1a','#1a1a3c','#c4b5fd'],
  'g015': ['#0a1a10','#1a4020','#bbf7d0'],
}

function GameCard({ game, onDownload, onOpen }) {
  const colors = COVER_COLORS[game.id] || ['#111827','#1e2a3a','#94a3b8']
  const initials = game.title.split(' ').map(w => w[0]).join('').slice(0, 3)
  const isNew = game.tags?.includes('new')

  return (
    <motion.div
      className={styles.gameCard}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div
        className={styles.gameCover}
        style={{ cursor: 'pointer' }}
        onClick={() => onOpen(game.id)}
      >
        <GameCover
          gameId={game.id}
          title={game.title}
          existingCoverUrl={game.cover_url}
          height={94}
          fontSize={18}
          showInitials={true}
        >
          {isNew && <span className={styles.badgeNew}>NOWE</span>}
          {game.rating >= 9.5 && <span className={styles.badgeHot}>HOT</span>}
        </GameCover>
      </div>

      <div className={styles.gameInfo}>
        <p className={styles.gameName} style={{ cursor: 'pointer' }} onClick={() => onOpen(game.id)}>{game.title}</p>
        <div className={styles.gameMeta}>
          <span className={styles.gameGenre}>{game.genre}</span>
          <span className={styles.gameRating}>
            <Star size={10} fill="currentColor" />
            {game.rating}
          </span>
        </div>
        <button
          className={styles.downloadBtn}
          onClick={() => onDownload(game)}
        >
          <Download size={10} />
          Download
        </button>
      </div>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <div className={styles.gameCard}>
      <div className={`${styles.gameCover} skeleton`} style={{ background: 'none' }} />
      <div className={styles.gameInfo}>
        <div className="skeleton" style={{ height: 14, width: '80%', borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 10, width: '50%', borderRadius: 4, marginTop: 6 }} />
      </div>
    </div>
  )
}

export default function StorePage() {
  const [games, setGames]         = useState([])
  const [search, setSearch]       = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [loading, setLoading]     = useState(true)
  const [fitgirl, setFitgirl]     = useState({ results: [], loading: false })
  const { user }                  = useAuthStore()
  const { addDownload }           = useDownloadsStore()
  const navigate                  = useNavigate()

  const openGame = (id) => navigate(`/game/${id}`)

  const fetchGames = useCallback(async (q, tab) => {
    if (!window.sealm) return
    setLoading(true)
    try {
      const filters = {}
      if (q) filters.search = q
      if (tab !== 'all' && tab !== 'popular' && tab !== 'new') filters.genre = tab
      if (tab === 'popular') filters.tag = 'popular'
      if (tab === 'new')     filters.tag = 'new'
      const data = await window.sealm.games.list(filters)
      setGames(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGames(search, activeTab) }, [activeTab])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchGames(search, activeTab), 300)
    return () => clearTimeout(t)
  }, [search])

  const handleDownload = async (game) => {
    if (!user) return toast.error('Sign in to download gry')

    // 1. Add to queue
    toast.loading(`🔍 Szukam "${game.title}" na FitGirl...`, { id: 'fg' })

    try {
      // 2. FitGirl search
      const fg = await window.sealm.fitgirl.search({ query: game.title })
      toast.dismiss('fg')

      let magnetUri = null
      if (fg.success && fg.results.length > 0) {
        toast.loading('🧲 Downloads linku magnet...', { id: 'mg' })
        const page = await window.sealm.fitgirl.getMagnet({ url: fg.results[0].link })
        toast.dismiss('mg')
        if (page.success && page.magnets.length > 0) {
          magnetUri = page.magnets[0]
          toast.success(`🧲 Znaleziono link magnet!`)
          // Start torrent via system handler
          await window.sealm.torrent.start({ magnetUri, savePath: null })
        }
      } else {
        toast('⚠️ Not found on FitGirl, added to queue', { icon: '⚠️' })
      }

      await addDownload({
        userId: user.id,
        gameId: game.id,
        gameTitle: game.title,
        magnetUri,
      })
    } catch (err) {
      toast.dismiss('fg')
      toast.dismiss('mg')
      toast.error('Error podczas szukania gry')
    }
  }

  const featured = games.find(g => g.tags?.includes('popular')) || games[0]

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine} />
          <h2 className={styles.pageTitle}>Sklep</h2>
        </div>
        <div className={styles.searchBar}>
          <Search size={13} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Szukaj gier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabs}>
        {GENRE_TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.tabBtn} ${activeTab === key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Featured banner ── */}
      {!search && featured && (
        <motion.div
          className={styles.featured}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div
            className={styles.featuredCover}
            style={{
              background: `linear-gradient(135deg, ${(COVER_COLORS[featured.id] || ['#111','#222'])[0]}, ${(COVER_COLORS[featured.id] || ['#111','#222'])[1]})`
            }}
          >
            <span style={{ color: (COVER_COLORS[featured.id] || ['','','#fff'])[2], fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24 }}>
              {featured.title.split(' ').map(w => w[0]).join('').slice(0, 3)}
            </span>
          </div>
          <div className={styles.featuredMeta}>
            <span className={styles.featuredBadge}>✦ Polecane</span>
            <h2 className={styles.featuredTitle}>{featured.title}</h2>
            <p className={styles.featuredDesc}>{featured.description}</p>
            <div className={styles.featuredActions}>
              <button className={styles.btnPrimary} onClick={() => handleDownload(featured)}>
                <Download size={13} /> Download za darmo
              </button>
              <button className={styles.btnSecondary} onClick={() => openGame(featured.id)}>More info <ChevronRight size={12} /></button>
              <span className={styles.featuredRating}>★ {featured.rating}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Grid ── */}
      <div className={styles.sectionLabel}>
        {search ? `Wyniki dla "${search}"` : 'All gry'}
        <span className={styles.count}> ({games.length})</span>
      </div>

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : games.length === 0 ? (
        <div className={styles.empty}>
          <p>No znaleziono gier dla "{search}"</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {games.map((game, i) => (
            <motion.div
              key={game.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035 }}
            >
              <GameCard game={game} onDownload={handleDownload} onOpen={openGame} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

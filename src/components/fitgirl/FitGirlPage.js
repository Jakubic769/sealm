import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Download, RefreshCw, X, Database, Zap, Clock, Flame, Trophy, Grid } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import styles from './FitGirlPage.module.css'

const TABS = [
  { key: 'popular', label: 'Pop Repacks',   icon: Flame,    color: '#e05c1a' },
  { key: 'top150',  label: 'Top 150',       icon: Trophy,   color: '#f59e0b' },
  { key: 'all',     label: 'All',     icon: Grid,     color: '#8b5cf6' },
]

const PALETTES = [
  ['#0d1b2a','#1e3a5f','#60a5fa'], ['#1a0a2e','#3b1f5e','#c4b5fd'],
  ['#0a1a10','#1a5c2e','#6ee7b7'], ['#1a0a0a','#4a1818','#fca5a5'],
  ['#160a28','#3d1f6e','#d8b4fe'], ['#1a1510','#503c14','#fde68a'],
  ['#0a1020','#1a2040','#a5b4fc'], ['#1a0010','#4a0030','#f9a8d4'],
  ['#0a1628','#1e3a5f','#7dd3fc'], ['#101a0a','#2e5c1a','#86efac'],
]
function getPalette(s) {
  let h = 0; for (const c of (s||'')) h = c.charCodeAt(0)+((h<<5)-h)
  return PALETTES[Math.abs(h)%PALETTES.length]
}
function getInitials(t) {
  return (t||'').split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase()
}

// ── Karta ─────────────────────────────────────────────────────────────────────
function GameCard({ game, index, onDownload, onOpen, downloading, accentColor, rank }) {
  const [cover,  setCover]  = useState(game.cover_url||null)
  const [imgErr, setImgErr] = useState(false)
  const pal  = getPalette(game.title)
  const init = getInitials(game.title)
  const busy = downloading === (game.slug||game.url)

  useEffect(() => {
    // cover_url może być przekazany bezpośrednio z galerii (Pop/Top150)
    if (game.cover_url && !cover) { setCover(game.cover_url); return }
    if (cover||imgErr||!game.url) return
    // Dla zakładki All — lazy fetch
    window.sealm?.fitgirl?.catalog?.fetchCover?.({ slug: game.slug, source:'fitgirl', url: game.url })
      .then(u => { if(u) setCover(u) }).catch(()=>{})
  }, [game.slug, game.cover_url])

  return (
    <motion.div className={styles.card}
      initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
      transition={{ delay: Math.min(index*0.015, 0.4) }}
      whileHover={{ y:-3 }} onClick={() => onOpen(game)}>
      <div className={styles.cover}
        style={{ background: !cover||imgErr ? `linear-gradient(135deg,${pal[0]},${pal[1]})` : undefined }}>
        {cover && !imgErr
          ? <img src={cover} alt={game.title} className={styles.coverImg}
              onError={() => { setImgErr(true); setCover(null) }}/>
          : <span className={styles.coverInit} style={{ color: pal[2] }}>{init}</span>
        }
        {rank && <span className={styles.rank} style={{ background: accentColor }}>#{rank}</span>}
        <div className={styles.coverOverlay}>
          <button className={styles.overlayDl} style={{ background: accentColor }}
            onClick={e=>{ e.stopPropagation(); onDownload(game) }} disabled={busy}>
            {busy ? <RefreshCw size={15} className={styles.spin}/> : <Download size={15}/>}
          </button>
        </div>
      </div>
      <div className={styles.cardInfo}>
        <span className={styles.cardName}>{game.title}</span>
        <div className={styles.cardRow}>
          <span className={styles.cardTag} style={{ color: accentColor }}>FitGirl</span>
          <button className={styles.cardDl}
            onClick={e=>{ e.stopPropagation(); onDownload(game) }} disabled={busy}>
            {busy ? '...' : <><Download size={9}/> Download</>}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ── Wiersz ─────────────────────────────────────────────────────────────────────
function GameRow({ game, index, onDownload, onOpen, downloading, accentColor, rank }) {
  const pal  = getPalette(game.title)
  const busy = downloading === (game.slug||game.url)
  return (
    <motion.div className={styles.row}
      initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }}
      transition={{ delay: Math.min(index*0.005, 0.2) }}
      onClick={() => onOpen(game)}>
      {rank
        ? <span className={styles.rowRank} style={{ color: accentColor }}>#{rank}</span>
        : <div className={styles.rowThumb}
            style={{ background:`linear-gradient(135deg,${pal[0]},${pal[1]})`, color:pal[2] }}>
            {getInitials(game.title).slice(0,2)}
          </div>
      }
      <span className={styles.rowName}>{game.title}</span>
      <button className={`${styles.rowDl} ${busy?styles.rowDlBusy:''}`}
        onClick={e=>{ e.stopPropagation(); onDownload(game) }} disabled={busy}>
        {busy ? <><RefreshCw size={10} className={styles.spin}/> Szukam...</> : <><Download size={10}/> Download</>}
      </button>
    </motion.div>
  )
}

// ── Główny komponent ─────────────────────────────────────────────────────────
export default function FitGirlPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [tab,         setTab]        = useState('popular')
  const [results,     setResults]    = useState([])
  const [query,       setQuery]      = useState('')
  const [stats,       setStats]      = useState({ count:0, lastSync:null })
  const [loading,     setLoading]    = useState(false)
  const [syncing,     setSyncing]    = useState(false)
  const [syncProg,    setSyncProg]   = useState(null)
  const [viewMode,    setViewMode]   = useState('grid')
  const [downloading, setDownloading]= useState(null)
  const searchTimer = useRef(null)
  const inputRef    = useRef(null)
  const currentTab  = TABS.find(t=>t.key===tab) || TABS[0]

  useEffect(() => {
    const unsub = window.sealm?.fitgirl?.catalog?.onProgress?.((p) => setSyncProg(p))
    return typeof unsub==='function' ? unsub : undefined
  }, [])

  // Przy zmianie zakładki ładuj dane
  useEffect(() => {
    setQuery('')
    loadTab(tab)
  }, [tab])

  const loadTab = async (t) => {
    setLoading(true)
    try {
      if (t === 'all') {
        // Z lokalnej bazy
        const s = await window.sealm?.fitgirl?.catalog?.stats?.({ source:'fitgirl' })
        if (s && !Array.isArray(s)) setStats(s)
        const res = await window.sealm?.fitgirl?.catalog?.search?.({ query:'', source:'fitgirl', limit:120 }) || []
        setResults(res)
      } else {
        // Popular / Top150 — pobierz na żywo ze strony FitGirl
        const res = await window.sealm?.fitgirl?.catalog?.fetchView?.({ view: t }) || []
        setResults(res)
      }
    } catch(e) {
      console.warn('loadTab error:', e)
    } finally {
      setLoading(false)
    }
  }

  const doSearch = useCallback(async (q) => {
    if (tab !== 'all') return  // search only in All tab
    const res = await window.sealm?.fitgirl?.catalog?.search?.({ query:q, source:'fitgirl', limit:120 }) || []
    setResults(res)
  }, [tab])

  const handleSearch = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(q), 250)
  }

  const clearSearch = () => { setQuery(''); doSearch(''); inputRef.current?.focus() }

  const handleSync = async () => {
    if (syncing) return

    if (tab !== 'all') {
      // Dla Popular/Top150 — po prostu odśwież dane na żywo
      setLoading(true)
      const res = await window.sealm?.fitgirl?.catalog?.fetchView?.({ view: tab }) || []
      setResults(res)
      setLoading(false)
      toast.success('✅ Refreshed')
      return
    }

    // Zakładka All — sync z A-Z
    const hasGames = stats.count > 0
    if (hasGames) {
      await window.sealm?.fitgirl?.catalog?.clear?.({ source:'fitgirl' })
      setResults([])
    }
    setSyncing(true); setSyncProg(null)
    toast.loading('Syncing FitGirl catalog...', { id:'sync' })
    const res = await window.sealm?.fitgirl?.catalog?.sync?.({ source:'fitgirl' }) || { success:false }
    toast.dismiss('sync')
    if (res.success) {
      toast.success(`✅ ${res.total?.toLocaleString()||0} games synced`)
      loadTab('all')
    } else {
      toast.error(`Error: ${res.error||'Noznany'}`)
    }
    setSyncing(false); setSyncProg(null)
  }

  const handleDownload = async (game) => {
    if (!user) return toast.error('Sign in to download')
    const key = game.slug || game.url
    if (downloading === key) return
    setDownloading(key)
    try {
      // 1. Wybierz folder docelowy
      toast('📁 Select folder to save game...', { duration: 2000 })
      const savePath = await window.sealm?.dialog?.openDirectory?.()
      if (!savePath) { toast('Cancelled — no folder selected'); return }

      // 2. Download magnet
      toast.loading('🔍 Fetching magnet link...', { id:'mg' })
      const res = await window.sealm?.fitgirl?.catalog?.getPage?.({ url: game.url })
      toast.dismiss('mg')
      if (!res?.success || !res.magnets?.length) {
        toast.error('No magnet link found on this page'); return
      }

      const magnetUri  = res.magnets[0]
      const downloadId = `fg-${Date.now()}`
      const gameTitle  = game.title || 'Noznana gra'

      // 3. Dodaj do tabeli downloads w DB
      await window.sealm?.downloads?.add?.({
        userId:    user.id,
        gameId:    game.id || null,
        magnetUri,
        gameTitle,
      })

      // 4. Start torrent
      toast.loading(`⬇ Starting download: ${gameTitle}`, { id:'dl' })
      const dlRes = await window.sealm?.torrent?.start?.({
        downloadId,
        magnetUri,
        savePath,
        gameTitle,
      })
      toast.dismiss('dl')

      if (dlRes?.success) {
        toast.success(`🧲 Downloading: ${gameTitle}
Folder: ${savePath}`, { duration: 5000 })
      } else {
        toast.error(`Error: ${dlRes?.error || 'Cannot start'}`)
      }
    } catch(e) {
      toast.error('Error: '+e.message)
    } finally {
      setDownloading(null)
    }
  }

  const openGame = (game) => {
    const slug = game.slug || urlToSlug(game.url) || 'unknown'
    navigate(`/fitgirl/game/fitgirl/${slug}`, { state: { gameUrl: game.url, gameTitle: game.title } })
  }

  const lastSync = stats.lastSync
    ? new Date(stats.lastSync*1000).toLocaleDateString('pl',{day:'numeric',month:'short',year:'numeric'})
    : null

  const showSearch = tab === 'all'
  const showSync   = true   // zawsze widoczny

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandDot} style={{ background: currentTab.color, boxShadow:`0 0 8px ${currentTab.color}88` }}/>
          <h2 className={styles.brandTitle}>FitGirl Repacks</h2>
        </div>
        <div className={styles.headerRight}>
          {showSync && stats.count > 0 && (
            <div className={styles.chips}>
              <span className={styles.chip}><Database size={10}/> {stats.count.toLocaleString()}</span>
              {lastSync && <span className={styles.chip}><Clock size={10}/> {lastSync}</span>}
            </div>
          )}
          <div className={styles.viewToggle}>
            <button className={`${styles.viewBtn} ${viewMode==='grid'?styles.viewActive:''}`} onClick={()=>setViewMode('grid')}>⊞</button>
            <button className={`${styles.viewBtn} ${viewMode==='list'?styles.viewActive:''}`} onClick={()=>setViewMode('list')}>≡</button>
          </div>
          {showSync && (
            <button className={`${styles.syncBtn} ${syncing?styles.syncBusy:''}`}
              onClick={handleSync} disabled={syncing}>
              <RefreshCw size={12} className={syncing?styles.spin:''}/>
              {syncing
                ? (syncProg ? `Page ${syncProg.page||'?'}/${syncProg.maxPage||'?'} · ${syncProg.added}` : 'Connecting...')
                : tab === 'all'
                  ? (stats.count > 0 ? 'Update catalog' : 'Sync')
                  : 'Refresh'
              }
            </button>
          )}
        </div>
      </div>

      {/* Zakładki */}
      <div className={styles.tabs}>
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key}
              className={`${styles.tabBtn} ${tab===t.key?styles.tabActive:''}`}
              style={tab===t.key ? { borderColor: t.color, color: t.color, background:`${t.color}12` } : {}}
              onClick={() => setTab(t.key)}>
              <Icon size={13}/>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Wyszukiwarka — tylko w zakładce All */}
      {showSearch && (
        <div className={styles.searchWrap}>
          <div className={styles.searchBar}>
            <Search size={15} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
            <input ref={inputRef} className={styles.searchInput} type="text"
              placeholder="Search FitGirl catalog..." value={query} onChange={handleSearch}/>
            {query && <button className={styles.clearBtn} onClick={clearSearch}><X size={13}/></button>}
          </div>
          {query && <span className={styles.hint}>{results.length} wyników dla „{query}"</span>}
        </div>
      )}

      {/* Pusty katalog All */}
      {tab==='all' && stats.count===0 && !syncing && !loading && (
        <div className={styles.empty}>
          <Database size={38} style={{ color:'var(--text-muted)', opacity:0.4 }}/>
          <p className={styles.emptyTitle}>Katalog jest pusty</p>
          <p className={styles.emptySub}>Kliknij Sync aby pobrać ~4000 gier z FitGirl Repacks</p>
          <button className={styles.emptyBtn} onClick={handleSync} style={{ background:'#8b5cf6' }}>
            <Zap size={14}/> Sync teraz
          </button>
        </div>
      )}

      {/* Pasek postępu sync */}
      <AnimatePresence>
        {syncing && (
          <motion.div className={styles.progressBar}
            initial={{ opacity:0,y:-6 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}>
            <RefreshCw size={12} className={styles.spin}/>
            <span>Downloads katalogu FitGirl...</span>
            {syncProg && <span className={styles.progressNum}>
              Strona {syncProg.page}/{syncProg.maxPage} · {syncProg.added?.toLocaleString()} gier
            </span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ładowanie */}
      {loading && (
        <div className={styles.loadingRow}>
          <RefreshCw size={16} className={styles.spin} style={{ color:'var(--text-muted)' }}/>
          <span style={{ color:'var(--text-muted)', fontSize:13 }}>Loading...</span>
        </div>
      )}

      {/* Siatka */}
      {!loading && results.length > 0 && viewMode==='grid' && (
        <div className={styles.grid}>
          {results.map((g,i) => (
            <GameCard key={g.slug||g.url} game={g} index={i}
              onDownload={handleDownload} onOpen={openGame}
              downloading={downloading} accentColor={currentTab.color}
              rank={tab!=='all' ? i+1 : null}/>
          ))}
        </div>
      )}

      {/* Lista */}
      {!loading && results.length > 0 && viewMode==='list' && (
        <div className={styles.list}>
          {results.map((g,i) => (
            <GameRow key={g.slug||g.url} game={g} index={i}
              onDownload={handleDownload} onOpen={openGame}
              downloading={downloading} accentColor={currentTab.color}
              rank={tab!=='all' ? i+1 : null}/>
          ))}
        </div>
      )}

      {!loading && results.length===0 && query && tab==='all' && (
        <div className={styles.noResults}>No results dla <strong>„{query}"</strong></div>
      )}
    </div>
  )
}

function urlToSlug(url) {
  const m = (url||'').replace(/\/$/, '').match(/\/([^/?#]+)$/)
  return m ? m[1] : null
}

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Clock, Settings2, X, HardDrive, Search, Plus, FolderOpen, Image } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { syncUserStats } from '../../lib/firebaseFriends'
import { checkAchievements } from '../../lib/firebaseAchievements'
import GameCover from '../ui/GameCover'
import styles from './LibraryPage.module.css'

// ── Modal dodawania gry ──────────────────────────────────────────────────────
function AddGameModal({ onClose, onAdded }) {
  const { user } = useAuthStore()
  const [step,        setStep]        = useState('exe')  // exe → scraping → done
  const [exePath,     setExePath]     = useState('')
  const [title,       setTitle]       = useState('')
  const [coverUrl,    setCoverUrl]    = useState('')
  const [scraping,    setScraping]    = useState(false)
  const [saving,      setSaving]      = useState(false)

  const pickExe = async () => {
    const p = await window.sealm?.dialog?.openFile?.({ filters: [{ name: 'Executable', extensions: ['exe'] }] })
    if (!p) return
    setExePath(p)
    // Auto-wykryj tytuł z nazwy folderu/pliku
    const parts = p.replace(/\\/g, '/').split('/')
    const guess = parts[parts.length - 2] || parts[parts.length - 1].replace('.exe', '')
    setTitle(guess.replace(/[_\-\.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }

  const scrapecover = async () => {
    if (!title.trim()) return
    setScraping(true)
    try {
      // 1. Szukaj w lokalnej bazie FitGirl (z okładkami z A-Z)
      const local = await window.sealm?.fitgirl?.catalog?.search?.({ query: title.trim(), limit: 5 })
      if (local?.length > 0) {
        if (local[0].cover_url) {
          setCoverUrl(local[0].cover_url)
          toast.success('✅ Cover found!')
          return
        }
        // Mamy wpis bez okładki — pobierz ze strony gry (jak getGamePage)
        if (local[0].url) {
          const page = await window.sealm?.fitgirl?.catalog?.getPage?.({ url: local[0].url })
          if (page?.coverUrl) {
            setCoverUrl(page.coverUrl)
            toast.success('✅ Cover found on FitGirl!')
            return
          }
        }
      }

      // 2. Szukaj na FitGirl przez wyszukiwarkę → wejdź na stronę pierwszego wyniku
      const q = encodeURIComponent(title.trim())
      const searchRes = await window.sealm?.fitgirl?.catalog?.fetchUrl?.({
        url: `https://fitgirl-repacks.site/?s=${q}`
      })
      const html = searchRes?.html || ''
      if (html) {
        // Wyciągnij URL pierwszego wyniku (link do strony gry, nie obrazek)
        const gameUrlMatch = html.match(/class="entry-title[^"]*"[^>]*>\s*<a\s+href="(https:\/\/fitgirl-repacks\.site\/[^"]+)"/i)
          || html.match(/<h\d[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a\s+href="(https:\/\/fitgirl-repacks\.site\/[^"]+)"/i)
          || html.match(/<a\s+href="(https:\/\/fitgirl-repacks\.site\/(?!page\/)[^"]+)"[^>]*class="[^"]*"/i)
        if (gameUrlMatch?.[1]) {
          // Pobierz stronę gry i wyciągnij okładkę tak jak robi getGamePage
          const gamePage = await window.sealm?.fitgirl?.catalog?.getPage?.({ url: gameUrlMatch[1] })
          if (gamePage?.coverUrl) {
            setCoverUrl(gamePage.coverUrl)
            toast.success('✅ Cover found on FitGirl!')
            return
          }
        }
      }

      // 3. IGDB fallback
      const igdb = await window.sealm?.igdb?.getCover?.({ title: title.trim() })
      if (igdb?.coverUrl) {
        setCoverUrl(igdb.coverUrl)
        toast.success('✅ Cover found via IGDB!')
        return
      }

      toast('Cover not found — paste URL manually', { icon: '🖼️' })
    } catch(e) {
      console.error('scrapecover:', e)
      toast.error('Error searching for cover')
    } finally {
      setScraping(false)
    }
  }

  const save = async () => {
    if (!exePath || !title.trim()) { toast.error('Please fill all fields'); return }
    setSaving(true)
    try {
      const installPath = exePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')

      const res = await window.sealm?.library?.addCustom?.({
        userId:      user.uid || user.id,
        title:       title.trim(),
        executable:  exePath,
        installPath,
        coverUrl:    coverUrl || null,
      })

      if (res?.success) {
        toast.success(`✅ Added: ${title}`)
        // Trigger library achievement
        const u = window._sealmUser
        const uid = u?.uid || u?.id
        if (uid) {
          setTimeout(async () => {
            try {
              const lib = await window.sealm?.library?.list?.({ userId: uid })
              if (lib) {
                const totalMin = lib.reduce((s, i) => s + (i.playtime_min || 0), 0)
                await syncUserStats(uid, { gamesCount: lib.length, playtimeMinutes: totalMin })
                const unlocked = await checkAchievements(uid, 'library', { count: lib.length })
                unlocked.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
              }
            } catch {}
          }, 1000)
        }
        onAdded()
        onClose()
      } else {
        toast.error(res?.error || 'Error adding game')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <motion.div className={styles.modal} onClick={e => e.stopPropagation()}
        initial={{ opacity:0, scale:0.94, y:14 }} animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.94 }} transition={{ duration:0.15 }}>

        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Add Game to Library</h3>
          <button className={styles.modalClose} onClick={onClose}><X size={14}/></button>
        </div>

        <div className={styles.modalFields}>
          {/* Wybór exe */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}><Play size={11}/> Game .exe file</label>
            <div style={{ display:'flex', gap:8 }}>
              <input className={styles.fieldInput} value={exePath} readOnly
                placeholder="Select .exe file..." style={{ flex:1 }}/>
              <button className={styles.browseBtn} onClick={pickExe}>
                <FolderOpen size={13}/> Browse
              </button>
            </div>
          </div>

          {/* Tytuł */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}><HardDrive size={11}/> Game Title</label>
            <input className={styles.fieldInput} value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Hollow Knight"/>
          </div>

          {/* Cover Image */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}><Image size={11}/> Cover Image</label>
            <div style={{ display:'flex', gap:8 }}>
              <input className={styles.fieldInput} value={coverUrl}
                onChange={e => setCoverUrl(e.target.value)}
                placeholder="Cover URL (auto-detect or paste manually)" style={{ flex:1 }}/>
              <button className={styles.browseBtn} onClick={scrapecover} disabled={scraping || !title}>
                {scraping ? '...' : '🔍 Find'}
              </button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="cover" style={{ width:60, height:80, objectFit:'cover', borderRadius:6, marginTop:8 }}/>
            )}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={save} disabled={saving || !exePath || !title}>
            {saving ? 'Adding...' : `+ ${'Add Game'}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Modal konfiguracji ────────────────────────────────────────────────────────
function GameConfigModal({ item, onClose, onSave, onDelete }) {
  const [execPath,   setExecPath]   = useState(item.executable   || '')
  const [installDir, setInstallDir] = useState(item.install_path || '')
  const [deleting,   setDeleting]   = useState(false)

  const handleSave = async () => {
    await window.sealm?.library?.updateConfig?.({ id: item.id, executable: execPath.trim(), installPath: installDir.trim() })
    toast.success('✓ Settings saved')
    onSave({ ...item, executable: execPath.trim(), install_path: installDir.trim() })
    onClose()
  }

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${item.title}" from library?`)) return
    setDeleting(true)
    try {
      await window.sealm?.library?.remove?.({ id: item.id })
      toast.success(`Removed ${item.title} from library`)
      onDelete(item.id)
      onClose()
    } finally { setDeleting(false) }
  }

  const pickExe = async () => {
    const p = await window.sealm?.dialog?.openFile?.({ filters: [{ name: 'Executable', extensions: ['exe'] }] })
    if (p) setExecPath(p)
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <motion.div className={styles.modal} onClick={e => e.stopPropagation()}
        initial={{ opacity:0, scale:0.94, y:14 }} animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.94 }}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Game Settings</h3>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={handleDelete} disabled={deleting} title="Remove from library"
              style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6,
                background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
                color:'#f87171', fontSize:11, fontFamily:'var(--font-display)', fontWeight:700,
                cursor:'pointer', letterSpacing:0.5 }}>
              🗑 Delete
            </button>
            <button className={styles.modalClose} onClick={onClose}><X size={14}/></button>
          </div>
        </div>
        <div className={styles.modalGame}>
          <div style={{ width:46, height:60, borderRadius:6, overflow:'hidden', flexShrink:0 }}>
            <GameCover gameId={item.game_id} title={item.title} existingCoverUrl={item.cover_url} width={46} height={60} fontSize={11}/>
          </div>
          <div>
            <p style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:700 }}>{item.title}</p>
            <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{item.genre}</p>
          </div>
        </div>
        <div className={styles.modalFields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}><Play size={11}/> Executable (.exe)</label>
            <div style={{ display:'flex', gap:8 }}>
              <input className={styles.fieldInput} value={execPath} onChange={e => setExecPath(e.target.value)}
                placeholder="C:\Games\Gra\Game.exe" style={{ flex:1 }}/>
              <button className={styles.browseBtn} onClick={pickExe}><FolderOpen size={13}/></button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}><HardDrive size={11}/> Install Directory</label>
            <input className={styles.fieldInput} value={installDir} onChange={e => setInstallDir(e.target.value)}
              placeholder="C:\Games\Gra"/>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Karta gry ─────────────────────────────────────────────────────────────────
function LibraryCard({ item, onPlay, onConfig }) {
  const hours   = Math.round((item.playtime_min || 0) / 60 * 10) / 10
  const lastStr = item.last_played
    ? new Date(item.last_played * 1000).toLocaleDateString('en', { day:'numeric', month:'short' })
    : 'Never'

  return (
    <motion.div className={styles.card} whileHover={{ y:-2 }} transition={{ duration:0.15 }}>
      <div className={styles.cardCover}>
        <GameCover gameId={item.game_id} title={item.title} existingCoverUrl={item.cover_url} width={160} height={110} fontSize={13}/>
        <button className={styles.configBtn} onClick={e => { e.stopPropagation(); onConfig(item) }} title="Settings">
          <Settings2 size={12}/>
        </button>
      </div>
      <div className={styles.cardInfo}>
        <p className={styles.cardTitle}>{item.title}</p>
        <div className={styles.cardMeta}>
          <span className={styles.cardHours}><Clock size={10}/> {hours}h</span>
          <span className={styles.cardLast}>{lastStr}</span>
        </div>
        <button className={`${styles.playBtn} ${!item.executable ? styles.playBtnWarn : ''}`}
          onClick={() => onPlay(item)}>
          <Play size={11} fill="currentColor"/>
          {item.executable ? 'Play' : 'Set Path'}
        </button>
      </div>
    </motion.div>
  )
}

// ── Główna strona ─────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const { user } = useAuthStore()
  const [library,     setLibrary]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [configItem,  setConfigItem]  = useState(null)
  const [showAddGame, setShowAddGame] = useState(false)
  const [running,     setRunning]     = useState({})  // gameId → startTime

  const fetch = useCallback(async () => {
    const uid = user?.uid || user?.id
    if (!uid || !window.sealm?.library?.list) return
    setLoading(true)
    try {
      const lib = await window.sealm.library.list({ userId: uid }) || []
      setLibrary(lib)
      // Sync stats to Firebase
      if (uid && lib.length > 0) {
        const totalMin = lib.reduce((s, i) => s + (i.playtime_min || 0), 0)
        syncUserStats(uid, { gamesCount: lib.length, playtimeMinutes: totalMin }).catch(() => {})
      }
    } finally { setLoading(false) }
  }, [user])

  useEffect(() => { fetch() }, [fetch])

  // Odśwież bibliotekę co 30s żeby zaktualizować czas gry
  useEffect(() => {
    const iv = setInterval(() => { if (user) fetch() }, 30000)
    return () => clearInterval(iv)
  }, [user, fetch])

  const handlePlay = async (item) => {
    if (!item.executable) {
      toast.error('Set Path')
      setConfigItem(item)
      return
    }

    toast.success(`▶ Uruchamianie: ${item.title}`)
    const startTime = Date.now()
    setRunning(r => ({ ...r, [item.id]: startTime }))

    try {
      await window.sealm.library.launch({ executable: item.executable })

      // Monitoruj zamknięcie procesu i zapisz czas gry
      if (window.sealm?.playtime?.track) {
        await window.sealm.playtime.track({
          libraryId: item.id,
          userId:    user.uid || user.id,
          executable: item.executable,
        })
      }
    } catch(e) {
      toast.error(`Error uruchamiania: ${e.message}`)
    } finally {
      setRunning(r => { const n = {...r}; delete n[item.id]; return n })
    }

    // Odśwież po zamknięciu gry
    setTimeout(() => fetch(), 3000)
  }

  const handleConfigSave = (updated) =>
    setLibrary(prev => prev.map(i => i.id === updated.id ? updated : i))

  const handleDeleteGame = async (libId) => {
    setLibrary(prev => prev.filter(i => i.id !== libId))
    // Sync updated stats to Firebase
    const uid = user?.uid || user?.id
    if (uid) {
      setTimeout(async () => {
        try {
          const lib = await window.sealm?.library?.list?.({ userId: uid })
          if (lib !== undefined) {
            const totalMin = (lib || []).reduce((s, i) => s + (i.playtime_min || 0), 0)
            await syncUserStats(uid, { gamesCount: (lib || []).length, playtimeMinutes: totalMin })
          }
        } catch {}
      }, 500)
    }
  }

  const filtered    = library.filter(i => !search || i.title.toLowerCase().includes(search.toLowerCase()))
  const totalHours  = Math.round(library.reduce((s, i) => s + (i.playtime_min || 0), 0) / 60)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine}/>
          <h2 className={styles.pageTitle}>Library</h2>
          <p className={styles.pageSub}>{library.length} games · {totalHours}h total playtime</p>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div className={styles.searchBar}>
            <Search size={13} color="var(--text-muted)"/>
            <input className={styles.searchInput} type="text" placeholder="Search library…"
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <button className={styles.addBtn} onClick={() => setShowAddGame(true)} title="Add Game">
            <Plus size={14}/> Add Game
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.card}>
              <div className="skeleton" style={{ height:110, borderRadius:'10px 10px 0 0' }}/>
              <div style={{ padding:10, display:'flex', flexDirection:'column', gap:8 }}>
                <div className="skeleton" style={{ height:14, borderRadius:4 }}/>
                <div className="skeleton" style={{ height:10, width:'60%', borderRadius:4 }}/>
                <div className="skeleton" style={{ height:30, borderRadius:6 }}/>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {search
            ? `"${search}" not found in library`
            : <div style={{ textAlign:'center' }}>
                <p>Library jest pusta</p>
                <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>
                  Download gry ze Sklepu lub kliknij <strong>Add Game</strong> aby dodać zainstalowaną grę
                </p>
                <button className={styles.addBtn} style={{ marginTop:16 }} onClick={() => setShowAddGame(true)}>
                  <Plus size={14}/> Add Game
                </button>
              </div>
          }
        </div>
      ) : (
        <motion.div className={styles.grid} layout>
          {filtered.map((item, i) => (
            <motion.div key={item.id} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
              transition={{ delay: i * 0.04 }}>
              <LibraryCard item={item} onPlay={handlePlay} onConfig={setConfigItem}/>
            </motion.div>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {showAddGame && <AddGameModal onClose={() => setShowAddGame(false)} onAdded={fetch}/>}
        {configItem  && <GameConfigModal item={configItem} onClose={() => setConfigItem(null)} onSave={handleConfigSave} onDelete={handleDeleteGame}/>}
      </AnimatePresence>
    </div>
  )
}

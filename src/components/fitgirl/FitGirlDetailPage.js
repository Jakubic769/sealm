import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Star, Send, RefreshCw, Monitor, Cpu, HardDrive } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore }      from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import styles from './FitGirlDetailPage.module.css'
import { checkAchievements, incrementCounter } from '../../lib/firebaseAchievements'

const PALETTES = [
  ['#0d1b2a','#1e3a5f','#60a5fa'], ['#1a0a2e','#3b1f5e','#c4b5fd'],
  ['#0a1a10','#1a5c2e','#6ee7b7'], ['#1a0a0a','#4a1818','#fca5a5'],
  ['#160a28','#3d1f6e','#d8b4fe'], ['#1a1510','#503c14','#fde68a'],
  ['#0a1020','#1a2040','#a5b4fc'], ['#1a0010','#4a0030','#f9a8d4'],
]
function getPalette(s) {
  let h=0; for(const c of(s||''))h=c.charCodeAt(0)+((h<<5)-h)
  return PALETTES[Math.abs(h)%PALETTES.length]
}
function getInitials(t) {
  return(t||'').split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase()
}

function StarSelector({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display:'flex', gap:4 }}>
      {Array.from({ length:10 }).map((_,i) => {
        const v = i+1
        const active = v <= (hovered||value)
        return (
          <button key={v} onMouseEnter={()=>setHovered(v)} onMouseLeave={()=>setHovered(0)}
            onClick={()=>onChange(v)}
            style={{ background:'none', border:'none', cursor:'pointer', padding:2,
              color: active ? '#f59e0b' : 'var(--text-muted)', fontSize:18, transition:'color 0.1s' }}>
            ★
          </button>
        )
      })}
      {value > 0 && <span style={{ fontSize:13, color:'#f59e0b', fontFamily:'var(--font-display)', fontWeight:700, alignSelf:'center', marginLeft:4 }}>{value}/10</span>}
    </div>
  )
}

export default function FitGirlDetailPage() {
  const { slug, source='fitgirl' } = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()
  const { user }     = useAuthStore()

  // Dane przekazane przez nawigację (z FitGirlPage)
  const navState = location.state || {}

  const [game,        setGame]        = useState(null)
  const [coverUrl,    setCoverUrl]    = useState(null)
  const [coverErr,    setCoverErr]    = useState(false)
  const [magnets,     setMagnets]     = useState([])
  const [description, setDescription] = useState('')
  const [reviews,     setReviews]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [rating,      setRating]      = useState(0)
  const [body,        setBody]        = useState('')
  const [submitting,  setSubmitting]  = useState(false)

  useEffect(() => {
    if (!window.sealm) return

    // Najpierw szukaj w katalogu po slugu
    window.sealm.fitgirl.catalog.search({ query: slug.replace(/-/g,' ').slice(0,30), source, limit:10 })
      .then(async results => {
        const found = results?.find(r => r.slug === slug) || results?.[0]
        const gameData = found || {
          title: navState.gameTitle || slug.replace(/-/g,' ').replace(/\b\w/g, c=>c.toUpperCase()),
          url:   navState.gameUrl   || `https://fitgirl-repacks.site/${slug}/`,
          slug,
        }
        setGame(gameData)

        // Download stronę gry — magnets + okładka + opis
        const pageRes = await window.sealm.fitgirl.catalog.getPage({ url: gameData.url })
        if (pageRes?.success) {
          setMagnets(pageRes.magnets || [])
          setDescription(pageRes.description || '')
          // Okładka z cache DB lub ze strony
          const dbCover = found?.cover_url
          if (dbCover) {
            setCoverUrl(dbCover)
          } else if (pageRes.coverUrl) {
            setCoverUrl(pageRes.coverUrl)
            // Save do cache
            window.sealm.fitgirl.catalog.fetchCover?.({ slug, source, url: gameData.url })
          }
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slug])

  const handleDownload = async () => {
    if (!user) return toast.error('Sign in to download')
    if (!game) return

    const mag = magnets[0]
    if (!mag) {
      toast.loading('🔍 Szukam linku magnet...', { id:'mg' })
      const res = await window.sealm.fitgirl.catalog.getPage({ url: game.url })
      toast.dismiss('mg')
      if (!res?.magnets?.length) return toast.error('No magnet link found on this page')
      setMagnets(res.magnets)
      startTorrent(res.magnets[0])
    } else {
      startTorrent(mag)
    }
  }

  const startTorrent = async (magnetUri) => {
    setDownloading(true)
    try {
      // Wybierz folder
      toast('📁 Select folder to save game...', { duration: 2000 })
      const savePath = await window.sealm?.dialog?.openDirectory?.()
      if (!savePath) { toast('Anulowano'); setDownloading(false); return }

      const downloadId = `fg-${slug}-${Date.now()}`
      const gameTitle  = game.title || slug

      // Dodaj do DB
      await window.sealm?.downloads?.add?.({ userId: user?.id, gameId: null, magnetUri, gameTitle })

      toast.loading(`⬇ Starting: ${gameTitle}`, { id: 'dl' })
      const res = await window.sealm.torrent.start({ downloadId, magnetUri, savePath, gameTitle })
      toast.dismiss('dl')

      if (res?.success) {
        toast.success(`🧲 Downloading: ${gameTitle}
Folder: ${savePath}`, { duration: 5000 })
      } else {
        toast.error(res?.error || 'Error uruchamiania')
      }
    } catch(e) {
      toast.error('Error: '+e.message)
    } finally {
      setDownloading(false)
    }
  }

  const submitReview = async () => {
    if (!rating) return toast.error('Please select a rating')
    if (!user)   return toast.error('Sign in to review')
    setSubmitting(true)
    try {
      const games = await window.sealm.games.list({ search: game.title.slice(0,15) })
      if (games?.[0]) {
        const res = await window.sealm.reviews.add({ userId:user.id, gameId:games[0].id, rating, body:body.trim()||null })
        if (res.success) {
          toast.success('✓ Review posted!')
          const u = window._sealmUser
          if (u?.id) window.sealm?.achievements?.trigger?.({ event: 'review', userId: u.id })
          setReviews(prev => [...prev, { id:Date.now(), username:user.username, rating, body, created_at:Date.now()/1000 }])
          setRating(0); setBody('')
        }
      } else {
        toast('ℹ Reviews work only for games from the built-in catalog')
      }
    } finally { setSubmitting(false) }
  }

  if (loading) return (
    <div style={{ padding:24 }}>
      <div className="skeleton" style={{ height:200, borderRadius:12, marginBottom:16 }}/>
      <div className="skeleton" style={{ height:24, width:'40%', borderRadius:6, marginBottom:10 }}/>
      <div className="skeleton" style={{ height:14, borderRadius:4, marginBottom:6 }}/>
      <div className="skeleton" style={{ height:14, width:'80%', borderRadius:4 }}/>
    </div>
  )

  if (!game) return (
    <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
      <p>No znaleziono gry.</p>
      <button onClick={()=>navigate('/fitgirl')} style={{ marginTop:12, background:'none', border:'none', color:'#e05c1a', cursor:'pointer' }}>
        ← Back
      </button>
    </div>
  )

  const pal  = getPalette(game.title)
  const init = getInitials(game.title)
  const hasCover = coverUrl && !coverErr

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={()=>navigate('/fitgirl')}>
        <ArrowLeft size={14}/> Powrót do katalogu
      </button>

      {/* ── Hero ── */}
      <motion.div className={styles.hero}
        style={{ background: hasCover ? 'transparent' : `linear-gradient(135deg, ${pal[0]} 0%, ${pal[1]} 100%)` }}
        initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}>

        {/* Okładka jako tło hero gdy dostępna */}
        {hasCover && (
          <>
            <img
              src={coverUrl}
              alt=""
              className={styles.heroBgImg}
              onError={()=>setCoverErr(true)}
            />
            <div className={styles.heroBgOverlay}
              style={{ background:`linear-gradient(135deg, ${pal[0]}cc 0%, ${pal[1]}88 100%)` }}/>
          </>
        )}
        {!hasCover && <div className={styles.heroOverlay}/>}

        {/* Miniatura okładki */}
        <div className={styles.heroCover}
          style={{ background: hasCover ? 'transparent' : 'rgba(0,0,0,0.3)' }}>
          {hasCover
            ? <img src={coverUrl} alt={game.title} className={styles.heroCoverImg} onError={()=>setCoverErr(true)}/>
            : <span style={{ color:pal[2], fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, letterSpacing:2 }}>{init}</span>
          }
        </div>

        <div className={styles.heroMeta}>
          <span className={styles.heroSource}>FitGirl Repacks</span>
          <h1 className={styles.heroTitle}>{game.title}</h1>
          {description && (
            <p className={styles.heroDesc}>{description.slice(0,120)}...</p>
          )}
          <div className={styles.heroStats}>
            {magnets.length > 0 && (
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.6)', display:'flex', alignItems:'center', gap:4 }}>
                🧲 {magnets.length} magnet{magnets.length>1?'y':''}
              </span>
            )}
          </div>
        </div>

        <div className={styles.heroActions}>
          <button className={styles.dlBtn} onClick={handleDownload} disabled={downloading}>
            {downloading
              ? <><RefreshCw size={14} className={styles.spinning}/> Downloads...</>
              : <><Download size={14}/> Download bezpłatnie</>
            }
          </button>
        </div>
      </motion.div>

      {/* ── Body ── */}
      <div className={styles.body}>
        <div className={styles.left}>

          {/* Description */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Description</h3>
            <p className={styles.desc}>
              {description ||
                'Game available as FitGirl repack — compressed release with full original content. After download, run setup.exe and select components.'}
            </p>
          </section>

          {/* Requirements */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Requirements systemowe</h3>
            <div className={styles.reqGrid}>
              {[
                { title:'Minimalne', items:[
                  { Icon:Monitor,    l:'System',   v:'Windows 10 64-bit' },
                  { Icon:Cpu,        l:'Procesor', v:'Intel Core i5 / Ryzen 5' },
                  { Icon:HardDrive,  l:'RAM',      v:'8 GB' },
                  { Icon:HardDrive,  l:'Disk',     v:'Depends on game' },
                ]},
                { title:'Zalecane', items:[
                  { Icon:Monitor,    l:'System',   v:'Windows 10/11 64-bit' },
                  { Icon:Cpu,        l:'Procesor', v:'Intel Core i7 / Ryzen 7' },
                  { Icon:HardDrive,  l:'RAM',      v:'16 GB' },
                  { Icon:HardDrive,  l:'Dysk',     v:'SSD zalecany' },
                ]},
              ].map(box => (
                <div key={box.title} className={styles.reqBox}>
                  <p className={styles.reqBoxTitle}>{box.title}</p>
                  {box.items.map(({ Icon, l, v }) => (
                    <div key={l} className={styles.reqRow}>
                      <Icon size={11} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                      <div>
                        <p style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:1, fontFamily:'var(--font-display)' }}>{l}</p>
                        <p style={{ fontSize:11, color:'var(--text-primary)', marginTop:1 }}>{v}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* Reviews */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              Reviews <span style={{ color:'var(--text-muted)', fontWeight:400, fontSize:13 }}>({reviews.length})</span>
            </h3>
            {user ? (
              <div className={styles.reviewForm}>
                <p style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--font-display)', letterSpacing:1, textTransform:'uppercase', marginBottom:8 }}>Twoja ocena</p>
                <StarSelector value={rating} onChange={setRating}/>
                <textarea className={styles.reviewTA} placeholder="Write a review (opcjonalnie)..."
                  value={body} onChange={e=>setBody(e.target.value)} rows={3}/>
                <button className={styles.reviewSubmit} onClick={submitReview} disabled={submitting||!rating}>
                  <Send size={12}/> {submitting ? 'Posting...' : 'Publish'}
                </button>
              </div>
            ) : (
              <p style={{ fontSize:12, color:'var(--text-muted)', padding:'12px 0' }}>Zaloguj się aby napisać recenzję.</p>
            )}
            {reviews.length === 0
              ? <p style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic', padding:'16px 0' }}>Brak recenzji — bądź pierwszy!</p>
              : reviews.map(r => (
                <div key={r.id} className={styles.reviewCard}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--accent-violet-dim)', color:'var(--accent-violet-bright)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontSize:11, fontWeight:700, flexShrink:0 }}>
                      {r.username?.slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:700 }}>{r.username}</p>
                      <p style={{ fontSize:10, color:'var(--text-muted)' }}>{new Date(r.created_at*1000).toLocaleDateString('pl')}</p>
                    </div>
                    <span style={{ color:'#f59e0b', fontFamily:'var(--font-display)', fontWeight:700, fontSize:13 }}>★ {r.rating}/10</span>
                  </div>
                  {r.body && <p style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.6 }}>{r.body}</p>}
                </div>
              ))
            }
          </section>
        </div>

        {/* Sidebar */}
        <div className={styles.right}>
          {magnets.length > 0 && (
            <div className={styles.sideCard}>
              <p className={styles.sideCardTitle}>Linki magnet</p>
              {magnets.slice(0,3).map((m,i) => (
                <button key={i} className={styles.magnetBtn}
                  onClick={()=>{ handleDownload() }}>
                  🧲 Magnet {i+1}
                </button>
              ))}
            </div>
          )}
          <button className={styles.sideDownload} onClick={handleDownload} disabled={downloading}>
            <Download size={15}/> {downloading ? 'Downloads...' : 'Download teraz'}
          </button>
          <div className={styles.sideCard}>
            <p className={styles.sideCardTitle}>Informacje</p>
            {[['Source','FitGirl Repacks'],['Type','Repack'],['Installer','setup.exe']].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                <span style={{ color:'var(--text-muted)' }}>{k}</span>
                <span style={{ color:'var(--text-primary)', fontFamily:'var(--font-display)', fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

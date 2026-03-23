import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Star, Download, Clock, HardDrive,
  Monitor, Cpu, MemoryStick, Gamepad2, Send, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore }      from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import styles from './GameDetailPage.module.css'
import { checkAchievements, incrementCounter } from '../../lib/firebaseAchievements'

// ─── Static cover palette (shared with StorePage) ────────────────────────────
const COVER_COLORS = {
  g001: ['#1a0a2e','#3b1f5e','#c4b5fd'],
  g002: ['#0d1b2a','#1e3a5f','#60a5fa'],
  g003: ['#1a0a0a','#4a1818','#fca5a5'],
  g004: ['#160a28','#3d1f6e','#d8b4fe'],
  g005: ['#0a1a10','#1a5c2e','#6ee7b7'],
  g006: ['#0a1628','#1e3a5f','#7dd3fc'],
  g007: ['#1a1510','#503c14','#fde68a'],
  g008: ['#0d1b2a','#1e3a5f','#93c5fd'],
  g009: ['#1a0a0a','#5c1a1a','#f87171'],
  g010: ['#101a0a','#2e5c1a','#86efac'],
  g011: ['#0a1020','#1a2040','#a5b4fc'],
  g012: ['#1a0010','#4a0030','#f9a8d4'],
  g013: ['#0a1020','#1a2c48','#7dd3fc'],
  g014: ['#0a0a1a','#1a1a3c','#c4b5fd'],
  g015: ['#0a1a10','#1a4020','#bbf7d0'],
}

// ─── Mock screenshots per game ───────────────────────────────────────────────
const MOCK_SCREENS = [
  { label: 'Rozgrywka', colors: ['#0d1117','#1e2a3a'] },
  { label: 'World view', colors: ['#0a1a10','#1a3a20'] },
  { label: 'Walka', colors: ['#1a0a0a','#3a1010'] },
  { label: 'Ekwipunek', colors: ['#0a0a1a','#1a1a3a'] },
]

// ─── Mock requirements ───────────────────────────────────────────────────────
const REQUIREMENTS = {
  min: {
    os: 'Windows 10 64-bit',
    cpu: 'Intel Core i5-8600 / AMD Ryzen 5 3600',
    ram: '12 GB RAM',
    gpu: 'GTX 1060 6GB / RX 5700',
    storage: '70 GB SSD',
    dx: 'DirectX 12',
  },
  rec: {
    os: 'Windows 10/11 64-bit',
    cpu: 'Intel Core i7-8700K / AMD Ryzen 7 3700X',
    ram: '16 GB RAM',
    gpu: 'RTX 2060 Super / RX 5700 XT',
    storage: '70 GB NVMe SSD',
    dx: 'DirectX 12',
  },
}

// ─── Star rating selector ─────────────────────────────────────────────────────
function StarSelector({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: 10 }).map((_, i) => {
        const v = i + 1
        const active = v <= (hovered || value)
        return (
          <button
            key={v}
            onMouseEnter={() => setHovered(v)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: active ? '#f59e0b' : 'var(--text-muted)',
              fontSize: 18, transition: 'color 0.1s, transform 0.1s',
              transform: active ? 'scale(1.1)' : 'scale(1)',
            }}
          >★</button>
        )
      })}
      {value > 0 && (
        <span style={{ fontSize: 13, color: 'var(--accent-amber)', fontFamily: 'var(--font-display)', fontWeight: 700, marginLeft: 4, alignSelf: 'center' }}>
          {value}/10
        </span>
      )}
    </div>
  )
}

// ─── Review card ──────────────────────────────────────────────────────────────
function ReviewCard({ review }) {
  const initials = review.username?.slice(0, 2).toUpperCase() || '??'
  const date = new Date(review.created_at * 1000).toLocaleDateString('pl', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className={styles.reviewCard}>
      <div className={styles.reviewHeader}>
        <div className={styles.reviewAvatar}>{initials}</div>
        <div className={styles.reviewMeta}>
          <span className={styles.reviewUser}>{review.username}</span>
          <span className={styles.reviewDate}>{date}</span>
        </div>
        <div className={styles.reviewRating}>
          <Star size={12} fill="currentColor" />
          <span>{review.rating}/10</span>
        </div>
      </div>
      {review.body && <p className={styles.reviewBody}>{review.body}</p>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function GameDetailPage() {
  const { id }        = useParams()
  const navigate      = useNavigate()
  const { user }      = useAuthStore()
  const { addDownload } = useDownloadsStore()

  const [game, setGame]           = useState(null)
  const [reviews, setReviews]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeScreen, setActiveScreen] = useState(0)
  const [reqTab, setReqTab]       = useState('min')

  // Review form state
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewRating, setReviewRating]     = useState(0)
  const [reviewBody, setReviewBody]         = useState('')
  const [submitting, setSubmitting]         = useState(false)

  useEffect(() => {
    if (!id || !window.sealm) return
    setLoading(true)
    window.sealm.games.get({ id }).then(({ game, reviews }) => {
      setGame(game)
      setReviews(reviews || [])
      setLoading(false)
    })
  }, [id])

  const handleDownload = async () => {
    if (!user) return toast.error('Sign in to download gry')
    toast.loading(`🔍 Szukam na FitGirl…`, { id: 'fg' })
    try {
      const fg = await window.sealm.fitgirl.search({ query: game.title })
      toast.dismiss('fg')
      let magnetUri = null
      if (fg.success && fg.results.length > 0) {
        toast.loading('🧲 Downloads linku magnet…', { id: 'mg' })
        const page = await window.sealm.fitgirl.getMagnet({ url: fg.results[0].link })
        toast.dismiss('mg')
        if (page.success && page.magnets.length > 0) {
          magnetUri = page.magnets[0]
          toast.success('🧲 Znaleziono link magnet!')
          await window.sealm.torrent.start({ magnetUri, savePath: null })
        }
      } else {
        toast('⚠️ Not found on FitGirl — added to queue', { icon: '⚠️' })
      }
      await addDownload({ userId: user.id, gameId: game.id, gameTitle: game.title, magnetUri })
    } catch {
      toast.dismiss('fg'); toast.dismiss('mg')
      toast.error('Error podczas szukania gry')
    }
  }

  const submitReview = async () => {
    if (!reviewRating) return toast.error('Please select a rating (1–10)')
    if (!user) return toast.error('Sign in to add a review')
    setSubmitting(true)
    try {
      const result = await window.sealm.reviews.add({
        userId: user.id, gameId: id,
        rating: reviewRating, body: reviewBody.trim() || null,
      })
      if (result.success) {
        toast.success('✓ Review posted!')
        const u = window._sealmUser
        const uid = u?.uid || u?.id
        if (uid) {
          const reviewCount = await incrementCounter(uid, 'reviews_written')
          const unlocked = await checkAchievements(uid, 'review', { count: reviewCount })
          unlocked.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
        }
        setShowReviewForm(false)
        setReviewRating(0)
        setReviewBody('')
        // Refresh reviews
        const fresh = await window.sealm.games.get({ id })
        setReviews(fresh.reviews || [])
        setGame(g => ({ ...g, rating: fresh.game.rating }))
      } else {
        toast.error(result.error)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div className="skeleton" style={{ height: 200, borderRadius: 12, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 24, width: '40%', borderRadius: 6, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 14, width: '80%', borderRadius: 4 }} />
      </div>
    )
  }

  if (!game) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      Gra nie znaleziona.
      <br />
      <button onClick={() => navigate('/store')} style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--accent-violet-bright)', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 13 }}>
        ← Wróć do sklepu
      </button>
    </div>
  )

  const colors  = COVER_COLORS[game.id] || ['#111827','#1e2a3a','#94a3b8']
  const initials = game.title.split(' ').map(w => w[0]).join('').slice(0, 3)
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : game.rating

  return (
    <div className={styles.page}>
      {/* ── Back button ── */}
      <button className={styles.backBtn} onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> Powrót
      </button>

      {/* ── Hero ── */}
      <motion.div
        className={styles.hero}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` }}
      >
        <div className={styles.heroOverlay} />
        <div className={styles.heroCover}>
          <span style={{ color: colors[2] }}>{initials}</span>
        </div>
        <div className={styles.heroMeta}>
          {game.tags?.includes('new') && (
            <span className={styles.heroNewBadge}>NOWOŚĆ</span>
          )}
          <h1 className={styles.heroTitle}>{game.title}</h1>
          <div className={styles.heroTags}>
            <span className={styles.heroGenre}>{game.genre}</span>
            {game.release_year && <span className={styles.heroYear}>{game.release_year}</span>}
          </div>
          <div className={styles.heroStats}>
            <span className={styles.heroRating}>
              <Star size={14} fill="currentColor" /> {avgRating}
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>
                &nbsp;({reviews.length} recenzji)
              </span>
            </span>
            {game.size_gb && (
              <span className={styles.heroStat}>
                <HardDrive size={12} /> {game.size_gb} GB
              </span>
            )}
          </div>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.downloadBtn} onClick={handleDownload}>
            <Download size={14} /> Download bezpłatnie
          </button>
          <button className={styles.wishlistBtn}>♡ Obserwuj</button>
        </div>
      </motion.div>

      {/* ── Body grid ── */}
      <div className={styles.bodyGrid}>

        {/* ── Left column ── */}
        <div className={styles.leftCol}>

          {/* Description */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Opis</h3>
            <p className={styles.description}>
              {game.description || 'Brak opisu tej gry.'}
            </p>
            {/* Longer filler text if description is short */}
            {(game.description?.length || 0) < 120 && (
              <p className={styles.description} style={{ marginTop: 10 }}>
                Zanurz się w rozległym otwartym świecie pełnym misji pobocznych, postaci do spotkania i sekretów do odkrycia. Gra oferuje dziesiątki godzin rozgrywki z dynamicznym systemem walki i rozbudowanym drzewkiem umiejętności. Obsługuje modyfikacje — społeczność stworzyła tysiące dodatków dostępnych za darmo.
              </p>
            )}
          </section>

          {/* Screenshots */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Screenshoty</h3>
            <div className={styles.screenshotMain}
              style={{ background: `linear-gradient(135deg, ${MOCK_SCREENS[activeScreen].colors[0]}, ${MOCK_SCREENS[activeScreen].colors[1]})` }}
            >
              <span className={styles.screenshotLabel}>{MOCK_SCREENS[activeScreen].label}</span>
            </div>
            <div className={styles.screenshotThumbs}>
              {MOCK_SCREENS.map((s, i) => (
                <div
                  key={i}
                  className={`${styles.screenshotThumb} ${i === activeScreen ? styles.thumbActive : ''}`}
                  style={{ background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})` }}
                  onClick={() => setActiveScreen(i)}
                >
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-display)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Reviews */}
          <section className={styles.section}>
            <div className={styles.reviewsHeader}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                Reviews
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}> ({reviews.length})</span>
              </h3>
              {user && (
                <button
                  className={styles.addReviewBtn}
                  onClick={() => setShowReviewForm(v => !v)}
                >
                  {showReviewForm ? <><X size={12} /> Cancel</> : <><Star size={12} /> Rate game</>}
                </button>
              )}
            </div>

            {/* Review form */}
            <AnimatePresence>
              {showReviewForm && (
                <motion.div
                  className={styles.reviewForm}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <p className={styles.reviewFormLabel}>Twoja ocena</p>
                  <StarSelector value={reviewRating} onChange={setReviewRating} />
                  <textarea
                    className={styles.reviewTextarea}
                    placeholder="Write a review (opcjonalnie)…"
                    value={reviewBody}
                    onChange={e => setReviewBody(e.target.value)}
                    rows={3}
                  />
                  <button
                    className={styles.submitReviewBtn}
                    onClick={submitReview}
                    disabled={submitting || !reviewRating}
                  >
                    <Send size={12} />
                    {submitting ? 'Posting…' : 'Post Review'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Review list */}
            {reviews.length === 0 ? (
              <p className={styles.noReviews}>Bądź pierwszy/a — napisz recenzję!</p>
            ) : (
              <div className={styles.reviewList}>
                {reviews.map(r => <ReviewCard key={r.id} review={r} />)}
              </div>
            )}
          </section>
        </div>

        {/* ── Right sidebar ── */}
        <div className={styles.rightCol}>

          {/* Rating summary */}
          <div className={styles.ratingCard}>
            <div className={styles.ratingBig}>{avgRating}</div>
            <div className={styles.ratingStars}>
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} style={{ color: i < Math.round(avgRating) ? '#f59e0b' : 'var(--text-muted)', fontSize: 14 }}>★</span>
              ))}
            </div>
            <p className={styles.ratingCount}>{reviews.length} recenzji użytkowników</p>
          </div>

          {/* Tags */}
          {game.tags && (
            <div className={styles.tagsCard}>
              <p className={styles.cardLabel}>Tagi</p>
              <div className={styles.tagList}>
                {game.tags.split(',').map(t => (
                  <span key={t} className={styles.tag}>{t.trim()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Requirements */}
          <div className={styles.reqCard}>
            <div className={styles.reqTabs}>
              <button
                className={`${styles.reqTab} ${reqTab === 'min' ? styles.reqTabActive : ''}`}
                onClick={() => setReqTab('min')}
              >Minimalne</button>
              <button
                className={`${styles.reqTab} ${reqTab === 'rec' ? styles.reqTabActive : ''}`}
                onClick={() => setReqTab('rec')}
              >Zalecane</button>
            </div>
            {[
              { Icon: Monitor,     label: 'System',   val: REQUIREMENTS[reqTab].os },
              { Icon: Cpu,         label: 'Procesor', val: REQUIREMENTS[reqTab].cpu },
              { Icon: MemoryStick, label: 'RAM',      val: REQUIREMENTS[reqTab].ram },
              { Icon: Gamepad2,    label: 'Karta GPU',val: REQUIREMENTS[reqTab].gpu },
              { Icon: HardDrive,   label: 'Dysk',     val: REQUIREMENTS[reqTab].storage },
            ].map(({ Icon, label, val }) => (
              <div key={label} className={styles.reqRow}>
                <span className={styles.reqIcon}><Icon size={11} /></span>
                <div>
                  <p className={styles.reqLabel}>{label}</p>
                  <p className={styles.reqVal}>{val}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick download */}
          <button className={styles.sideDownloadBtn} onClick={handleDownload}>
            <Download size={15} /> Download teraz
            {game.size_gb && <span className={styles.sideDownloadSize}>{game.size_gb} GB</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

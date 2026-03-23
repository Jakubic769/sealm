import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Gamepad2, LogOut, Edit3, Trophy, Users, ChevronRight, X, Camera } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { get, ref } from 'firebase/database'
import { db } from '../../lib/firebase'
import GameCover from '../ui/GameCover'
import styles from './ProfilePage.module.css'

// ── Edit Profile Modal ────────────────────────────────────────────────────────
function EditProfileModal({ user, onClose }) {
  const { updateProfile } = useAuthStore()
  const [username,  setUsername]  = useState(user?.username  || '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '')
  const [bio,       setBio]       = useState(user?.bio       || '')
  const [saving,    setSaving]    = useState(false)

  const now = Math.floor(Date.now() / 1000)
  const DAY = 86400
  const usernameChangedAt = user?.username_changed_at || 0
  const usernameDaysLeft  = Math.max(0, Math.ceil(7 - (now - usernameChangedAt) / DAY))
  const usernameBlocked   = usernameDaysLeft > 0

  const save = async () => {
    setSaving(true)
    try {
      const res = await updateProfile({
        username:  usernameBlocked ? undefined : username.trim(),
        avatarUrl: avatarUrl.trim() || null,
        bio:       bio.trim(),
      })
      if (res.success) {
        toast.success('✓ Profile updated!')
        onClose()
      } else {
        toast.error(res.error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}
      onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ opacity:0, scale:0.94, y:14 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0 }}
        style={{ background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:16, padding:24, width:380, maxWidth:'90vw' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:700, letterSpacing:1 }}>Edit Profile</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer' }}><X size={16}/></button>
        </div>

        {/* Avatar preview */}
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
          <div style={{ width:64, height:64, borderRadius:'50%', overflow:'hidden', background:'var(--bg-elevated)', border:'2px solid var(--border)', flexShrink:0 }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, color:'var(--accent-violet-bright)' }}>
                  {user?.username?.slice(0,2).toUpperCase()}
                </div>
            }
          </div>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:11, fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:1, color:'var(--text-muted)', textTransform:'uppercase', display:'block', marginBottom:6 }}>
              <Camera size={10}/> Avatar URL
            </label>
            <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)}
              placeholder="https://i.imgur.com/... or any image URL"
              style={{ width:'100%', padding:'8px 10px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-primary)', fontSize:12, boxSizing:'border-box' }}/>
            <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>Paste any image URL (Imgur, Discord CDN, etc.)</p>
          </div>
        </div>

        {/* Username */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:1, color:'var(--text-muted)', textTransform:'uppercase', display:'block', marginBottom:6 }}>
            Username
          </label>
          <input type="text" value={username} onChange={e => !usernameBlocked && setUsername(e.target.value)}
            disabled={usernameBlocked}
            style={{ width:'100%', padding:'9px 12px', background: usernameBlocked ? 'var(--bg-card)' : 'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, color: usernameBlocked ? 'var(--text-muted)' : 'var(--text-primary)', fontSize:13, boxSizing:'border-box', opacity: usernameBlocked ? 0.6 : 1 }}/>
          {usernameBlocked && <p style={{ fontSize:10, color:'#f59e0b', marginTop:4 }}>🔒 Can change in {usernameDaysLeft} day{usernameDaysLeft !== 1 ? 's' : ''}</p>}
        </div>

        {/* Bio */}
        <div style={{ marginBottom:20 }}>
          <label style={{ fontSize:11, fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:1, color:'var(--text-muted)', textTransform:'uppercase', display:'block', marginBottom:6 }}>
            Bio
          </label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={200}
            placeholder="Tell others about yourself…"
            style={{ width:'100%', padding:'9px 12px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-primary)', fontSize:13, boxSizing:'border-box', resize:'vertical', minHeight:72, fontFamily:'inherit' }}/>
          <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{bio.length}/200</p>
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', borderRadius:8, background:'var(--bg-elevated)', border:'1px solid var(--border)', color:'var(--text-muted)', fontSize:12, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding:'8px 16px', borderRadius:8, background:'var(--accent-violet)', border:'none', color:'white', fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, cursor:'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [library,     setLibrary]     = useState([])
  const [achStats,    setAchStats]    = useState({ unlocked:0, total:0, points:0, percent:0 })
  const [friendCount, setFriendCount] = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [showEdit,    setShowEdit]    = useState(false)

  useEffect(() => {
    if (!user) return
    Promise.all([
      window.sealm?.library?.list?.({ userId: user.id || user.uid }),
      window.sealm?.achievements?.stats?.({ userId: user.id || user.uid }),
      // Friends count from Firebase
      import('firebase/database').then(({ get, ref }) =>
        get(ref(db, `friends/${user.uid}`)).then(s => s.size || 0).catch(() => 0)
      ),
    ]).then(([lib, ach, fCount]) => {
      setLibrary(lib || [])
      setAchStats(ach || {})
      setFriendCount(fCount)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [user?.uid])

  const handleLogout = async () => { await logout(); navigate('/auth') }

  const totalHours  = Math.round(library.reduce((s, i) => s + (i.playtime_min || 0), 0) / 60)
  const recentGames = [...library].sort((a, b) => (b.last_played||0) - (a.last_played||0)).slice(0, 4)
  const initials    = user?.username?.slice(0, 2).toUpperCase() || 'U'

  const STATS = [
    { Icon: Clock,    val: `${totalHours}h`,         label: 'Playtime',     color: 'var(--accent-cyan)' },
    { Icon: Gamepad2, val: library.length,            label: 'Games',        color: 'var(--accent-violet-bright)' },
    { Icon: Trophy,   val: `${achStats.unlocked||0}`, label: 'Achievements', color: 'var(--accent-amber)' },
    { Icon: Users,    val: friendCount,               label: 'Friends',      color: 'var(--accent-green)' },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.accentLine}/>
      <h2 className={styles.pageTitle}>Profile</h2>

      <motion.div className={styles.profileCard} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}>
        <div className={styles.profileGlow}/>

        {/* Avatar */}
        <div className={styles.avatar} style={{ padding:0, overflow:'hidden' }}>
          {user?.avatarUrl
            ? <img src={user.avatarUrl} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            : <span style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:700 }}>{initials}</span>
          }
        </div>

        <div className={styles.profileInfo}>
          <h3 className={styles.username}>{user?.username}</h3>
          <p className={styles.email}>{user?.email}</p>
          {user?.bio && <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:4, maxWidth:300 }}>{user.bio}</p>}
        </div>

        <div className={styles.profileActions}>
          <button className={styles.editBtn} onClick={() => setShowEdit(true)}>
            <Edit3 size={12}/> Edit Profile
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={12}/> Sign Out
          </button>
        </div>
      </motion.div>

      <div className={styles.statsGrid}>
        {STATS.map(({ Icon, val, label, color }, i) => (
          <motion.div key={label} className={styles.statCard}
            initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
            transition={{ delay: 0.05 + i * 0.06 }}>
            <Icon size={18} color={color}/>
            <p className={styles.statVal} style={{ color }}>{val}</p>
            <p className={styles.statLabel}>{label}</p>
          </motion.div>
        ))}
      </div>

      <Link to="/achievements" className={styles.achBanner}>
        <Trophy size={16} color="var(--accent-amber)"/>
        <div className={styles.achBannerInfo}>
          <p className={styles.achBannerTitle}>Achievements</p>
          <p className={styles.achBannerSub}>{achStats.unlocked||0}/{achStats.total||0} · {achStats.points||0} pts</p>
        </div>
        <div className={styles.achBannerBar}>
          <div className={styles.achBannerTrack}>
            <div className={styles.achBannerFill} style={{ width:`${achStats.percent||0}%`}}/>
          </div>
          <span className={styles.achBannerPct}>{achStats.percent||0}%</span>
        </div>
        <ChevronRight size={14} color="var(--text-muted)"/>
      </Link>

      {recentGames.length > 0 && (
        <section>
          <div className={styles.sectionLabel}>
            Recently Played
            <Link to="/library" className={styles.sectionLink}>View all →</Link>
          </div>
          <div className={styles.recentGrid}>
            {recentGames.map((item, i) => {
              const hours = Math.round((item.playtime_min||0)/60*10)/10
              const last  = item.last_played
                ? new Date(item.last_played*1000).toLocaleDateString('en', { day:'numeric', month:'short' })
                : 'Never'
              return (
                <motion.div key={item.id} className={styles.recentCard}
                  initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                  transition={{ delay: 0.2 + i * 0.05 }}>
                  <div className={styles.recentCover}>
                    <GameCover gameId={item.game_id} title={item.title}
                      existingCoverUrl={item.cover_url} height={90} fontSize={16}/>
                  </div>
                  <div className={styles.recentInfo}>
                    <p className={styles.recentTitle}>{item.title}</p>
                    <p className={styles.recentMeta}><Clock size={9}/> {hours}h · {last}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </section>
      )}

      <AnimatePresence>
        {showEdit && <EditProfileModal user={user} onClose={() => setShowEdit(false)}/>}
      </AnimatePresence>
    </div>
  )
}

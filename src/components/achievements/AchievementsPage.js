import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Star } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { subscribeAchievements, getUserAchievements, ACHIEVEMENTS } from '../../lib/firebaseAchievements'
import styles from './AchievementsPage.module.css'

const EMPTY = {
  list: ACHIEVEMENTS.map(a => ({ ...a, unlocked: false })),
  unlocked: 0, total: ACHIEVEMENTS.length, points: 0, percent: 0
}

function AchievementCard({ ach, index }) {
  const locked = !ach.unlocked
  return (
    <motion.div
      className={`${styles.card} ${locked ? styles.cardLocked : styles.cardUnlocked}`}
      initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
      transition={{ delay: index * 0.03 }}
    >
      <div className={styles.cardIcon} style={{ opacity: locked ? 0.4 : 1 }}>
        {ach.icon}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.cardTitle}>
          {locked ? '???' : ach.title}
        </p>
        <p className={styles.cardDesc}>
          {locked ? 'Unlock this achievement' : ach.desc}
        </p>
        {!locked && ach.unlockedAt && (
          <p className={styles.cardDate}>
            {ach.unlockedAt > 1000000000000 ? new Date(ach.unlockedAt).toLocaleDateString('en', { day:'numeric', month:'short', year:'numeric' }) : ''}
          </p>
        )}
      </div>
      <div className={styles.cardPoints}>
        <Star size={11} fill={locked ? 'none' : 'var(--accent-amber)'}/> {ach.points}
      </div>
    </motion.div>
  )
}

export default function AchievementsPage() {
  const { user } = useAuthStore()
  const [data,    setData]    = useState(EMPTY)
  const [filter,  setFilter]  = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const uid = user?.uid || user?.id

    // 1. Load from SQLite via IPC (works immediately, no Firebase rules needed)
    if (uid && window.sealm?.achievements?.list) {
      window.sealm.achievements.list({ userId: uid }).then(sqliteList => {
        if (sqliteList?.length > 0) {
          // Map SQLite achievements to our format
          const unlockedKeys = new Set(sqliteList.filter(a => a.unlocked).map(a => a.key))
          const list = ACHIEVEMENTS.map(a => ({
            ...a,
            unlocked:   unlockedKeys.has(a.key),
            unlockedAt: sqliteList.find(s => s.key === a.key)?.unlocked_at || null,
          }))
          const unlockedCount = list.filter(a => a.unlocked).length
          const totalPoints   = list.filter(a => a.unlocked).reduce((s, a) => s + a.points, 0)
          setData({ list, unlocked: unlockedCount, total: ACHIEVEMENTS.length, points: totalPoints, percent: Math.round(unlockedCount / ACHIEVEMENTS.length * 100) })
        } else {
          setData(EMPTY)
        }
        setLoading(false)
      }).catch(() => { setData(EMPTY); setLoading(false) })
    } else {
      setData(EMPTY)
      setLoading(false)
    }

    // 2. Also try Firebase for realtime updates (works if rules allow)
    if (!uid) return
    let cancelled = false
    getUserAchievements(uid)
      .then(result => { if (!cancelled && result.unlocked > 0) setData(result) })
      .catch(() => {})
    const unsub = subscribeAchievements(uid, (result) => {
      if (!cancelled && result.unlocked > 0) setData(result)
    })
    return () => { cancelled = true; unsub() }
  }, [user?.uid, user?.id])

  const filtered = data.list.filter(a => {
    if (filter === 'unlocked') return a.unlocked
    if (filter === 'locked')   return !a.unlocked
    return true
  })

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.accentLine}/>
        <h2 className={styles.pageTitle}>Trophies</h2>
      </div>

      <motion.div className={styles.statsBar} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}>
        <div className={styles.statBox}>
          <Trophy size={20} color="var(--accent-amber)" fill="var(--accent-amber)"/>
          <div>
            <p className={styles.statVal}>{data.unlocked}/{data.total}</p>
            <p className={styles.statLbl}>Unlocked</p>
          </div>
        </div>
        <div className={styles.progressWrap}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width:`${data.percent}%` }}/>
          </div>
        </div>
        <span className={styles.progressLabel}>{data.percent}%</span>
        <div className={styles.statBox}>
          <Star size={20} color="var(--accent-violet-bright)" fill="var(--accent-violet-bright)"/>
          <div>
            <p className={styles.statVal}>{data.points}</p>
            <p className={styles.statLbl}>Points</p>
          </div>
        </div>
      </motion.div>

      <div className={styles.filterRow}>
        {[
          { key:'all',      label:`All (${data.list.length})` },
          { key:'unlocked', label:`Unlocked (${data.unlocked})` },
          { key:'locked',   label:`Locked (${data.total - data.unlocked})` },
        ].map(f => (
          <button key={f.key}
            className={`${styles.filterBtn} ${filter === f.key ? styles.filterActive : ''}`}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`${styles.card} skeleton`} style={{ height:70 }}/>
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((a, i) => <AchievementCard key={a.key} ach={a} index={i}/>)}
        </div>
      )}
    </div>
  )
}

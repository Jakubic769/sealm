import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { UserPlus, UserCheck, UserX, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import {
  subscribeFriends, subscribePendingRequests,
  sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, searchUsers
} from '../../lib/firebaseFriends'
import styles from './FriendsPage.module.css'

function Avatar({ username, size = 40, online }) {
  const color = online ? 'rgba(16,185,129,0.15)' : 'var(--bg-elevated)'
  const textColor = online ? 'var(--accent-green)' : 'var(--text-muted)'
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={{ width:size, height:size, borderRadius:'50%', background:color, color:textColor,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--font-display)', fontWeight:700, fontSize: size * 0.35 }}>
        {username?.slice(0,2).toUpperCase()}
      </div>
      {online !== undefined && (
        <span className={`${styles.statusDot} ${online ? styles.dotOnline : styles.dotOffline}`}
          style={{ position:'absolute', bottom:0, right:0, width:10, height:10, borderRadius:'50%', border:'2px solid var(--bg-deepest)' }}/>
      )}
    </div>
  )
}

function FriendCard({ friend, onRemove }) {
  return (
    <motion.div className={styles.friendCard} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}>
      <Avatar username={friend.username} online={friend.is_online}/>
      <div className={styles.friendInfo}>
        <p className={styles.friendName}>{friend.username}</p>
        <p className={styles.friendStatus}>
          {friend.is_online ? '● Online' : '○ Offline'}
        </p>
      </div>
      <div className={styles.friendActions}>
        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={() => onRemove(friend)} title="Remove friend">
          <UserX size={13}/>
        </button>
      </div>
    </motion.div>
  )
}

function RequestCard({ req, onAccept, onDecline }) {
  return (
    <motion.div className={styles.pendingCard} initial={{ opacity:0, x:-10 }} animate={{ opacity:1, x:0 }}>
      <Avatar username={req.fromUsername}/>
      <div className={styles.friendInfo}>
        <p className={styles.friendName}>{req.fromUsername}</p>
        <p className={styles.friendStatus}>Friend Request</p>
      </div>
      <div className={styles.friendActions}>
        <button className={styles.acceptBtn} onClick={() => onAccept(req)} title="Accept">
          <UserCheck size={13}/>
        </button>
        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={() => onDecline(req)} title="Decline">
          <UserX size={13}/>
        </button>
      </div>
    </motion.div>
  )
}

export default function FriendsPage() {
  const { user } = useAuthStore()
  const [friends,   setFriends]   = useState([])
  const [requests,  setRequests]  = useState([])
  const [search,    setSearch]    = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    const unsubF = subscribeFriends(user.uid, setFriends)
    const unsubR = subscribePendingRequests(user.uid, (reqs) => {
      setRequests(prev => {
        if (reqs.length > prev.length && reqs.length > 0) {
          toast(`👋 ${reqs[reqs.length-1].fromUsername} wants to add you as a friend`, { icon:'🤝', duration:5000 })
        }
        return reqs
      })
    })
    return () => { unsubF(); unsubR() }
  }, [user?.uid])

  const handleSearch = async () => {
    if (!addSearch.trim()) return
    setSearching(true)
    try {
      const res = await searchUsers(addSearch.trim())
      setResults(res.filter(u => u.uid !== user.uid))
    } finally { setSearching(false) }
  }

  const handleAdd = async (target) => {
    const res = await sendFriendRequest(user.uid, user.username, target.uid)
    if (res.success) { toast.success(`✓ Request sent to ${target.username}`); setResults([]) }
    else toast.error(res.error)
  }

  const handleAccept = async (req) => {
    const res = await acceptFriendRequest(user.uid, user.username, req.fromUid)
    if (res.success) {
      toast.success(`✓ ${req.fromUsername} added as friend`)
      // Check friend achievements
      const newFriendCount = friends.length + 1
      const unlocked = await checkAchievements(user.uid, 'friend', { count: newFriendCount })
      unlocked.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
    } else toast.error(res.error)
  }

  const handleDecline = async (req) => {
    await declineFriendRequest(user.uid, req.fromUid)
    toast('Request declined')
  }

  const handleRemove = async (friend) => {
    await removeFriend(user.uid, friend.uid)
    toast(`Removed ${friend.username}`)
  }

  const filtered = friends.filter(f => !search || f.username?.toLowerCase().includes(search.toLowerCase()))
  const online   = filtered.filter(f => f.is_online)
  const offline  = filtered.filter(f => !f.is_online)

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine}/>
          <h2 className={styles.pageTitle}>Friends</h2>
          <p className={styles.pageSub}>{friends.length} friends · {online.length} online</p>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Left: friends list */}
        <div className={styles.listCol}>
          <div className={styles.searchBar}>
            <Search size={13} color="var(--text-muted)"/>
            <input className={styles.searchInput} placeholder="Search friends…"
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>

          {/* Pending requests */}
          {requests.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>
                Friend Requests
                <span className={styles.badgeGreen}>{requests.length}</span>
              </p>
              {requests.map(r => (
                <RequestCard key={r.id} req={r} onAccept={handleAccept} onDecline={handleDecline}/>
              ))}
            </div>
          )}

          {/* Online */}
          {online.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>
                Online <span className={styles.badgeGreen}>{online.length}</span>
              </p>
              {online.map(f => <FriendCard key={f.uid} friend={f} onRemove={handleRemove}/>)}
            </div>
          )}

          {/* Offline */}
          {offline.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>Offline</p>
              {offline.map(f => <FriendCard key={f.uid} friend={f} onRemove={handleRemove}/>)}
            </div>
          )}

          {filtered.length === 0 && requests.length === 0 && (
            <p className={styles.empty}>No friends yet — add one using the panel on the right!</p>
          )}
        </div>

        {/* Right: add friend + stats */}
        <div>
          <div className={styles.addPanel}>
            <p className={styles.addTitle}><UserPlus size={14}/> Add Friend</p>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input
                style={{ flex:1, padding:'8px 10px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', color:'var(--text-primary)', fontSize:12, outline:'none' }}
                placeholder="Enter player name…"
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button className={styles.addBtn} onClick={handleSearch} disabled={searching}>
                {searching ? '…' : 'Search'}
              </button>
            </div>

            {results.length > 0 && (
              <div className={styles.searchDropdown}>
                {results.map(u => (
                  <div key={u.uid} className={styles.searchResult}>
                    <Avatar username={u.username} size={28}/>
                    <span className={styles.resultName}>{u.username}</span>
                    <button className={styles.addBtn} onClick={() => handleAdd(u)}>
                      <UserPlus size={11}/> Add
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.statsSummary}>
              <div className={styles.summaryRow}>
                <span>Total friends</span>
                <span className={styles.summaryVal}>{friends.length}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Online now</span>
                <span className={styles.summaryValGreen}>{online.length}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Pending requests</span>
                <span className={styles.summaryValAmber}>{requests.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

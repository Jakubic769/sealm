import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Wifi, WifiOff, Circle } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { sendMessage, subscribeMessages, subscribeOnlineUsers, setTyping, subscribeTyping } from '../../lib/firebaseChat'
import { checkAchievements, incrementCounter } from '../../lib/firebaseAchievements'
import styles from './ChatPage.module.css'

function formatTime(ts) {
  if (!ts) return ''
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

function getColor(username) {
  const palette = ['var(--accent-violet-bright)','var(--accent-cyan)','var(--accent-green)','#f59e0b','#f87171','#a5b4fc','#6ee7b7','#fde68a']
  let hash = 0
  for (const c of (username || '')) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

function MessageBubble({ msg, isOwn, prevMsg }) {
  const showHeader = !prevMsg || prevMsg.userId !== msg.userId
  const color = isOwn ? 'var(--accent-violet-bright)' : getColor(msg.username)
  return (
    <motion.div className={`${styles.msg} ${isOwn ? styles.msgOwn : ''}`}
      initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.12 }}>
      {showHeader && !isOwn && (
        <div className={styles.msgAvatar} style={{ background:`${color}22`, color }}>
          {msg.username?.slice(0,2).toUpperCase()}
        </div>
      )}
      {!showHeader && !isOwn && <div className={styles.msgAvatarSpacer}/>}
      <div className={styles.msgContent}>
        {showHeader && (
          <div className={styles.msgMeta}>
            <span className={styles.msgName} style={{ color }}>{isOwn ? 'You' : msg.username}</span>
            <span className={styles.msgTime}>{formatTime(msg.sentAt)}</span>
          </div>
        )}
        <div className={`${styles.msgBubble} ${isOwn ? styles.bubbleOwn : styles.bubbleOther}`}>
          {msg.body}
        </div>
      </div>
    </motion.div>
  )
}

function TypingIndicator({ typers }) {
  if (!typers.length) return null
  const text = typers.length === 1 ? `${typers[0]} is typing…` : `${typers.slice(0,2).join(', ')} are typing…`
  return <div className={styles.typing}><span className={styles.typingDots}/> {text}</div>
}

export default function ChatPage() {
  const { user } = useAuthStore()
  const [messages,     setMessages]     = useState([])
  const [onlineUsers,  setOnlineUsers]  = useState([])
  const [typers,       setTypers]       = useState([])
  const [text,         setText]         = useState('')
  const [connected,    setConnected]    = useState(false)
  const bottomRef = useRef(null)
  const typingTimer = useRef(null)

  useEffect(() => {
    if (!user) return

    setConnected(true)

    // Subscribe to messages
    const unsubMsg = subscribeMessages('general', (msgs) => {
      setMessages(msgs)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior:'smooth' }), 100)
    })

    // Subscribe to online users
    const unsubOnline = subscribeOnlineUsers(setOnlineUsers)

    // Subscribe to typing
    const unsubTyping = subscribeTyping('general', (t) => {
      setTypers(t.filter(name => name !== user.username))
    })

    return () => {
      unsubMsg()
      unsubOnline()
      unsubTyping()
    }
  }, [user])

  const handleSend = async () => {
    if (!text.trim() || !user) return
    const body = text.trim()
    setText('')
    setTyping('general', user.uid, user.username, false)
    await sendMessage({ channelId:'general', userId:user.uid, username:user.username, body })
    // Track message count and check Chatterbox achievement
    const msgCount = await incrementCounter(user.uid, 'messages_sent')
    const unlocked = await checkAchievements(user.uid, 'chat', { count: msgCount })
    unlocked.forEach(a => window.dispatchEvent(new CustomEvent('sealm:achievement', { detail: a })))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    // Typing indicator
    setTyping('general', user.uid, user.username, true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      setTyping('general', user.uid, user.username, false)
    }, 3000)
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine}/>
          <h2 className={styles.pageTitle}>Community</h2>
        </div>
        <div className={`${styles.connBadge} ${connected ? styles.connOnline : styles.connOffline}`}>
          {connected ? <><Wifi size={11}/> Connected</> : <><WifiOff size={11}/> Connecting…</>}
        </div>
      </div>

      <div className={styles.layout}>
        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={`${styles.channelItem} ${styles.channelActive}`}>
            <span className={styles.channelHash}>#</span>
            <span className={styles.channelName}>General</span>
          </div>
          <div className={styles.sideSection}>
            Online <span className={styles.onlineCount}>{onlineUsers.length}</span>
          </div>
          {onlineUsers.map(u => {
            const color = getColor(u.username)
            const isMe = u.uid === user?.uid
            return (
              <div key={u.uid} className={styles.userItem}>
                <div className={styles.userAvatar} style={{ background:`${color}22`, color }}>
                  {u.username?.slice(0,2).toUpperCase()}
                  <span className={styles.onlineDot}/>
                </div>
                <span className={styles.userName}>{isMe ? `${u.username} (You)` : u.username}</span>
              </div>
            )
          })}
          {/* Show self if not in online list yet */}
          {user && !onlineUsers.find(u => u.uid === user.uid) && (
            <div className={styles.userItem}>
              <div className={styles.userAvatar} style={{ background:'rgba(139,92,246,0.2)', color:'var(--accent-violet-bright)' }}>
                {user.username?.slice(0,2).toUpperCase()}
                <span className={styles.onlineDot}/>
              </div>
              <span className={styles.userName}>{user.username} (You)</span>
            </div>
          )}
        </div>

        {/* Chat panel */}
        <div className={styles.chatPanel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}># General</span>
            <span className={styles.channelBadge}>Public</span>
            <span className={styles.panelOnline}>
              <Circle size={7} fill="var(--accent-green)" color="var(--accent-green)"/>
              {onlineUsers.length} online
            </span>
          </div>

          <div className={styles.messages}>
            {messages.length === 0 && (
              <div className={styles.emptyChat}>
                {connected ? 'No messages yet. Be the first!' : 'Connecting to chat…'}
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg}
                isOwn={msg.userId === user?.uid}
                prevMsg={i > 0 ? messages[i-1] : null}/>
            ))}
            <TypingIndicator typers={typers}/>
            <div ref={bottomRef}/>
          </div>

          <div className={styles.inputRow}>
            <input
              className={styles.input}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message #General… (Enter to send)"
              maxLength={500}
            />
            <button className={styles.sendBtn} onClick={handleSend} disabled={!text.trim()}>
              <Send size={15}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

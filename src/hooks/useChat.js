/**
 * src/hooks/useChat.js
 *
 * React hook zarządzający połączeniem WebSocket z serwerem czatu w Elektronie.
 *
 * Zwraca:
 *  - messages       : wiadomości aktualnego kanału / DM
 *  - onlineUsers    : lista zalogowanych graczy
 *  - connected      : stan połączenia
 *  - sendMessage(body, channel?, receiverId?)
 *  - sendTyping(channel?, peerId?)
 *  - typingUsers    : kto teraz pisze
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'

const RECONNECT_MS = 3000

export function useChat({ channel = 'general', peerId = null } = {}) {
  const { token, user }  = useAuthStore()
  const wsRef            = useRef(null)
  const reconnectTimer   = useRef(null)
  const mountedRef       = useRef(true)

  const [connected,   setConnected]   = useState(false)
  const [messages,    setMessages]    = useState([])
  const [onlineUsers, setOnlineUsers] = useState([])
  const [typingUsers, setTypingUsers] = useState({})   // userId → username
  const typingTimers = useRef({})

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!token || !window.sealm) return

    let port = 45678
    try { port = await window.sealm.chat.getWsPort() } catch {}

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      // Authenticate immediately
      ws.send(JSON.stringify({ type: 'auth', token }))
    }

    ws.onmessage = (e) => {
      if (!mountedRef.current) return
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      handleServerMessage(msg)
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnected(false)
      // Reconnect
      reconnectTimer.current = setTimeout(connect, RECONNECT_MS)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [token])

  // ── Handle server messages ─────────────────────────────────────────────────
  const handleServerMessage = useCallback((msg) => {
    switch (msg.type) {

      case 'auth_ok':
        setConnected(true)
        break

      case 'auth_error':
        setConnected(false)
        break

      case 'history':
        setMessages(msg.messages || [])
        break

      case 'message': {
        const m = msg.message
        // Filter to current view: general channel or this DM pair
        const isGeneral  = channel === 'general' && m.channel === 'general'
        const isDmMatch  = peerId &&
          ((m.sender_id === user?.id && m.receiver_id === peerId) ||
           (m.sender_id === peerId   && m.receiver_id === user?.id))

        if (isGeneral || isDmMatch) {
          setMessages(prev => {
            if (prev.some(p => p.id === m.id)) return prev
            return [...prev, m]
          })
        }

        // Native notification for DMs when window not focused
        if (m.receiver_id === user?.id && window.sealm) {
          window.sealm.notifications.notifyChatMessage({
            username: m.username,
            body: m.body,
            isDM: true,
          })
        }
        break
      }

      case 'online_list':
        setOnlineUsers(msg.users || [])
        break

      case 'typing': {
        const uid  = msg.userId
        const name = msg.username
        // Show typing indicator for 3s
        if (typingTimers.current[uid]) clearTimeout(typingTimers.current[uid])
        setTypingUsers(prev => ({ ...prev, [uid]: name }))
        typingTimers.current[uid] = setTimeout(() => {
          setTypingUsers(prev => {
            const next = { ...prev }
            delete next[uid]
            return next
          })
        }, 3000)
        break
      }

      default:
        break
    }
  }, [channel, peerId, user?.id])

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback((body, chan = channel, rcvId = peerId) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({
      type:       'message',
      body,
      channel:    rcvId ? null : chan,
      receiverId: rcvId || null,
    }))
    return true
  }, [channel, peerId])

  // ── Send typing indicator ───────────────────────────────────────────────────
  const sendTyping = useCallback((chan = channel, pId = peerId) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'typing', channel: chan, peerId: pId }))
  }, [channel, peerId])

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearTimeout(reconnectTimer.current)
      Object.values(typingTimers.current).forEach(clearTimeout)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  // Re-fetch history when channel/peerId changes
  useEffect(() => {
    setMessages([])
    // Ask server for DM history via REST (IPC fallback)
    if (!window.sealm || !user) return
    if (peerId) {
      window.sealm.messages.list({ userId: user.id, peerId }).then(msgs => {
        if (msgs) setMessages(msgs)
      })
    }
  }, [channel, peerId, user?.id])

  return {
    connected,
    messages,
    onlineUsers,
    typingUsers,
    sendMessage,
    sendTyping,
  }
}

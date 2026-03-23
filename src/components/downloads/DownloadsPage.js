import React, { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, Play, Pause, Zap, Clock, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Terminal, FolderOpen, Package } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import styles from './DownloadsPage.module.css'

function getStatus(t) { return {
  queued:      { label: 'QUEUED',      color: '#64748b' },
  downloading: { label: 'DOWNLOADING', color: '#22d3ee' },
  installing:  { label: 'INSTALLING',  color: '#f59e0b' },
  completed:   { label: 'COMPLETED',   color: '#4ade80' },
  paused:      { label: 'PAUSED',      color: '#94a3b8' },
  error:       { label: 'ERROR',       color: '#f87171' },
}}

function fmtSpeed(k) {
  if (!k || k <= 0) return null
  return k > 1024 ? `${(k/1024).toFixed(1)} MB/s` : `${Math.round(k)} KB/s`
}
function fmtETA(s) {
  if (!s || s <= 0) return null
  if (s < 60)   return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.round(s%60)}s`
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
}

export default function DownloadsPage() {
  const { user } = useAuthStore()
  const { downloads, fetch, stopPolling } = useDownloadsStore()

  // liveData — dane na żywo z IPC, klucz: downloadId
  const [liveData,  setLiveData]  = useState({})
  const [warnings,  setWarnings]  = useState({})
  const [logs,      setLogs]      = useState([])
  const [logsOpen,  setLogsOpen]  = useState(false)
  const logsRef = useRef(null)

  const addLog = (msg) => {
    const t = new Date().toLocaleTimeString('pl', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    setLogs(prev => [...prev.slice(-299), { t, msg: String(msg) }])
  }

  useEffect(() => {
    if (!user || !window.sealm) return
    fetch(user.uid || user.id)

    const unsubs = []
    const s = window.sealm.torrent

    if (s?.onLog) unsubs.push(s.onLog(msg => addLog(msg)))

    if (s?.onProgress) unsubs.push(s.onProgress(d => {
      // Aktualizuj live data i zmień status na 'downloading'
      setLiveData(p => ({ ...p, [d.downloadId]: {
        ...p[d.downloadId], ...d,
        status: 'downloading',
      }}))
    }))

    if (s?.onMetadata) unsubs.push(s.onMetadata(d => {
      addLog(`📦 ${d.name} | ${Math.round((d.size||0)/1024/1024)}MB`)
      setLiveData(p => ({ ...p, [d.downloadId]: { ...p[d.downloadId], name: d.name, status: 'downloading' }}))
    }))

    if (s?.onPeer) unsubs.push(s.onPeer(d =>
      addLog(`🔗 ${d.address} (${d.totalPeers} total)`)
    ))

    if (s?.onWarning) unsubs.push(s.onWarning(d => {
      addLog(`⚠️ ${d.warning}`)
      setWarnings(p => ({ ...p, [d.downloadId]: d.warning }))
    }))

    if (s?.onDone) unsubs.push(s.onDone(d => {
      addLog(`✅ Downloaded: ${d.gameTitle}`)
      setLiveData(p => ({ ...p, [d.downloadId]: {
        ...p[d.downloadId],
        status: 'completed',
        progress: 100,
        savePath: d.savePath,
        gameTitle: d.gameTitle,
      }}))
      fetch(user.uid || user.id)
    }))

    if (s?.onError) unsubs.push(s.onError(d => {
      addLog(`❌ ${d.error}`)
      setLiveData(p => ({ ...p, [d.downloadId]: { ...p[d.downloadId], status: 'error' }}))
      fetch(user.uid || user.id)
    }))

    if (s?.onGameInstalled) unsubs.push(s.onGameInstalled(d => {
      addLog(`🎮 Zainstalowano: ${d.gameTitle}`)
      fetch(user.uid || user.id)
    }))

    const iv = setInterval(() => fetch(user.uid || user.id), 4000)
    return () => {
      stopPolling()
      unsubs.forEach(f => { try { if (typeof f === 'function') f() } catch {} })
      clearInterval(iv)
    }
  }, [user])

  useEffect(() => {
    if (logsOpen && logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs, logsOpen])

  // Scal DB z live danymi — live data ma priorytet
  const merged = downloads.map(d => {
    const live = liveData[d.id] || {}
    return {
      ...d,
      title:       d.title || d.game_title || 'Downloads',
      status:      live.status      || d.status      || 'queued',
      progress:    live.progress    ?? d.progress    ?? 0,
      speed_kbps:  live.speedKbps   ?? d.speed_kbps  ?? 0,
      eta_seconds: live.etaSec      ?? d.eta_seconds,
      peers:       live.peers       ?? 0,
      phase:       live.phase       || 'downloading',
      warning:     warnings[d.id],
      savePath:    live.savePath    || d.save_path,
      gameTitle:   live.gameTitle   || d.game_title  || d.title,
    }
  })

  // Dodaj też pobierania które są tylko w liveData (nie ma ich jeszcze w DB)
  const dbIds = new Set(downloads.map(d => d.id))
  Object.entries(liveData).forEach(([id, live]) => {
    if (!dbIds.has(id)) {
      merged.push({
        id,
        title:      live.gameTitle || live.name || 'Downloads',
        status:     live.status || 'downloading',
        progress:   live.progress || 0,
        speed_kbps: live.speedKbps || 0,
        eta_seconds:live.etaSec,
        peers:      live.peers || 0,
        phase:      live.phase || 'downloading',
        savePath:   live.savePath,
        gameTitle:  live.gameTitle,
        warning:    warnings[id],
      })
    }
  })

  const active  = merged.filter(d => d.status === 'downloading')
  const queued  = merged.filter(d => d.status === 'queued')
  const done    = merged.filter(d => d.status === 'completed' || d.status === 'installing')
  const errored = merged.filter(d => d.status === 'error')
  const totalSpeed = active.reduce((s, d) => s + (d.speed_kbps || 0), 0)

  const pause  = id => window.sealm?.torrent?.pause?.({ downloadId: id })
  const resume = id => window.sealm?.torrent?.resume?.({ downloadId: id })
  const remove = async id => {
    await window.sealm?.downloads?.remove?.({ id })
    await window.sealm?.torrent?.remove?.({ downloadId: id })
    setLiveData(p => { const n = {...p}; delete n[id]; return n })
    if (user) fetch(user.uid || user.id)
  }

  const launchSetup = async (d) => {
    const result = await window.sealm?.torrent?.launchSetup?.({
      savePath: d.savePath,
      gameTitle: d.gameTitle || d.title,
      downloadId: d.id,
    })
    if (result?.error) addLog(`❌ ${result.error}`)
    else addLog(`▶ Uruchamiam instalator: ${d.gameTitle || d.title}`)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.accentLine}/>
          <h2 className={styles.pageTitle}>Downloads</h2>
          {active.length > 0 && (
            <div className={styles.statsRow}>
              <span><Zap size={11}/> {active.length} active</span>
              {totalSpeed > 0 && <span className={styles.speedBig}>{fmtSpeed(totalSpeed)}</span>}
              {queued.length > 0 && <span><Clock size={11}/> {queued.length} in queue</span>}
            </div>
          )}
        </div>
      </div>

      {/* Logi */}
      <div className={styles.logPanel}>
        <button className={styles.logToggle} onClick={() => setLogsOpen(o => !o)} type="button">
          <Terminal size={13}/>
          <span>{'Logs'} ({logs.length})</span>
          {logsOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
        </button>
        {logsOpen && (
          <div className={styles.logBody} ref={logsRef}>
            {logs.length === 0
              ? <span style={{ color:'#4a5568' }}>Brak logów.</span>
              : logs.map((l, i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'1px 0' }}>
                  <span style={{ color:'#4a5568', flexShrink:0 }}>{l.t}</span>
                  <span style={{ color:
                    l.msg.includes('❌') ? '#f87171' :
                    l.msg.includes('✅') || l.msg.includes('🔗') || l.msg.includes('🎮') ? '#4ade80' :
                    l.msg.includes('⚠️') ? '#f59e0b' : '#94a3b8'
                  }}>{l.msg}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {merged.length === 0 && (
        <div className={styles.empty}>
          <Zap size={36} style={{ opacity:0.2 }}/>
          <p>No downloads</p>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>Go to Store and click Download</p>
        </div>
      )}

      {active.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>{'Active'}</p>
          {active.map(d => <DlCard key={d.id} d={d} onPause={pause} onResume={resume} onRemove={remove} onLaunch={launchSetup}/>)}
        </div>
      )}
      {queued.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>{'Queue'}</p>
          {queued.map(d => <DlCard key={d.id} d={d} onPause={pause} onResume={resume} onRemove={remove} onLaunch={launchSetup}/>)}
        </div>
      )}
      {errored.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel} style={{ color:'#f87171' }}>{'Errors'}</p>
          {errored.map(d => <DlCard key={d.id} d={d} onPause={pause} onResume={resume} onRemove={remove} onLaunch={launchSetup}/>)}
        </div>
      )}
      {done.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>{'Completed'}</p>
          {done.map(d => <DlCard key={d.id} d={d} onPause={pause} onResume={resume} onRemove={remove} onLaunch={launchSetup}/>)}
        </div>
      )}
    </div>
  )
}

const STATUS = {
  queued:      { label: 'QUEUED',      color: '#64748b' },
  downloading: { label: 'DOWNLOADING', color: '#22d3ee' },
  installing:  { label: 'INSTALLING',  color: '#f59e0b' },
  completed:   { label: 'COMPLETED',   color: '#4ade80' },
  paused:      { label: 'PAUSED',      color: '#94a3b8' },
  error:       { label: 'ERROR',       color: '#f87171' },
}

function DlCard({ d, onPause, onResume, onRemove, onLaunch }) {
  const st = STATUS[d.status] || STATUS.queued
  const isActive = d.status === 'downloading'
  const isDone   = d.status === 'completed' || d.status === 'installing'
  const isError  = d.status === 'error'
  const progress = Math.min(d.progress || 0, 100)

  return (
    <motion.div className={styles.card}
      initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} layout>

      <div className={styles.cardTop}>
        {isDone  && <CheckCircle size={16} style={{ color:'#4ade80', flexShrink:0 }}/>}
        {isError && <AlertCircle size={16} style={{ color:'#f87171', flexShrink:0 }}/>}
        {!isDone && !isError && (
          <div className={styles.cardIcon} style={{
            borderColor: isActive ? '#22d3ee44' : '#ffffff15',
            background:  isActive ? '#22d3ee12' : '#ffffff06',
          }}>
            {isActive
              ? <Zap size={13} style={{ color:'#22d3ee' }}/>
              : <Clock size={13} style={{ color:'#64748b' }}/>}
          </div>
        )}

        <div style={{ flex:1, minWidth:0 }}>
          <p className={styles.cardTitle}>{d.title}</p>
          <div className={styles.cardMeta}>
            <span className={styles.badge} style={{
              color: st.color, borderColor: st.color+'44', background: st.color+'15'
            }}>{st.label}</span>

            {isActive && d.phase === 'connecting' && (
              <span className={styles.chip} style={{ color:'#94a3b8' }}>🔍 Finding peers...</span>
            )}
            {isActive && d.phase === 'allocating' && (
              <span className={styles.chip} style={{ color:'#f59e0b' }}>📁 Allocating files...</span>
            )}
            {isActive && d.phase === 'verifying' && (
              <span className={styles.chip} style={{ color:'#a78bfa' }}>✔ Verifying...</span>
            )}
            {isActive && d.phase === 'downloading' && d.speed_kbps > 0 && (
              <span className={styles.chip} style={{ color:'#22d3ee', fontWeight:700 }}>
                {fmtSpeed(d.speed_kbps)}
              </span>
            )}
            {isActive && d.phase === 'downloading' && d.eta_seconds > 0 && (
              <span className={styles.chip}>~{fmtETA(d.eta_seconds)}</span>
            )}
            {isActive && d.phase === 'downloading' && d.peers > 0 && (
              <span className={styles.chip}>{d.peers} seeders</span>
            )}
          </div>
        </div>

        <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
          {/* Przycisk instalacji po ukończeniu */}
          {isDone && d.savePath && (
            <button className={styles.btnInstall} onClick={() => onLaunch(d)} title="Launch installer">
              {'Install'}
            </button>
          )}
          {isActive && (
            <button className={styles.btn} onClick={() => onPause(d.id)} title="Pause">
              <Pause size={12}/>
            </button>
          )}
          {d.status === 'paused' && (
            <button className={styles.btn} onClick={() => onResume(d.id)} title="Resume">
              <Play size={12}/>
            </button>
          )}
          <button className={`${styles.btn} ${styles.btnRed}`} onClick={() => onRemove(d.id)} title="Remove">
            <X size={12}/>
          </button>
        </div>
      </div>

      {/* Pasek postępu — zawsze widoczny gdy pobieranie */}
      {(isActive || progress > 0) && d.phase === 'downloading' && (
        <div className={styles.progressRow}>
          <div className={styles.progressBg}>
            <motion.div className={styles.progressFill}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
              style={{ background: isDone ? '#4ade80' : isError ? '#f87171' : '#22d3ee' }}
            />
          </div>
          <span className={styles.progressPct}>{progress.toFixed(1)}%</span>
        </div>
      )}

      {d.warning && (
        <div className={styles.warning}>
          <AlertCircle size={11}/> {d.warning}
        </div>
      )}
    </motion.div>
  )
}

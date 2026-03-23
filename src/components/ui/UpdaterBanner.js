/**
 * src/components/ui/UpdaterBanner.js
 *
 * Pasek powiadomień o aktualizacji launchera.
 * Nasłuchuje zdarzeń IPC z electron/updater.js
 * i wyświetla odpowiedni stan: dostępna / pobieranie / gotowa.
 */

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, RefreshCw, X, CheckCircle2 } from 'lucide-react'

export default function UpdaterBanner() {
  const [state, setState]     = useState(null)  // null | 'available' | 'downloading' | 'downloaded'
  const [info, setInfo]       = useState({})
  const [progress, setProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.sealm) return

    // Check on mount (only production)
    window.sealm.updater.check().catch(() => {})

    // Listen to update events forwarded by preload
    const handlers = {
      'updater:available':     (data) => { setInfo(data); setState('available'); setDismissed(false) },
      'updater:progress':      (data) => { setState('downloading'); setProgress(data.percent || 0) },
      'updater:downloaded':    (data) => { setInfo(d => ({ ...d, ...data })); setState('downloaded') },
      'updater:not-available': ()     => {},
      'updater:error':         ()     => setState(null),
    }

    // Electron IPC → window custom events bridge (set up in preload)
    Object.entries(handlers).forEach(([ch, fn]) => {
      window.addEventListener(`sealm:${ch}`, (e) => fn(e.detail))
    })

    return () => {
      Object.keys(handlers).forEach(ch => {
        window.removeEventListener(`sealm:${ch}`, handlers[ch])
      })
    }
  }, [])

  if (!state || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -40 }}
        style={{
          position: 'fixed', top: 38, left: 64, right: 0, zIndex: 500,
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border-accent)',
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        {state === 'available' && (
          <>
            <RefreshCw size={14} color="var(--accent-violet-bright)" />
            <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
              New SEALM version <strong>{info.version}</strong> is available.
            </span>
            <button
              onClick={() => window.sealm.updater.download()}
              style={{
                background: 'var(--accent-violet)', border: 'none', color: 'white',
                padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                letterSpacing: 1, textTransform: 'uppercase',
              }}
            >
              <Download size={10} style={{ marginRight: 4 }} />
              Download
            </button>
            <button
              onClick={() => setDismissed(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}
            >
              <X size={13} />
            </button>
          </>
        )}

        {state === 'downloading' && (
          <>
            <Download size={14} color="var(--accent-cyan)" />
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
              Downloads aktualizacji…
            </span>
            <div style={{ flex: 1, background: 'var(--bg-deep)', borderRadius: 4, height: 4, maxWidth: 200 }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: 'linear-gradient(90deg, var(--accent-cyan-dim), var(--accent-cyan))',
                width: `${progress}%`, transition: 'width 0.3s',
              }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {progress}%
            </span>
          </>
        )}

        {state === 'downloaded' && (
          <>
            <CheckCircle2 size={14} color="var(--accent-green)" />
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
              Aktualizacja gotowa — wersja <strong>{info.version}</strong>
            </span>
            <button
              onClick={() => window.sealm.updater.install()}
              style={{
                background: 'var(--accent-green)', border: 'none', color: 'white',
                padding: '4px 14px', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                letterSpacing: 1, textTransform: 'uppercase',
              }}
            >
              Install and restart
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

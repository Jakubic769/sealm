import React, { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'

const SECTIONS = ['General', 'Downloads', 'Graphics', 'Sound', 'Account', 'Privacy']

const SETTINGS_DATA = {
  General: [
    { key: 'autostart',  label: 'Launch at system startup',       sub: 'SEALM will start automatically after login',           default: true  },
    { key: 'tray',       label: 'Minimize to system tray',        sub: 'Closing the window minimizes to tray',                 default: true  },
    { key: 'toasts',     label: 'Toast notifications',            sub: 'Show notifications for downloads and messages',        default: true  },
    { key: 'playtime',   label: 'Playtime tracking',              sub: 'Track time spent in each game',                        default: true  },
    { key: 'autoupdate', label: 'Automatic launcher updates',     sub: 'Download and install updates automatically',           default: true  },
  ],
  Downloads: [
    { key: 'autoinstall', label: 'Auto-install after download',   sub: 'Launch FitGirl installer after download completes',    default: true  },
    { key: 'limspeed',    label: 'Download speed limit',          sub: 'Limit torrent bandwidth in background',                default: false },
    { key: 'seeding',     label: 'Seed after download',           sub: 'Share torrent for 24h after download',                 default: false },
    { key: 'queueone',    label: 'Download one game at a time',   sub: 'Queue others instead of downloading simultaneously',   default: false },
  ],
  Graphics: [
    { key: 'hwaccel',      label: 'Hardware UI acceleration',     sub: 'Use GPU for interface rendering',                      default: true  },
    { key: 'animations',   label: 'Transition animations',        sub: 'Smooth animations between tabs and cards',             default: true  },
    { key: 'lowres_cover', label: 'Low-res cover mode',           sub: 'Load low resolution thumbnails',                       default: false },
  ],
  Sound: [
    { key: 'sounds',     label: 'Interface sounds',               sub: 'Clicks, notifications, confirmations',                 default: true  },
    { key: 'dl_sound',   label: 'Download completion sound',      sub: 'Play sound when download completes',                   default: true  },
    { key: 'chat_sound', label: 'New chat message sound',         sub: 'Notify with sound for new messages',                   default: true  },
  ],
  Account: [
    { key: 'pubprofile',  label: 'Public profile',                sub: 'Others can see your profile and library',              default: true  },
    { key: 'showstatus',  label: 'Show online status',            sub: 'Visible in the active players list',                   default: true  },
    { key: 'showlibrary', label: 'Show library publicly',         sub: 'Other players can browse your games',                  default: false },
  ],
  Privacy: [
    { key: 'analytics',   label: 'Anonymous usage statistics',    sub: 'Help improve SEALM by sending anonymous data',         default: false },
    { key: 'crashreport', label: 'Error reports',                 sub: 'Automatically send crash reports',                     default: true  },
    { key: 'history',     label: 'Keep search history',           sub: 'Remember recent queries in the store',                 default: true  },
  ],
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('General')
  const [values, setValues] = useState(() => {
    const init = {}
    Object.entries(SETTINGS_DATA).forEach(([, items]) =>
      items.forEach(s => { init[s.key] = s.default })
    )
    return init
  })

  const toggle = (key) => {
    setValues(v => {
      const next = !v[key]
      toast(next ? '✓ Enabled' : '✕ Disabled', { duration: 1200 })
      return { ...v, [key]: next }
    })
  }

  const items = SETTINGS_DATA[activeSection] || []

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ width: 36, height: 3, background: 'var(--text-muted)', borderRadius: 2, marginBottom: 4 }}/>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: 3, textTransform: 'uppercase' }}>
          Settings
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14 }}>
        {/* Nav */}
        <div style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '8px 0', height: 'fit-content',
        }}>
          {SECTIONS.map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{
              width: '100%', padding: '9px 14px',
              background: activeSection === s ? 'rgba(124,58,237,0.08)' : 'transparent',
              border: 'none',
              borderLeft: activeSection === s ? '2px solid var(--accent-violet-bright)' : '2px solid transparent',
              color: activeSection === s ? 'var(--accent-violet-bright)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
              letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer',
              textAlign: 'left', transition: 'all 0.15s',
            }}>
              {s}
            </button>
          ))}
        </div>

        {/* Panel */}
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            background: 'var(--bg-panel)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 16,
          }}
        >
          <p style={{
            fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
            letterSpacing: 2, color: 'var(--text-muted)', textTransform: 'uppercase',
            marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)',
          }}>
            {activeSection}
          </p>

          {items.map((item, i) => (
            <div key={item.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 0',
              borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {item.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {item.sub}
                </p>
              </div>
              <button onClick={() => toggle(item.key)} style={{
                width: 42, height: 24, borderRadius: 12, border: 'none',
                background: values[item.key] ? 'var(--accent-violet)' : 'var(--bg-elevated)',
                cursor: 'pointer', position: 'relative', flexShrink: 0,
                transition: 'background 0.2s', marginLeft: 16,
              }}>
                <span style={{
                  position: 'absolute', top: 3,
                  left: values[item.key] ? 21 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s', display: 'block',
                }}/>
              </button>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

import React, { useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BookOpen, Download, MessageCircle,
  Settings, Minus, Maximize2, X, Trophy, Users, Flame
} from 'lucide-react'
import { useAuthStore }      from '../../store/authStore'
import { useDownloadsStore } from '../../store/downloadsStore'
import UpdaterBanner         from '../ui/UpdaterBanner'
import styles from './AppLayout.module.css'

const NAV_ITEMS = [
  { to: '/fitgirl',      Icon: Flame,         label: 'Store'        },
  { to: '/library',      Icon: BookOpen,      label: 'Library'      },
  { to: '/downloads',    Icon: Download,      label: 'Downloads', badge: true },
  { to: '/chat',         Icon: MessageCircle, label: 'Chat'         },
  { to: '/friends',      Icon: Users,         label: 'Friends'      },
  { to: '/achievements', Icon: Trophy,        label: 'Trophies' },
]

export default function AppLayout() {
  const { user, logout }   = useAuthStore()
  const { downloads }      = useDownloadsStore()
  const navigate           = useNavigate()
  const activeDownloads    = downloads.filter(d => d.status === 'downloading').length

  // Refresh on language change
  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1)
    window.addEventListener('sealm:language', handler)
    return () => window.removeEventListener('sealm:language', handler)
  }, [])


  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : 'U'

  return (
    <div className={styles.shell}>
      {/* ── Titlebar ── */}
      <div className={`${styles.titlebar} drag-region`}>
        <span className={styles.logo}>SEALM</span>
        <span className={styles.tagline}>LAUNCHER</span>
        <div className={`${styles.winControls} no-drag`}>
          <button onClick={() => window.sealm?.window.minimize()} className={styles.winBtn} title="Minimalizuj">
            <Minus size={11} />
          </button>
          <button onClick={() => window.sealm?.window.maximize()} className={styles.winBtn} title="Maksymalizuj">
            <Maximize2 size={10} />
          </button>
          <button onClick={() => window.sealm?.window.close()} className={`${styles.winBtn} ${styles.winClose}`} title="Close">
            <X size={11} />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        {/* ── Sidebar ── */}
        <nav className={styles.sidebar}>
          <div className={styles.navTop}>
            {NAV_ITEMS.map(({ to, Icon, label, badge }) => (
              <NavLink key={to} to={to} className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navActive : ''}`
              }>
                {({ isActive }) => (
                  <>
                    <span className={styles.navIcon}>
                      <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
                      {badge && activeDownloads > 0 && (
                        <span className={styles.navBadge}>{activeDownloads}</span>
                      )}
                    </span>
                    <span className={styles.navLabel}>{label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className={styles.navIndicator}
                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          <div className={styles.navBottom}>
            <NavLink to="/settings" className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navActive : ''}`
            }>
              {({ isActive }) => (
                <>
                  <span className={styles.navIcon}><Settings size={18} strokeWidth={isActive ? 2.5 : 1.8} /></span>
                  <span className={styles.navLabel}>Settings</span>
                </>
              )}
            </NavLink>

            <button
              className={styles.avatarBtn}
              onClick={() => navigate('/profile')}
              title={user?.username}
            >
              <span className={styles.avatarInitials}>{initials}</span>
              <span className={styles.onlineDot} />
            </button>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main className={styles.main}>
          <UpdaterBanner />
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={styles.page}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  )
}

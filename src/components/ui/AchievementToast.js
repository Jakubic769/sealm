/**
 * src/components/ui/AchievementToast.js
 *
 * Specjalny toast dla osiągnięć — appears with unlock animation
 * i zostaje dłużej niż standardowe toasty.
 */
import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'

// Hook — rejestruje listener IPC i pokazuje toasty przy odblokowanym osiągnięciu
export function useAchievementListener() {
  const { user } = useAuthStore()

  useEffect(() => {
    if (!user) return
    const onUnlocked = window.sealm?.achievements?.onUnlocked
    if (typeof onUnlocked !== 'function') return

    const unsub = onUnlocked((data) => {
      toast.custom((t) => (
        <motion.div
          initial={{ opacity: 0, x: 60, scale: 0.9 }}
          animate={{ opacity: t.visible ? 1 : 0, x: t.visible ? 0 : 60, scale: t.visible ? 1 : 0.9 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(135deg, #1e2a3a, #2a1f3d)',
            border: '1px solid rgba(139,92,246,0.5)',
            borderRadius: 12,
            padding: '12px 16px',
            minWidth: 280,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 20px rgba(124,58,237,0.2)',
            cursor: 'pointer',
          }}
          onClick={() => toast.dismiss(t.id)}
        >
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(124,58,237,0.2)',
            border: '2px solid rgba(139,92,246,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flexShrink: 0,
            animation: 'pulse-glow 2s infinite',
          }}>
            {data.icon}
          </div>
          <div>
            <div style={{
              fontSize: 9, fontFamily: 'var(--font-display)', fontWeight: 700,
              letterSpacing: 2, color: 'var(--accent-violet-bright)',
              textTransform: 'uppercase', marginBottom: 2,
            }}>
              🏆 Achievement Unlocked
            </div>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#f0f4ff',
              fontFamily: 'var(--font-display)', letterSpacing: 0.5,
            }}>
              {data.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              {data.description} · +{data.points} pkt
            </div>
          </div>
        </motion.div>
      ), { duration: 5000, position: 'bottom-right' })
    })

    return unsub
  }, [user?.id])
}

export default function AchievementToastProvider({ children }) {
  useAchievementListener()
  return children
}

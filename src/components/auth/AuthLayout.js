import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../store/authStore'
import { getAuth, sendPasswordResetEmail } from 'firebase/auth'
import styles from './AuthLayout.module.css'

export default function AuthLayout() {
  const [mode, setMode] = useState('login')  // 'login' | 'register' | 'reset'
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const { login, register, loading } = useAuthStore()
  const navigate = useNavigate()

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.email.trim()) { setError('Please enter your email'); return }
    try {
      await sendPasswordResetEmail(getAuth(), form.email.trim())
      setResetSent(true)
    } catch(err) {
      const msgs = {
        'auth/user-not-found':  'No account with this email',
        'auth/invalid-email':   'Invalid email address',
        'auth/too-many-requests': 'Too many attempts — try again later',
      }
      setError(msgs[err.code] || err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    let result
    if (mode === 'login') {
      result = await login({ email: form.email, password: form.password })
    } else {
      if (!form.username.trim()) return setError('Please enter a username')
      if (form.password.length < 6) return setError('Password must be at least 6 characters')
      result = await register(form)
    }
    if (result.success) navigate('/store')
    else setError(result.error)
  }

  return (
    <div className={styles.bg}>
      <div className={styles.grid} />
      <div className={styles.glow1} />
      <div className={styles.glow2} />

      <div className={styles.card}>
        <div className={styles.logoBlock}>
          <h1 className={styles.logo}>SEALM</h1>
          <p className={styles.logoSub}>Game Launcher & Store</p>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
            onClick={() => { setMode('login'); setError(''); setResetSent(false) }}
          >
            Sign In
          </button>
          <button
            className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
            onClick={() => { setMode('register'); setError(''); setResetSent(false) }}
          >
            Register
          </button>
          <div className={styles.tabSlider} style={{ left: mode === 'login' ? 4 : '50%' }} />
        </div>

        <AnimatePresence mode="wait">
          {mode === 'reset' ? (
            <motion.form key="reset" className={styles.form} onSubmit={handleReset}
              initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}>
              {resetSent ? (
                <div style={{ textAlign:'center', padding:'16px 0' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>📧</div>
                  <p style={{ color:'var(--accent-green)', fontFamily:'var(--font-display)', fontWeight:700, marginBottom:8 }}>
                    Reset link sent!
                  </p>
                  <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:20 }}>
                    Check your inbox at <strong>{form.email}</strong> and click the link to reset your password.
                  </p>
                  <button type="button" className={styles.submitBtn}
                    onClick={() => { setMode('login'); setResetSent(false); setError('') }}>
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
                    Enter your email and we'll send you a password reset link.
                  </p>
                  <div className={styles.field}>
                    <label className={styles.label}>Email</label>
                    <input className={styles.input} type="email" name="email"
                      value={form.email} onChange={handleChange}
                      placeholder="player@sealm.app" autoFocus required/>
                  </div>
                  {error && (
                    <motion.p className={styles.error}
                      initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }}>
                      {error}
                    </motion.p>
                  )}
                  <button className={styles.submitBtn} type="submit">
                    Send Reset Link
                  </button>
                  <button type="button"
                    style={{ background:'none', border:'none', color:'var(--text-muted)', fontSize:12, cursor:'pointer', marginTop:8, width:'100%' }}
                    onClick={() => { setMode('login'); setError('') }}>
                    ← Back to Sign In
                  </button>
                </>
              )}
            </motion.form>
          ) : (
            <motion.form
              key={mode}
              className={styles.form}
              onSubmit={handleSubmit}
              initial={{ opacity: 0, x: mode === 'login' ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {mode === 'register' && (
                <div className={styles.field}>
                  <label className={styles.label}>Username</label>
                  <input
                    className={styles.input} type="text" name="username"
                    value={form.username} onChange={handleChange}
                    placeholder="NightRunner" autoFocus required
                  />
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input
                  className={styles.input} type="email" name="email"
                  value={form.email} onChange={handleChange}
                  placeholder="player@sealm.app"
                  autoFocus={mode === 'login'} required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Password</label>
                <input
                  className={styles.input} type="password" name="password"
                  value={form.password} onChange={handleChange}
                  placeholder="••••••••" required
                />
              </div>

              {error && (
                <motion.p className={styles.error}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                  {error}
                </motion.p>
              )}

              <button className={styles.submitBtn} type="submit" disabled={loading}>
                {loading
                  ? <span className={styles.spinner} />
                  : mode === 'login' ? 'Sign In' : 'Create Account'
                }
              </button>

              {mode === 'login' && (
                <button type="button"
                  style={{ background:'none', border:'none', color:'var(--text-muted)', fontSize:12, cursor:'pointer', marginTop:8, width:'100%', textAlign:'center' }}
                  onClick={() => { setMode('reset'); setError('') }}>
                  Forgot password?
                </button>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

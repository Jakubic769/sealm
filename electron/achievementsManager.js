/**
 * electron/achievementsManager.js
 *
 * Zarządza osiągnięciami (achievements) i sesjami czasu gry.
 * Seeduje osiągnięcia przy starcie, sprawdza warunki odblokowania,
 * wysyła powiadomienia przez IPC.
 */

const { v4: uuidv4 } = require('uuid')

// ─── Seed achievements ────────────────────────────────────────────────────────
const GLOBAL_ACHIEVEMENTS = [
  { key: 'first_login',    title: 'Welcome to SEALM', description: 'Log in for the first time',            icon: '🎮', points: 10  },
  { key: 'first_download', title: 'Downloader',        description: 'Download your first game',            icon: '⬇',  points: 15  },
  { key: 'library_5',      title: 'Collector',         description: 'Add 5 games to your library',         icon: '📚', points: 20  },
  { key: 'library_10',     title: 'Librarian',         description: 'Add 10 games to your library',        icon: '🏛',  points: 40  },
  { key: 'playtime_10h',   title: 'Getting Hooked',    description: 'Play a total of 10 hours',            icon: '⏱',  points: 25  },
  { key: 'playtime_100h',  title: 'No Life',           description: 'Play a total of 100 hours',           icon: '💀', points: 100 },
  { key: 'playtime_500h',  title: 'Legend',            description: 'Play a total of 500 hours',           icon: '👑', points: 500 },
  { key: 'first_review',   title: 'Critic',            description: 'Write your first review',             icon: '✍',  points: 10  },
  { key: 'reviews_10',     title: 'Reviewer',          description: 'Write 10 reviews',                    icon: '📝', points: 50  },
  { key: 'chat_100',       title: 'Chatterbox',        description: 'Send 100 chat messages',              icon: '💬', points: 30  },
  { key: 'first_friend',   title: 'First Friend',      description: 'Add your first friend',               icon: '🤝', points: 15  },
  { key: 'friends_5',      title: 'Popular',           description: 'Have 5 friends at the same time',     icon: '👥', points: 40  },
  { key: 'night_owl',      title: 'Night Owl',         description: 'Play between 2:00 and 5:00 AM',       icon: '🦉', points: 20  },
  { key: 'speed_runner',   title: 'Speed Runner',      description: 'Launch a game within 10s of login',   icon: '⚡', points: 30  },
]

class AchievementsManager {
  constructor(db, win) {
    this.db  = db
    this.win = win
    this._seedGlobal()
  }

  _seedGlobal() {
    // Stały ID oparty na key — nie UUID — żeby INSERT OR IGNORE działał poprawnie
    try {
      this.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_key ON achievements(key)').run()
    } catch {}

    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO achievements (id, game_id, key, title, description, icon, points) VALUES (?, NULL, ?, ?, ?, ?, ?)'
    )
    const tx = this.db.transaction((list) => {
      for (const a of list) {
        insert.run('global_' + a.key, a.key, a.title, a.description, a.icon, a.points)
      }
    })
    tx(GLOBAL_ACHIEVEMENTS)
  }

  // ── Unlock an achievement ──────────────────────────────────────────────────
  unlock(userId, achievementKey) {
    const ach = this.db.prepare('SELECT * FROM achievements WHERE key = ?').get(achievementKey)
    if (!ach) return false

    const existing = this.db.prepare(
      'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?'
    ).get(userId, ach.id)
    if (existing) return false   // already unlocked

    this.db.prepare(
      'INSERT INTO user_achievements (id, user_id, achievement_id) VALUES (?, ?, ?)'
    ).run(uuidv4(), userId, ach.id)

    // Push to renderer
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('achievement:unlocked', {
        key:         ach.key,
        title:       ach.title,
        description: ach.description,
        icon:        ach.icon,
        points:      ach.points,
      })
    }
    return true
  }

  // ── Check conditions after events ─────────────────────────────────────────
  checkAfterLogin(userId) {
    this.unlock(userId, 'first_login')
    const hour = new Date().getHours()
    if (hour >= 2 && hour < 5) this.unlock(userId, 'night_owl')
  }

  checkAfterDownload(userId) {
    this.unlock(userId, 'first_download')
  }

  checkAfterLibraryChange(userId) {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM library WHERE user_id = ?').get(userId)
    if (count.c >= 5)  this.unlock(userId, 'library_5')
    if (count.c >= 10) this.unlock(userId, 'library_10')
  }

  checkAfterPlaytime(userId) {
    const row = this.db.prepare('SELECT SUM(playtime_min) as total FROM library WHERE user_id = ?').get(userId)
    const totalMin = row.total || 0
    if (totalMin >= 600)  this.unlock(userId, 'playtime_10h')
    if (totalMin >= 6000) this.unlock(userId, 'playtime_100h')
    if (totalMin >= 30000)this.unlock(userId, 'playtime_500h')
  }

  checkAfterReview(userId) {
    this.unlock(userId, 'first_review')
    const count = this.db.prepare('SELECT COUNT(*) as c FROM reviews WHERE user_id = ?').get(userId)
    if (count.c >= 10) this.unlock(userId, 'reviews_10')
  }

  checkAfterChatMessage(userId) {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE sender_id = ?').get(userId)
    if (count.c >= 100) this.unlock(userId, 'chat_100')
  }

  checkAfterFriend(userId) {
    this.unlock(userId, 'first_friend')
    const count = this.db.prepare(
      "SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'accepted'"
    ).get(userId)
    if (count.c >= 5) this.unlock(userId, 'friends_5')
  }

  // ── Register IPC handlers ─────────────────────────────────────────────────
  register(ipcMain) {
    ipcMain.handle('achievements:list', async (_, { userId }) => {
      const all = this.db.prepare('SELECT * FROM achievements ORDER BY points ASC').all()
      const unlocked = this.db.prepare(`
        SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?
      `).all(userId)
      const unlockedMap = Object.fromEntries(unlocked.map(u => [u.achievement_id, u.unlocked_at]))
      return all.map(a => ({
        ...a,
        unlocked:    !!unlockedMap[a.id],
        unlocked_at: unlockedMap[a.id] || null,
      }))
    })

    ipcMain.handle('achievements:stats', async (_, { userId }) => {
      const total    = this.db.prepare('SELECT COUNT(*) as c FROM achievements').get()
      const unlocked = this.db.prepare('SELECT COUNT(*) as c FROM user_achievements WHERE user_id = ?').get(userId)
      const points   = this.db.prepare(`
        SELECT SUM(a.points) as pts FROM user_achievements ua
        JOIN achievements a ON ua.achievement_id = a.id
        WHERE ua.user_id = ?
      `).get(userId)
      return {
        total:    total.c,
        unlocked: unlocked.c,
        points:   points.pts || 0,
        percent:  total.c > 0 ? Math.round((unlocked.c / total.c) * 100) : 0,
      }
    })

    // Playtime session tracking
    ipcMain.handle('playtime:start', async (_, { userId, gameId }) => {
      const id = uuidv4()
      const now = Math.floor(Date.now() / 1000)
      this.db.prepare(
        'INSERT INTO playtime_sessions (id, user_id, game_id, started_at) VALUES (?, ?, ?, ?)'
      ).run(id, userId, gameId, now)
      return { success: true, sessionId: id }
    })

    ipcMain.handle('playtime:end', async (_, { sessionId, userId, gameId }) => {
      const now = Math.floor(Date.now() / 1000)
      const session = this.db.prepare('SELECT * FROM playtime_sessions WHERE id = ?').get(sessionId)
      if (!session) return { success: false }
      const durationMin = Math.round((now - session.started_at) / 60)
      this.db.prepare(
        'UPDATE playtime_sessions SET ended_at = ?, duration_min = ? WHERE id = ?'
      ).run(now, durationMin, sessionId)
      this.db.prepare(
        'UPDATE library SET playtime_min = playtime_min + ?, last_played = ? WHERE user_id = ? AND game_id = ?'
      ).run(durationMin, now, userId, gameId)
      this.db.prepare(
        'UPDATE users SET last_login = ? WHERE id = ?'
      ).run(now, userId)
      this.checkAfterPlaytime(userId)
      return { success: true, durationMin }
    })

    ipcMain.handle('playtime:history', async (_, { userId, gameId, limit = 30 }) => {
      let query = `
        SELECT ps.*, g.title FROM playtime_sessions ps
        JOIN games g ON ps.game_id = g.id
        WHERE ps.user_id = ?
      `
      const params = [userId]
      if (gameId) { query += ' AND ps.game_id = ?'; params.push(gameId) }
      query += ' ORDER BY ps.started_at DESC LIMIT ?'
      params.push(limit)
      return this.db.prepare(query).all(...params)
    })
  }
}

module.exports = AchievementsManager

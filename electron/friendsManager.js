/**
 * electron/friendsManager.js
 *
 * System znajomych — zaproszenia, akceptacja, lista, usuwanie.
 * Status: pending | accepted | blocked
 */

const { v4: uuidv4 } = require('uuid')

class FriendsManager {
  constructor(db, win, achievementsManager) {
    this.db      = db
    this.win     = win
    this.achMgr  = achievementsManager
  }

  register(ipcMain) {

    // Send friend request
    ipcMain.handle('friends:request', async (_, { userId, targetUsername }) => {
      const target = this.db.prepare('SELECT id, username FROM users WHERE username = ?').get(targetUsername)
      if (!target) return { success: false, error: 'User does not exist' }
      if (target.id === userId) return { success: false, error: 'You cannot add yourself' }

      const existing = this.db.prepare(
        'SELECT * FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)'
      ).get(userId, target.id, target.id, userId)

      if (existing) {
        if (existing.status === 'accepted') return { success: false, error: 'You are already friends' }
        if (existing.status === 'pending')  return { success: false, error: 'Request already sent' }
      }

      this.db.prepare(
        'INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), userId, target.id, 'pending')

      // Notify target via IPC push
      if (this.win && !this.win.isDestroyed()) {
        const sender = this.db.prepare('SELECT username FROM users WHERE id = ?').get(userId)
        this.win.webContents.send('friends:request_received', {
          fromId:   userId,
          fromName: sender?.username,
          toId:     target.id,
        })
      }

      return { success: true, targetId: target.id, targetUsername: target.username }
    })

    // Accept friend request
    ipcMain.handle('friends:accept', async (_, { userId, fromUserId }) => {
      const row = this.db.prepare(
        "SELECT id FROM friends WHERE user_id=? AND friend_id=? AND status='pending'"
      ).get(fromUserId, userId)
      if (!row) return { success: false, error: 'Brak zaproszenia' }

      this.db.prepare("UPDATE friends SET status='accepted' WHERE id=?").run(row.id)
      // Create reverse relationship
      const existing = this.db.prepare('SELECT id FROM friends WHERE user_id=? AND friend_id=?').get(userId, fromUserId)
      if (!existing) {
        this.db.prepare('INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)').run(uuidv4(), userId, fromUserId, 'accepted')
      } else {
        this.db.prepare("UPDATE friends SET status='accepted' WHERE id=?").run(existing.id)
      }

      if (this.achMgr) {
        this.achMgr.checkAfterFriend(userId)
        this.achMgr.checkAfterFriend(fromUserId)
      }
      return { success: true }
    })

    // Decline / remove friend
    ipcMain.handle('friends:remove', async (_, { userId, friendId }) => {
      this.db.prepare(
        'DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)'
      ).run(userId, friendId, friendId, userId)
      return { success: true }
    })

    // List friends
    ipcMain.handle('friends:list', async (_, { userId }) => {
      return this.db.prepare(`
        SELECT f.*, u.username, u.avatar_url,
               (SELECT MAX(s.expires_at) FROM sessions s
                WHERE s.user_id = u.id AND s.expires_at > strftime('%s','now')) as is_online,
               (SELECT g.title FROM library l JOIN games g ON l.game_id = g.id
                WHERE l.user_id = u.id ORDER BY l.last_played DESC LIMIT 1) as last_game
        FROM friends f
        JOIN users u ON f.friend_id = u.id
        WHERE f.user_id = ? AND f.status = 'accepted'
        ORDER BY is_online DESC, u.username ASC
      `).all(userId)
    })

    // List pending incoming requests
    ipcMain.handle('friends:pending', async (_, { userId }) => {
      return this.db.prepare(`
        SELECT f.*, u.username, u.avatar_url
        FROM friends f JOIN users u ON f.user_id = u.id
        WHERE f.friend_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
      `).all(userId)
    })

    // Search users by username prefix (for adding friends)
    ipcMain.handle('friends:searchUsers', async (_, { query, currentUserId }) => {
      if (!query || query.length < 2) return []
      return this.db.prepare(`
        SELECT id, username FROM users
        WHERE username LIKE ? AND id != ?
        LIMIT 10
      `).all(`${query}%`, currentUserId)
    })
  }
}

module.exports = FriendsManager

// scripts/init-db.js
// Run: node scripts/init-db.js
// Creates the SQLite database manually (useful for dev/testing outside Electron)

const path    = require('path')
const os      = require('os')
const Database = require('better-sqlite3')

const dbPath = path.join(os.homedir(), '.sealm', 'sealm.db')
const fs     = require('fs')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

console.log(`📦 Inicjalizacja bazy danych: ${dbPath}`)

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    avatar_url TEXT, created_at INTEGER DEFAULT (strftime('%s','now')), last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT,
    description TEXT, cover_url TEXT, rating REAL DEFAULT 0,
    size_gb REAL, fitgirl_slug TEXT, release_year INTEGER, tags TEXT
  );
  CREATE TABLE IF NOT EXISTS library (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    game_id TEXT NOT NULL REFERENCES games(id), install_path TEXT,
    executable TEXT, playtime_min INTEGER DEFAULT 0,
    installed_at INTEGER DEFAULT (strftime('%s','now')),
    last_played INTEGER, UNIQUE(user_id, game_id)
  );
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    game_id TEXT NOT NULL REFERENCES games(id), status TEXT DEFAULT 'queued',
    progress REAL DEFAULT 0, speed_kbps REAL DEFAULT 0,
    eta_seconds INTEGER DEFAULT 0, magnet_uri TEXT, save_path TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')), completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    game_id TEXT NOT NULL REFERENCES games(id),
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    body TEXT, created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, game_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id),
    receiver_id TEXT, channel TEXT DEFAULT 'general',
    body TEXT NOT NULL, sent_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`)

console.log('✅ Tabele utworzone.')
db.close()

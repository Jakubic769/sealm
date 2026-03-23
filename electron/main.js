const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
// isDev = true gdy uruchomiono przez "npm run electron:dev"
// Sprawdzamy NODE_ENV (ustawiane przez cross-env) LUB brak pliku build/index.html
const isDev = process.env.NODE_ENV === 'development' || (
  !app.isPackaged && (() => {
    try {
      require('fs').accessSync(require('path').join(__dirname, '../build/index.html'))
      return false  // build istnieje -> nie jesteśmy w dev
    } catch {
      return true   // brak build -> jesteśmy w dev
    }
  })()
)
console.log('[SEALM] isDev:', isDev, '| NODE_ENV:', process.env.NODE_ENV)

// Clear browser cache in dev mode żeby stary sklep się nie pokazywał
if (isDev) {
  app.on('ready', () => {
    const { session } = require('electron')
    session.defaultSession.clearCache().catch(() => {})
    session.defaultSession.clearStorageData({ storages: ['appcache'] }).catch(() => {})
  })
}

// ─── Database ────────────────────────────────────────────────────────────────
const Database = require('better-sqlite3')
const Store = require('electron-store')

// ─── Managers (lazy-loaded, safe on Windows) ────────────────────────────────
let TorrentManager      = null
let Aria2Manager        = null
let ChatServer          = null
let WS_PORT             = 45678
let NotificationManager = null

try { TorrentManager = require("./torrentManager") }  catch(e) { console.warn("[SEALM] torrentManager:", e.message) }
try { Aria2Manager   = require("./aria2Manager")   }  catch(e) { console.warn("[SEALM] aria2Manager:", e.message) }
try { const cs = require("./chatServer"); ChatServer = cs.ChatServer; WS_PORT = cs.WS_PORT || 45678 } catch(e) { console.warn("[SEALM] chatServer:", e.message) }
try { NotificationManager = require("./notificationManager") } catch(e) { console.warn("[SEALM] notificationManager:", e.message) }

let torrentManager      = null
let chatServer          = null
let notificationManager = null
let firebaseManager     = null

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'sealm.db')
let db
let tray = null
let mainWindow = null

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#080b12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: isDev
      ? path.join(__dirname, '../public/icon.png')
      : path.join(__dirname, '../build/icon.png'),
  })

  if (isDev) {
    // Retry loading localhost:3000 — React dev server może potrzebować chwili
    const DEV_URL = 'http://localhost:3000'
    const tryLoad = (attempt = 1) => {
      mainWindow.loadURL(DEV_URL).catch(() => {
        if (attempt < 20) {
          console.log(`[SEALM] Waiting for React dev server... (próba ${attempt})`)
          setTimeout(() => tryLoad(attempt + 1), 500)
        }
      })
    }
    tryLoad()
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'))
  }

  // Set user offline when app closes
  app.on('before-quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:before-quit')
    }
  })

  mainWindow.on('close', (e) => {
    const store = new Store()
    if (store.get('minimizeToTray', true)) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  const menu = Menu.buildFromTemplate([
    { label: 'Pokaż SEALM', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Sklep', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', '/store') } },
    { label: 'Biblioteka', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', '/library') } },
    { type: 'separator' },
    { label: 'Zamknij', click: () => { app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip('SEALM Launcher')
  tray.on('double-click', () => mainWindow.show())
}

// ─── DB Init ──────────────────────────────────────────────────────────────────
function initDatabase() {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      avatar_url  TEXT,
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      last_login  INTEGER
    );

    CREATE TABLE IF NOT EXISTS games (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      genre         TEXT,
      description   TEXT,
      cover_url     TEXT,
      rating        REAL DEFAULT 0,
      size_gb       REAL,
      fitgirl_slug  TEXT,
      release_year  INTEGER,
      tags          TEXT
    );

    CREATE TABLE IF NOT EXISTS library (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      game_id       TEXT NOT NULL REFERENCES games(id),
      install_path  TEXT,
      executable    TEXT,
      playtime_min  INTEGER DEFAULT 0,
      installed_at  INTEGER DEFAULT (strftime('%s','now')),
      last_played   INTEGER,
      UNIQUE(user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      game_id       TEXT NOT NULL REFERENCES games(id),
      status        TEXT DEFAULT 'queued',
      progress      REAL DEFAULT 0,
      speed_kbps    REAL DEFAULT 0,
      eta_seconds   INTEGER DEFAULT 0,
      magnet_uri    TEXT,
      save_path     TEXT,
      created_at    INTEGER DEFAULT (strftime('%s','now')),
      completed_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      game_id     TEXT NOT NULL REFERENCES games(id),
      rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
      body        TEXT,
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      sender_id   TEXT NOT NULL REFERENCES users(id),
      receiver_id TEXT,
      channel     TEXT DEFAULT 'general',
      body        TEXT NOT NULL,
      sent_at     INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      token       TEXT UNIQUE NOT NULL,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id          TEXT PRIMARY KEY,
      game_id     TEXT REFERENCES games(id),
      key         TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      icon        TEXT,
      points      INTEGER DEFAULT 10,
      UNIQUE(game_id, key)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      achievement_id TEXT NOT NULL REFERENCES achievements(id),
      unlocked_at   INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS playtime_sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      game_id     TEXT NOT NULL REFERENCES games(id),
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      duration_min INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS friends (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      friend_id   TEXT NOT NULL REFERENCES users(id),
      status      TEXT DEFAULT 'pending',
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, friend_id)
    );
  `)

  // Migracje — dodaj brakujące kolumny i napraw schematy
  for (const m of [
    'ALTER TABLE downloads ADD COLUMN game_title TEXT',
    'ALTER TABLE downloads ADD COLUMN save_path_custom TEXT',
  ]) { try { db.prepare(m).run() } catch {} }

  // Zaktualizuj nazwy osiągnięć na angielskie
  const achUpdates = [
    ['Welcome to SEALM', 'Log in for the first time',          'first_login'],
    ['Downloader',        'Download your first game',           'first_download'],
    ['Collector',         'Add 5 games to your library',        'library_5'],
    ['Librarian',         'Add 10 games to your library',       'library_10'],
    ['Getting Hooked',    'Play a total of 10 hours',           'playtime_10h'],
    ['No Life',           'Play a total of 100 hours',          'playtime_100h'],
    ['Legend',            'Play a total of 500 hours',          'playtime_500h'],
    ['Critic',            'Write your first review',            'first_review'],
    ['Reviewer',          'Write 10 reviews',                   'reviews_10'],
    ['Chatterbox',        'Send 100 chat messages',             'chat_100'],
    ['First Friend',      'Add your first friend',              'first_friend'],
    ['Popular',           'Have 5 friends at the same time',    'friends_5'],
    ['Night Owl',         'Play between 2:00 and 5:00 AM',      'night_owl'],
    ['Speed Runner',      'Launch a game within 10s of login',  'speed_runner'],
  ]
  try {
    const upd = db.prepare('UPDATE achievements SET title=?, description=? WHERE key=?')
    for (const [title, desc, key] of achUpdates) upd.run(title, desc, key)
  } catch {}

  // Usuń zduplikowane osiągnięcia (zostawia po jednym na key)
  try {
    db.exec(`
      DELETE FROM achievements
      WHERE id NOT IN (
        SELECT MIN(id) FROM achievements GROUP BY key
      )
    `)
  } catch {}

  // Migracja playtime_sessions — dodaj library_id jeśli brakuje
  try { db.prepare('ALTER TABLE playtime_sessions ADD COLUMN library_id TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE playtime_sessions ADD COLUMN played_at INTEGER').run() } catch {}

  // Napraw NOT NULL na game_id w downloads — pozwól na gry FitGirl bez game_id
  try {
    const info = db.prepare("PRAGMA table_info(downloads)").all()
    const gameIdCol = info.find(c => c.name === 'game_id')
    if (gameIdCol && gameIdCol.notnull === 1) {
      // Odtwórz tabelę bez NOT NULL na game_id
      db.exec(`
        CREATE TABLE IF NOT EXISTS downloads_new (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL REFERENCES users(id),
          game_id      TEXT REFERENCES games(id),
          game_title   TEXT,
          status       TEXT NOT NULL DEFAULT 'queued',
          progress     REAL DEFAULT 0,
          speed_kbps   REAL DEFAULT 0,
          eta_seconds  INTEGER,
          magnet_uri   TEXT,
          save_path    TEXT,
          save_path_custom TEXT,
          created_at   INTEGER DEFAULT (strftime('%s','now'))
        );
        INSERT INTO downloads_new SELECT id,user_id,game_id,NULL,status,progress,speed_kbps,eta_seconds,magnet_uri,save_path,NULL,created_at FROM downloads;
        DROP TABLE downloads;
        ALTER TABLE downloads_new RENAME TO downloads;
      `)
      console.log('[DB] Migracja downloads: game_id teraz nullable')
    }
  } catch(e) { console.warn('[DB] Migracja downloads:', e.message) }

  // Seed sample games if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM games').get()
  if (count.c === 0) {
    const insertGame = db.prepare(`
      INSERT INTO games (id, title, genre, description, cover_url, rating, size_gb, fitgirl_slug, release_year, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const seedGames = [
      ['g001','The Witcher 3: Wild Hunt','RPG','Epicki RPG w otwartym świecie. Wciel się w wiedźmina Geralta z Rivii.',null,9.8,35,'the-witcher-3-wild-hunt',2015,'rpg,popular,open-world'],
      ['g002','Cyberpunk 2077','RPG/Action','Futuristic RPG action game in Night City.',null,9.1,70,'cyberpunk-2077',2020,'rpg,action,popular'],
      ['g003','Red Dead Redemption 2','Action','Epic story of honor and loyalty in the Wild West.',null,9.7,120,'red-dead-redemption-2',2018,'action,popular,open-world'],
      ['g004','Elden Ring','RPG','Mroczne fantasy RPG od FromSoftware i George R.R. Martina.',null,9.5,60,'elden-ring',2022,'rpg,popular,new'],
      ['g005','Baldur\'s Gate 3','RPG','Nagradzany RPG turowy oparty na D&D 5e.',null,9.9,150,'baldurs-gate-3',2023,'rpg,new,popular'],
      ['g006','GTA V','Action','Open-world action game in Los Santos.',null,9.3,90,'grand-theft-auto-v',2013,'action,popular'],
      ['g007','Forza Horizon 5','Racing','Wyścigi w otwartym świecie w Meksyku.',null,9.1,110,'forza-horizon-5',2021,'racing,popular'],
      ['g008','The Crew 2','Racing','Wyścigi na lądzie, wodzie i w powietrzu.',null,8.2,45,'the-crew-2',2018,'racing'],
      ['g009','Need for Speed Unbound','Racing','Stylowe wyścigi uliczne z unikatową oprawą graficzną.',null,7.9,50,'need-for-speed-unbound',2022,'racing,new'],
      ['g010','Age of Empires IV','Strategia','Powrót legendy strategii czasu rzeczywistego.',null,8.8,50,'age-of-empires-iv',2021,'strategy'],
      ['g011','Total War: Warhammer III','Strategia','Epicka strategia turowa w świecie Warhammera.',null,8.5,120,'total-war-warhammer-iii',2022,'strategy'],
      ['g012','Hades II','Action','Action roguelike in the underworld of Greek gods.',null,9.6,15,'hades-ii',2024,'action,new'],
      ['g013','Starfield','RPG','Eksploracja kosmosu od twórców Skyrima.',null,7.5,125,'starfield',2023,'rpg'],
      ['g014','Hollow Knight','Action','Beautiful metroidvania in an underground kingdom of insects.',null,9.4,9,'hollow-knight',2017,'action,indie'],
      ['g015','Stardew Valley','Symulacja','Relaksująca gra farmerska z elementami RPG.',null,9.7,1,'stardew-valley',2016,'simulation,indie,popular'],
    ]
    const insertMany = db.transaction((games) => {
      for (const g of games) insertGame.run(...g)
    })
    insertMany(seedGames)
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Window controls
ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.on('window:close', () => mainWindow.close())
ipcMain.on('window:hide', () => mainWindow.hide())

// Auth
ipcMain.handle('auth:register', async (_, { username, email, password }) => {
  const bcrypt = require('bcryptjs')
  const { v4: uuidv4 } = require('uuid')
  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username)
    if (existing) return { success: false, error: 'Email lub nazwa użytkownika już istnieje' }
    const hash = bcrypt.hashSync(password, 10)
    const id = uuidv4()
    db.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(id, username, email, hash)
    const token = uuidv4()
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), id, token, expires)
    return { success: true, token, user: { id, username, email } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('auth:login', async (_, { email, password }) => {
  const bcrypt = require('bcryptjs')
  const { v4: uuidv4 } = require('uuid')
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user) return { success: false, error: 'Nieprawidłowy email lub hasło' }
    if (!bcrypt.compareSync(password, user.password)) return { success: false, error: 'Nieprawidłowy email lub hasło' }
    db.prepare('UPDATE users SET last_login = strftime(\'%s\',\'now\') WHERE id = ?').run(user.id)
    const token = uuidv4()
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), user.id, token, expires)
    const { password: _, ...safeUser } = user
    return { success: true, token, user: safeUser }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('auth:logout', async (_, { token }) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  return { success: true }
})

ipcMain.handle('auth:validate', async (_, { token }) => {
  const session = db.prepare(`
    SELECT s.*, u.id as uid, u.username, u.email, u.avatar_url
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > strftime('%s','now')
  `).get(token)
  if (!session) return { valid: false }
  return { valid: true, user: { id: session.uid, username: session.username, email: session.email, avatar_url: session.avatar_url } }
})

// Games
ipcMain.handle('games:list', async (_, { search, genre, tag } = {}) => {
  let query = 'SELECT * FROM games WHERE 1=1'
  const params = []
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`) }
  if (genre) { query += ' AND genre = ?'; params.push(genre) }
  if (tag) { query += ' AND tags LIKE ?'; params.push(`%${tag}%`) }
  query += ' ORDER BY rating DESC'
  return db.prepare(query).all(...params)
})

ipcMain.handle('games:get', async (_, { id }) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id)
  const reviews = db.prepare(`
    SELECT r.*, u.username FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.game_id = ? ORDER BY r.created_at DESC
  `).all(id)
  return { game, reviews }
})

// Library
// ── Helper: ensure Firebase user exists in local SQLite ──────────────────────
function ensureLocalUser(userId, username, email) {
  if (!userId) return
  try {
    db.pragma('foreign_keys = OFF')
    db.prepare('INSERT OR IGNORE INTO users (id, username, email, password) VALUES (?,?,?,?)')
      .run(userId, username || 'Player', email || '', '')
    if (username && username !== 'Player') {
      db.prepare('UPDATE users SET username=? WHERE id=? AND username=?')
        .run(username, userId, 'Player')
    }
    db.pragma('foreign_keys = ON')
  } catch(e) {
    try { db.pragma('foreign_keys = ON') } catch {}
  }
}

// ── Helper: trigger achievement ───────────────────────────────────────────────
function triggerAchievement(event, userId) {
  if (!achievementsManager || !userId) return
  try {
    switch(event) {
      case 'login':    achievementsManager.checkAfterLogin(userId);         break
      case 'download': achievementsManager.checkAfterDownload(userId);      break
      case 'library':  achievementsManager.checkAfterLibraryChange(userId); break
      case 'review':   achievementsManager.checkAfterReview(userId);        break
      case 'chat':     achievementsManager.checkAfterChatMessage(userId);   break
      case 'friend':   achievementsManager.checkAfterFriend?.(userId);      break
      case 'playtime': achievementsManager.checkAfterPlaytime(userId);      break
    }
  } catch(e) { console.error('[achievements] trigger error:', e.message) }
}

// ── Helper: trigger achievement by downloadId ─────────────────────────────────
function triggerAchievementByDownload(downloadId) {
  if (!achievementsManager) return
  try {
    const row = db.prepare('SELECT user_id FROM downloads WHERE id=?').get(downloadId)
    if (row?.user_id) triggerAchievement('download', row.user_id)
  } catch(e) { console.error('[achievements] download trigger error:', e.message) }
}

ipcMain.handle('users:ensureLocal', async (_, { userId, username, email }) => {
  ensureLocalUser(userId, username, email)
  return { success: true }
})

ipcMain.handle('library:list', async (_, { userId }) => {
  ensureLocalUser(userId)
  return db.prepare(`
    SELECT l.*, g.title, g.genre, g.cover_url, g.rating, g.tags
    FROM library l JOIN games g ON l.game_id = g.id
    WHERE l.user_id = ? ORDER BY l.last_played DESC
  `).all(userId)
})

ipcMain.handle('library:remove', async (_, { id }) => {
  try {
    db.prepare('DELETE FROM library WHERE id=?').run(id)
    return { success: true }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('library:launch', async (_, { executable }) => {
  if (!executable) return { success: false, error: 'Brak ścieżki do pliku wykonywalnego' }
  shell.openPath(executable)
  return { success: true }
})

// Downloads
ipcMain.handle('downloads:list', async (_, { userId }) => {
  // LEFT JOIN — pokazuje też gry FitGirl bez game_id w tabeli games
  return db.prepare(`
    SELECT d.*,
      COALESCE(g.title, d.game_title) as title,
      g.cover_url,
      g.size_gb
    FROM downloads d
    LEFT JOIN games g ON d.game_id = g.id
    WHERE d.user_id = ?
    ORDER BY d.created_at DESC
  `).all(userId)
})

ipcMain.handle('downloads:add', async (_, { userId, gameId, magnetUri, gameTitle }) => {
  ensureLocalUser(userId)
  const { v4: uuidv4 } = require('uuid')
  // Sprawdź duplikaty (tylko jeśli gameId)
  if (gameId) {
    const existing = db.prepare('SELECT id FROM downloads WHERE user_id=? AND game_id=? AND status!=?').get(userId, gameId, 'completed')
    if (existing) return { success: false, error: 'Game is already in queue' }
  }
  const id = uuidv4()
  // Dodaj kolumnę game_title jeśli brakuje
  try {
    db.prepare('ALTER TABLE downloads ADD COLUMN game_title TEXT').run()
  } catch {}
  db.prepare('INSERT INTO downloads (id, user_id, game_id, game_title, status, magnet_uri) VALUES (?,?,?,?,?,?)')
    .run(id, userId, gameId || null, gameTitle || null, 'queued', magnetUri || null)
  return { success: true, id }
})

ipcMain.handle('downloads:remove', async (_, { id }) => {
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  return { success: true }
})

// ── Library: dodaj własną grę ────────────────────────────────────────────────
ipcMain.handle('library:addCustom', async (_, { userId, title, executable, installPath, coverUrl }) => {
  ensureLocalUser(userId)
  try {
    const { v4: uuidv4 } = require('uuid')
    // Sprawdź czy gra już istnieje w tabeli games
    let game = db.prepare('SELECT id FROM games WHERE LOWER(title) LIKE ?').get(`%${title.slice(0,20).toLowerCase()}%`)

    if (!game) {
      // Stwórz nowy wpis w games
      const gameId = uuidv4()
      db.prepare(`INSERT INTO games (id, title, cover_url, description, genre, release_year, rating, tags)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        gameId, title, coverUrl || null,
        'Added manually by user', 'Various',
        new Date().getFullYear(), null, 'custom'
      )
      game = { id: gameId }
    } else if (coverUrl) {
      // Zaktualizuj okładkę jeśli znaleziono
      db.prepare('UPDATE games SET cover_url=? WHERE id=?').run(coverUrl, game.id)
    }

    // Sprawdź czy już w bibliotece
    const exists = db.prepare('SELECT id FROM library WHERE user_id=? AND game_id=?').get(userId, game.id)
    if (exists) {
      db.prepare('UPDATE library SET executable=?, install_path=? WHERE id=?')
        .run(executable, installPath, exists.id)
      return { success: true, id: exists.id }
    }

    const libId = uuidv4()
    db.prepare('INSERT INTO library (id, user_id, game_id, executable, install_path) VALUES (?,?,?,?,?)')
      .run(libId, userId, game.id, executable, installPath || null)
    // Trigger library achievements
    try {
      const libUserId = userId
      setTimeout(() => triggerAchievement('library', libUserId), 500)
    } catch {}
    return { success: true, id: libId }
  } catch(e) {
    console.error('[library:addCustom]', e.message)
    return { success: false, error: e.message }
  }
})

// ── Playtime tracking ─────────────────────────────────────────────────────────
// Uruchamia monitorowanie w tle — nie blokuje renderera
ipcMain.handle('playtime:track', async (_, { libraryId, userId, executable }) => {
  ensureLocalUser(userId)
  const { exec } = require('child_process')
  const exeName  = path.basename(executable)
  const startTime = Date.now()
  console.log(`[Playtime] Start tracking: ${exeName}`)

  // Uruchom monitoring w tle (nie czekaj)
  ;(async () => {
    const checkProcess = () => new Promise(resolve => {
      exec(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, (err, stdout) => {
        resolve(!err && stdout.toLowerCase().includes(exeName.toLowerCase()))
      })
    })

    // Czekaj aż proces się uruchomi (max 60s)
    let started = false
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (await checkProcess()) { started = true; break }
    }
    if (!started) { console.log(`[Playtime] ${exeName} nie uruchomił się`); return }

    console.log(`[Playtime] ${exeName} uruchomiony — monitoruję`)

    // Monitoruj aż do zamknięcia
    while (await checkProcess()) {
      await new Promise(r => setTimeout(r, 10000))
    }

    const minutesPlayed = Math.max(1, Math.round((Date.now() - startTime) / 60000))
    console.log(`[Playtime] ${exeName} zamknięty po ${minutesPlayed} min`)

    try {
      db.prepare('UPDATE library SET playtime_min = COALESCE(playtime_min,0) + ?, last_played = ? WHERE id = ?')
        .run(minutesPlayed, Math.floor(Date.now()/1000), libraryId)
      const { v4: uuidv4 } = require('uuid')
      // Pobierz game_id z library
      const libRow = db.prepare('SELECT game_id FROM library WHERE id=?').get(libraryId)
      const gameId = libRow?.game_id || null
      db.prepare('INSERT INTO playtime_sessions (id, library_id, user_id, game_id, duration_min, played_at, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuidv4(), libraryId, userId, gameId, minutesPlayed, Math.floor(Date.now()/1000), Math.floor((Date.now() - minutesPlayed*60000)/1000), Math.floor(Date.now()/1000))
      console.log(`[Playtime] Zapisano: ${minutesPlayed} min dla ${libraryId}`)
      // Notify renderer — it will sync to Firebase
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('playtime:updated', { libraryId, minutes: minutesPlayed, userId })
      }
    } catch(e) {
      console.error('[Playtime] błąd zapisu:', e.message)
    }
  })()

  return { success: true, tracking: true }
})

// ── HTTP fetch dla scrapingu okładek ─────────────────────────────────────────
ipcMain.handle('fg:fetchUrl', async (_, { url }) => {
  try {
    const axios = require('axios')
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' },
      timeout: 10000,
    })
    return { success: true, html: data }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

// ── Users: update profile (with cooldowns) ───────────────────────────────────
ipcMain.handle('users:update', async (_, { userId, username, email, password }) => {
  try {
    // Dodaj kolumny cooldown jeśli nie istnieją
    for (const col of ['username_changed_at', 'password_changed_at']) {
      try { db.prepare(`ALTER TABLE users ADD COLUMN ${col} INTEGER`).run() } catch {}
    }

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId)
    if (!user) return { success: false, error: 'User not found' }

    const now = Math.floor(Date.now() / 1000)
    const DAY = 86400

    if (username && username !== user.username) {
      // Cooldown 7 dni na zmianę nicku
      const lastChange = user.username_changed_at || 0
      const daysSince = (now - lastChange) / DAY
      if (daysSince < 7) {
        const daysLeft = Math.ceil(7 - daysSince)
        return { success: false, error: `Username can be changed again in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` }
      }
      const exists = db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username, userId)
      if (exists) return { success: false, error: 'Username already taken' }
      db.prepare('UPDATE users SET username=?, username_changed_at=? WHERE id=?').run(username, now, userId)
    }

    if (email && email !== user.email) {
      const exists = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, userId)
      if (exists) return { success: false, error: 'Email already in use' }
      db.prepare('UPDATE users SET email=? WHERE id=?').run(email, userId)
    }

    if (password && password.length >= 6) {
      // Cooldown 3 dni na zmianę hasła
      const lastChange = user.password_changed_at || 0
      const daysSince = (now - lastChange) / DAY
      if (daysSince < 3) {
        const daysLeft = Math.ceil(3 - daysSince)
        return { success: false, error: `Password can be changed again in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` }
      }
      const bcrypt = require('bcryptjs')
      const hash = await bcrypt.hash(password, 10)
      db.prepare('UPDATE users SET password=?, password_changed_at=? WHERE id=?').run(hash, now, userId)
    }

    const updated = db.prepare('SELECT id, username, email, username_changed_at, password_changed_at FROM users WHERE id=?').get(userId)
    return { success: true, user: updated }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

// ── Settings (język, motyw itp.) ─────────────────────────────────────────────
const store = new Store()

ipcMain.handle('settings:get', async () => {
  return {
    language: store.get('language', 'pl'),
    theme:    store.get('theme', 'dark'),
  }
})

ipcMain.handle('settings:set', async (_, data) => {
  if (data.language) store.set('language', data.language)
  if (data.theme)    store.set('theme', data.theme)
  return { success: true }
})

// Reviews
ipcMain.handle('reviews:add', async (_, { userId, gameId, rating, body }) => {
  const { v4: uuidv4 } = require('uuid')
  try {
    const id = uuidv4()
    db.prepare('INSERT OR REPLACE INTO reviews (id, user_id, game_id, rating, body) VALUES (?, ?, ?, ?, ?)')
      .run(id, userId, gameId, rating, body)
    const avgRating = db.prepare('SELECT AVG(rating) as avg FROM reviews WHERE game_id = ?').get(gameId)
    db.prepare('UPDATE games SET rating = ? WHERE id = ?').run(
      Math.round(avgRating.avg * 10) / 10, gameId
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Messages
ipcMain.handle('messages:list', async (_, { channel, userId, peerId }) => {
  if (channel === 'general') {
    return db.prepare(`
      SELECT m.*, u.username FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.channel = 'general' ORDER BY m.sent_at DESC LIMIT 100
    `).all().reverse()
  }
  return db.prepare(`
    SELECT m.*, u.username FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.sent_at ASC LIMIT 200
  `).all(userId, peerId, peerId, userId)
})

ipcMain.handle('messages:send', async (_, { senderId, receiverId, channel, body }) => {
  const { v4: uuidv4 } = require('uuid')
  const id = uuidv4()
  db.prepare('INSERT INTO messages (id, sender_id, receiver_id, channel, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, senderId, receiverId || null, channel || 'general', body)
  const msg = db.prepare('SELECT m.*, u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?').get(id)
  mainWindow.webContents.send('messages:new', msg)
  return { success: true, message: msg }
})

// Users online (mock – in production use WebSockets)
ipcMain.handle('users:online', async () => {
  return db.prepare(`
    SELECT DISTINCT u.id, u.username, u.avatar_url
    FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE s.expires_at > strftime('%s','now')
  `).all()
})

// FitGirl scraping
ipcMain.handle('fitgirl:search', async (_, { query }) => {
  const axios = require('axios')
  const cheerio = require('cheerio')
  try {
    const url = `https://fitgirl-repacks.site/?s=${encodeURIComponent(query)}`
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    const $ = cheerio.load(data)
    const results = []
    $('article').each((_, el) => {
      const title = $(el).find('.entry-title a').text().trim()
      const link = $(el).find('.entry-title a').attr('href')
      const thumb = $(el).find('img').first().attr('src') || null
      if (title && link) results.push({ title, link, thumb })
    })
    return { success: true, results: results.slice(0, 8) }
  } catch (err) {
    return { success: false, error: err.message, results: [] }
  }
})

ipcMain.handle('fitgirl:getMagnet', async (_, { url }) => {
  const axios = require('axios')
  const cheerio = require('cheerio')
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    const $ = cheerio.load(data)
    const magnets = []
    $('a[href^="magnet:"]').each((_, el) => {
      magnets.push($(el).attr('href'))
    })
    return { success: true, magnets }
  } catch (err) {
    return { success: false, error: err.message, magnets: [] }
  }
})

// torrent:start jest obsługiwany przez TorrentManager (register w initAllManagers)

// Ręczne uruchomienie instalatora po zakończeniu pobierania
// Called by renderer when torrent:done event is received
ipcMain.handle('torrent:reportDone', async (_, { downloadId }) => {
  triggerAchievementByDownload(downloadId)
  // Auto-add to library if game info available
  try {
    const dl = db.prepare('SELECT * FROM downloads WHERE id=?').get(downloadId)
    if (dl?.user_id) {
      db.prepare('UPDATE downloads SET status=? WHERE id=?').run('completed', downloadId)
      triggerAchievement('library', dl.user_id)
    }
  } catch {}
  return { success: true }
})

ipcMain.handle('torrent:launchSetup', async (_, { savePath, gameTitle, downloadId }) => {
  if (!savePath) return { success: false, error: 'Brak ścieżki' }

  const fs   = require('fs')
  const path = require('path')
  const { shell } = require('electron')

  // Szukaj folderu z nazwą podobną do tytułu gry
  function findSetupExe(dir, depth = 0) {
    if (depth > 3) return null
    try {
      const entries = fs.readdirSync(dir)
      // Najpierw szukaj setup.exe bezpośrednio
      for (const e of entries) {
        if (e.toLowerCase() === 'setup.exe') return path.join(dir, e)
      }
      // Potem w podfolderach
      for (const e of entries) {
        const p = path.join(dir, e)
        if (fs.statSync(p).isDirectory()) {
          const found = findSetupExe(p, depth + 1)
          if (found) return found
        }
      }
    } catch {}
    return null
  }

  // Szukaj w savePath i podfolderach
  let setupExe = findSetupExe(savePath)

  if (!setupExe) {
    // Otwórz folder żeby użytkownik mógł uruchomić ręcznie
    await shell.openPath(savePath)
    return { success: false, error: `Nie znaleziono setup.exe w ${savePath}. Otwarto folder.` }
  }

  console.log('[Setup] Uruchamiam:', setupExe)
  await shell.openPath(setupExe)
  return { success: true, installer: setupExe }
})

// ─── App lifecycle ────────────────────────────────────────────────────────────
// Flaga — managers inicjalizowane tylko raz
let _managersInited = false

function initAllManagers() {
  if (_managersInited) return
  _managersInited = true

  // ── TorrentManager — preferuj aria2, fallback na WebTorrent ─────────────
  console.log('[SEALM] Aria2Manager załadowany:', !!Aria2Manager)
  console.log('[SEALM] TorrentManager załadowany:', !!TorrentManager)
  if (Aria2Manager) {
    try {
      torrentManager = new Aria2Manager(mainWindow, db)
      torrentManager.register(ipcMain)
      console.log('[SEALM] ✅ Używam aria2Manager')
    } catch(e) {
      console.warn('[SEALM] Aria2Manager failed:', e.message, e.stack)
      torrentManager = null
    }
  }
  if (!torrentManager && TorrentManager) {
    try {
      torrentManager = new TorrentManager(mainWindow, db)
      torrentManager.register(ipcMain)
      console.log('[SEALM] Używam TorrentManager (WebTorrent)')
    } catch(e) { console.warn('[SEALM] TorrentManager:', e.message) }
  }

  // ── ChatServer ──────────────────────────────────────────────────────────────
  if (ChatServer) {
    try {
      chatServer = new ChatServer(db)
      chatServer.start()
    } catch(e) { console.warn('[SEALM] ChatServer:', e.message) }
  }
  ipcMain.handle('chat:wsPort',      async () => WS_PORT)
  ipcMain.handle('chat:onlineCount', async () => chatServer ? chatServer.getOnlineCount() : 0)

  // ── NotificationManager ─────────────────────────────────────────────────────
  if (NotificationManager) {
    try {
      notificationManager = new NotificationManager(mainWindow)
      notificationManager.register(ipcMain)
    } catch(e) { console.warn('[SEALM] NotificationManager:', e.message) }
  }
  ipcMain.on('notify:downloadComplete', (_, data) => { if (notificationManager) notificationManager.downloadComplete(data) })
  ipcMain.on('notify:chatMessage',      (_, data) => { if (notificationManager) notificationManager.newMessage(data) })

  // ── IGDB ────────────────────────────────────────────────────────────────────
  try {
    const Store = require('electron-store')
    const IGDBClient = require('./igdbClient')
    igdbClient = new IGDBClient(new Store())
    igdbClient.register(ipcMain, db)
    setTimeout(async () => { try { await igdbClient.enrichDatabase(db, 5) } catch {} }, 5000)
  } catch(e) { console.warn('[SEALM] IGDB:', e.message) }

  // ── Updater ─────────────────────────────────────────────────────────────────
  try {
    const Updater = require('./updater')
    updater = new Updater(mainWindow, notificationManager)
    updater.register(ipcMain)
    setTimeout(() => { if (updater) updater.check() }, 30000)
  } catch(e) { console.warn('[SEALM] Updater:', e.message) }

  // ── FirebaseManager ──────────────────────────────────────────────────────
  try {
    // Firebase is now handled via React SDK (src/lib/firebase.js)
    // Old firebaseManager kept for compatibility but not needed
    try {
      const FirebaseManager = require('./firebaseManager')
      firebaseManager = new FirebaseManager(mainWindow, db)
      firebaseManager.register(ipcMain)
    } catch {}
  } catch(e) { console.warn('[SEALM] FirebaseManager:', e.message) }

  // ── AchievementsManager ─────────────────────────────────────────────────────
  try {
    const AchievementsManager = require('./achievementsManager')
    achievementsManager = new AchievementsManager(db, mainWindow)
    achievementsManager.register(ipcMain)
  } catch(e) { console.warn('[SEALM] AchievementsManager:', e.message) }

  // ── FriendsManager ──────────────────────────────────────────────────────────
  try {
    const FriendsManager = require('./friendsManager')
    friendsManager = new FriendsManager(db, mainWindow, achievementsManager)
    friendsManager.register(ipcMain)
  } catch(e) { console.warn('[SEALM] FriendsManager:', e.message) }

  console.log('[SEALM] All managers initialized')

  // ── FitGirl/DODI Catalog ────────────────────────────────────────────────
  try {
    const FitGirlCatalog = require('./fitgirlCatalog')
    fitgirlCatalog = new FitGirlCatalog(db)
    fitgirlCatalog.register(ipcMain, mainWindow)
    console.log('[Catalog] Zainicjalizowany')
    // Nie auto-sync — użytkownik klika Synchronizuj sam
  } catch(e) { console.warn('[SEALM] FitGirlCatalog:', e.message) }
}

// ─── Manager variables ─────────────────────────────────────────────────────────
let igdbClient          = null
let updater             = null
let achievementsManager = null
let friendsManager      = null
let fitgirlCatalog      = null

// ─── IPC: library updateConfig ─────────────────────────────────────────────────
ipcMain.handle('library:updateConfig', async (_, { id, executable, installPath }) => {
  try {
    db.prepare('UPDATE library SET executable = ?, install_path = ? WHERE id = ?')
      .run(executable || null, installPath || null, id)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── IPC: dialog ──────────────────────────────────────────────────────────────
const { dialog } = require('electron')
ipcMain.handle('dialog:openFile', async (_, { filters } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ─── IPC: achievements trigger ────────────────────────────────────────────────
ipcMain.handle('achievements:trigger', async (_, { event, userId, username, email }) => {
  if (!achievementsManager || !userId) return { success: false }
  ensureLocalUser(userId, username, email)  // always ensure user exists first
  triggerAchievement(event, userId)
  return { success: true }
})

// ─── Start ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initDatabase()
  createWindow()
  createTray()
  // Inicjalizuj managery po stworzeniu okna (jeden raz)
  initAllManagers()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (chatServer) chatServer.stop()
  if (torrentManager) torrentManager.destroy()
  if (db) db.close()
})

// ─── Firebase Chat ────────────────────────────────────────────────────────────
let firebaseChat = null

function initFirebase() {
  try {
    // firebaseChat replaced by React Firebase SDK
        // Inicjalizuj Firebase w tle
    firebaseChat.init().then(ok => {
      if (ok) console.log('[Firebase] Czat online gotowy')
      else    console.log('[Firebase] Brak klucza — używam czatu lokalnego')
    })
  } catch(e) {
    console.warn('[Firebase] Błąd:', e.message)
  }
}

app.on('will-quit', () => {
  if (firebaseChat) firebaseChat.destroy()
})

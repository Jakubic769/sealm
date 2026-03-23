# SEALM — Game Launcher

> Electron + React + SQLite + Firebase · Dark Cyberpunk UI · FitGirl Integration · aria2 Downloads · Online Backend

![Version](https://img.shields.io/badge/version-1.0.0-7c3aed?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-06b6d4?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)
![Electron](https://img.shields.io/badge/built%20with-Electron%2029-a855f7?style=flat-square)

---

## What is SEALM?

SEALM is a **next-generation game launcher** built from scratch by a 14-year-old developer from Poland. It combines a FitGirl Repacks catalog browser, aria2-powered torrent downloads, a game library with playtime tracking, and a full online backend with real-time chat, friends system, and achievement tracking — all in a dark cyberpunk UI.

**This is my first big project.**

---

## Features

| Feature | Description |
|---------|-------------|
| 🎮 Game Library | Add any game, track playtime, launch with one click |
| ⬇ FitGirl Downloads | Browse the full FitGirl catalog, download via aria2 |
| 💬 Global Chat | Real-time chat via Firebase Realtime Database |
| 👥 Friends System | Add friends, see online/offline status in real time |
| 🏆 Trophies | 14 achievements tracked online via Firebase |
| 👤 Profiles | Avatar URL, bio, playtime stats synced to Firebase |
| 🔐 Auth | Firebase Authentication with email password reset |
| 📊 Stats | Playtime per game, total hours, games count — synced online |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 29 (frameless window) |
| Frontend | React 18 + React Router 6 |
| State | Zustand |
| Local DB | SQLite via `better-sqlite3` |
| Online Backend | Firebase Auth + Realtime Database |
| Animations | Framer Motion |
| Downloads | aria2c via subprocess + JSON-RPC |
| Scraping | Axios + Cheerio (FitGirl Repacks) |
| Styling | CSS Modules + Google Fonts (Rajdhani + Exo 2) |

---

## Requirements

- **Windows 10 / 11** (x64)
- **Node.js** >= 18.x + npm >= 9.x *(for building from source)*
- **aria2c.exe** placed in the `bin/` folder — [download here](https://github.com/aria2/aria2/releases)
- **Visual C++ Redistributable** — [All-in-One](https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/)
- **.NET Framework** — [Microsoft](https://dotnet.microsoft.com/en-us/download/dotnet-framework)

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/jakubic769/sealm.git
cd sealm

# 2. Install dependencies
npm install
npm install firebase

# 3. Place aria2c.exe in bin/
# Download from https://github.com/aria2/aria2/releases
# Place at: sealm/bin/aria2c.exe

# 4. Start in development mode
npm run electron:dev

# 5. Or build a portable .exe
npm run electron:build:win
```

---

## Project Structure

```
sealm/
├── bin/
│   └── aria2c.exe                  ← place here manually
├── electron/
│   ├── main.js                     ← main process, IPC, SQLite
│   ├── preload.js                  ← secure IPC bridge
│   ├── aria2Manager.js             ← aria2c subprocess + JSON-RPC
│   ├── achievementsManager.js      ← SQLite achievements
│   ├── fitgirlCatalog.js           ← FitGirl scraper
│   └── igdbClient.js               ← IGDB cover art
├── src/
│   ├── App.js                      ← router + Firebase auth listener
│   ├── lib/
│   │   ├── firebase.js             ← Firebase app config
│   │   ├── firebaseAuth.js         ← auth wrapper
│   │   ├── firebaseChat.js         ← real-time chat + presence
│   │   ├── firebaseFriends.js      ← friends system
│   │   └── firebaseAchievements.js ← 14 trophies
│   ├── store/
│   │   ├── authStore.js            ← Zustand auth
│   │   └── downloadsStore.js       ← Zustand downloads
│   └── components/
│       ├── auth/                   ← login, register, forgot password
│       ├── fitgirl/                ← store page + game detail
│       ├── library/                ← library, add/remove/configure
│       ├── downloads/              ← download queue with phases
│       ├── chat/                   ← real-time chat
│       ├── friends/                ← friends, requests, search
│       ├── profile/                ← profile, edit modal
│       ├── achievements/           ← trophies page
│       └── settings/               ← app settings
└── package.json
```

---

## Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password
3. Enable **Realtime Database** → Start in test mode
4. Replace config in `src/lib/firebase.js`
5. Set database rules:

```json
{
  "rules": {
    "users":          { ".read": "auth != null", "$uid": { ".write": "$uid === auth.uid" }},
    "chat":           { ".read": "auth != null", ".write": "auth != null" },
    "presence":       { "$uid": { ".read": "auth != null", ".write": "$uid === auth.uid" }},
    "friends":        { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" }},
    "friendRequests": { "$uid": { ".read": "$uid === auth.uid", ".write": "auth != null" }},
    "typing":         { ".read": "auth != null", ".write": "auth != null" },
    "achievements":   { "$uid": { ".read": "auth != null", ".write": "$uid === auth.uid" }},
    "counters":       { "$uid": { ".read": "$uid === auth.uid", ".write": "$uid === auth.uid" }}
  }
}
```

---

## Download Flow (aria2)

```
User clicks "Download"
        │
        ▼
FitGirl page → scrape magnet link
        │
        ▼
downloads:add → SQLite record (status: queued)
        │
        ▼
torrent:start → aria2Manager.add(magnetUri, savePath)
        │
        ▼
aria2c subprocess → JSON-RPC polling every 3s
Phases: connecting → allocating → downloading → verifying
        │
        ▼
torrent:done → "Install" button appears
        │
        ▼
torrent:launchSetup → finds setup.exe → shell.openPath()
```

---

## Roadmap

- [x] Firebase Auth (register, login, password reset via email)
- [x] Real-time chat with typing indicators
- [x] Friends system with online/offline presence
- [x] 14 Trophies tracked in Firebase
- [x] FitGirl catalog browser (A-Z + popular)
- [x] aria2 torrent downloads with 4-phase tracking
- [x] Game library with playtime tracking
- [x] Avatar via URL, bio, profile editing
- [ ] Code signing
- [ ] Auto-updater via GitHub Releases
- [ ] Auto-detect installed game after setup.exe completes
- [ ] More trophies

---

## About

Built by **Jakub** (Z4XQ) — a 14-year-old self-taught developer from Poland.  
SEALM is my first large-scale project. I mainly work in C++ and Python, and built this to learn JavaScript, React and Electron.

🔗 [guns.lol/z4xq](https://guns.lol/z4xq)

---

## License

MIT — see [LICENSE.txt](LICENSE.txt)

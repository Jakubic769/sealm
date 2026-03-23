# SEALM — Game Launcher & Store

> Electron + React + SQLite · Dark UI · FitGirl Integration · Torrent Downloads

---

## Stack

| Warstwa       | Technologia                           |
|---------------|---------------------------------------|
| Shell         | Electron 29 (frameless window)        |
| Frontend      | React 18 + React Router 6             |
| State         | Zustand                               |
| Baza danych   | SQLite via `better-sqlite3`           |
| Animacje      | Framer Motion                         |
| Powiadomienia | react-hot-toast                       |
| Scraping      | Axios + Cheerio (FitGirl Repacks)     |
| Torrenty      | Magnet URI → system torrent client    |
| Styl          | CSS Modules + Google Fonts (Rajdhani + Exo 2) |

---

## Wymagania

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- Klient torrent (np. **qBittorrent**) zainstalowany w systemie
- Windows 10/11 lub Linux (testowane na Ubuntu 22.04)

---

## Instalacja i uruchomienie

```bash
# 1. Klonuj / wypakuj projekt
cd sealm

# 2. Zainstaluj zależności
npm install

# 3. Uruchom w trybie deweloperskim (React dev server + Electron)
npm run electron:dev

# 4. (Opcjonalnie) Zbuduj plik wykonywalny
npm run electron:build
```

> Przy pierwszym uruchomieniu Electron automatycznie tworzy bazę SQLite
> w `%APPDATA%/sealm/sealm.db` (Windows) lub `~/.config/sealm/sealm.db` (Linux).

---

## Struktura projektu

```
sealm/
├── electron/
│   ├── main.js          # Główny proces Electron — okno, IPC, baza danych
│   └── preload.js       # Bezpieczny most IPC (contextBridge)
│
├── src/
│   ├── App.js           # Router + auth gate
│   ├── index.css        # Design system — tokeny CSS, czcionki, animacje
│   │
│   ├── store/
│   │   ├── authStore.js       # Zustand: logowanie, rejestracja, sesja
│   │   └── downloadsStore.js  # Zustand: kolejka pobrań, polling postępu
│   │
│   └── components/
│       ├── auth/
│       │   ├── AuthLayout.js        # Ekran logowania / rejestracji
│       │   └── AuthLayout.module.css
│       │
│       ├── layout/
│       │   ├── AppLayout.js         # Shell: titlebar + sidebar + <Outlet>
│       │   └── AppLayout.module.css
│       │
│       ├── store/
│       │   ├── StorePage.js         # Sklep: siatka gier, wyszukiwarka, FitGirl
│       │   └── StorePage.module.css
│       │
│       ├── library/
│       │   └── LibraryPage.js       # Biblioteka zainstalowanych gier
│       │
│       ├── downloads/
│       │   ├── DownloadsPage.js     # Kolejka pobrań z paskami postępu
│       │   └── DownloadsPage.module.css
│       │
│       ├── chat/
│       │   └── ChatPage.js          # Czat ogólny + wiadomości 1:1
│       │
│       ├── settings/
│       │   └── SettingsPage.js      # Ustawienia z przełącznikami
│       │
│       └── profile/
│           └── ProfilePage.js       # Profil użytkownika, statystyki, wylogowanie
│
├── scripts/
│   └── init-db.js       # Ręczna inicjalizacja bazy (dev)
│
├── public/
│   └── index.html
│
└── package.json
```

---

## Architektura IPC

Komunikacja między UI (renderer) a logiką (main) odbywa się przez
**bezpieczny most `preload.js`** z `contextIsolation: true`.

```
React UI
   │  window.sealm.auth.login(...)
   ▼
preload.js (contextBridge)
   │  ipcRenderer.invoke('auth:login', ...)
   ▼
electron/main.js
   │  ipcMain.handle('auth:login', ...)
   │       └─ SQLite query via better-sqlite3
   ▼
{ success, token, user }
```

Dostępne kanały IPC:

| Kanał                  | Opis                                          |
|------------------------|-----------------------------------------------|
| `auth:register`        | Rejestracja nowego konta                      |
| `auth:login`           | Logowanie, tworzenie sesji                    |
| `auth:logout`          | Usunięcie tokenu sesji                        |
| `auth:validate`        | Walidacja tokenu przy starcie                 |
| `games:list`           | Lista gier (filtrowanie, wyszukiwanie)        |
| `games:get`            | Szczegóły gry + recenzje                      |
| `library:list`         | Biblioteka zainstalowanych gier użytkownika   |
| `library:launch`       | Uruchamianie pliku .exe gry                   |
| `downloads:list`       | Lista pobrań z postępem                       |
| `downloads:add`        | Dodanie gry do kolejki pobrań                 |
| `downloads:remove`     | Usunięcie z kolejki                           |
| `reviews:add`          | Dodanie/aktualizacja recenzji                 |
| `messages:list`        | Historia wiadomości (kanał lub DM)            |
| `messages:send`        | Wysłanie wiadomości + push do renderera       |
| `users:online`         | Lista zalogowanych użytkowników               |
| `fitgirl:search`       | Wyszukiwanie gry na fitgirl-repacks.site      |
| `fitgirl:getMagnet`    | Pobranie linku magnet ze strony FitGirl       |
| `torrent:start`        | Otwarcie linku magnet przez system            |
| `window:minimize/maximize/close` | Kontrola okna                   |

---

## Schemat bazy danych (SQLite)

```sql
users       — id, username, email, password (bcrypt), avatar_url
games       — id, title, genre, description, cover_url, rating, size_gb, fitgirl_slug, tags
library     — user_id → game_id, install_path, executable, playtime_min
downloads   — user_id → game_id, status, progress, speed_kbps, eta_seconds, magnet_uri
reviews     — user_id → game_id, rating(1-10), body
messages    — sender_id, receiver_id?, channel, body
sessions    — user_id, token, expires_at
```

---

## Przepływ pobierania gry

```
Użytkownik klika "Pobierz"
        │
        ▼
fitgirl:search → szukaj tytuł na fitgirl-repacks.site
        │
        ▼
fitgirl:getMagnet → scraple link magnet z pierwszego wyniku
        │
        ▼
torrent:start → shell.openExternal(magnetUri) → qBittorrent/systemowy klient
        │
        ▼
downloads:add → dodaje wpis do tabeli downloads (status: 'queued' → 'downloading')
        │
        ▼
useDownloadsStore.startPolling() → symulacja / podpięcie pod libtorrent IPC
        │
        ▼
progress = 100% → status: 'installing' → shell.openPath(installer.exe)
```

---

## Rozszerzanie projektu

### Podpięcie prawdziwego libtorrent

Zainstaluj `webtorrent` lub binding Node.js dla `libtorrent`:

```bash
npm install webtorrent
```

W `electron/main.js` zamień handler `torrent:start` na pełną implementację
z WebTorrent + IPC progress events:

```js
const WebTorrent = require('webtorrent')
const client = new WebTorrent()

ipcMain.handle('torrent:start', async (_, { magnetUri, savePath }) => {
  client.add(magnetUri, { path: savePath }, (torrent) => {
    torrent.on('download', () => {
      mainWindow.webContents.send('torrent:progress', {
        infoHash: torrent.infoHash,
        progress: torrent.progress * 100,
        downloadSpeed: torrent.downloadSpeed,
        timeRemaining: torrent.timeRemaining,
      })
    })
    torrent.on('done', () => {
      mainWindow.webContents.send('torrent:done', { infoHash: torrent.infoHash })
    })
  })
  return { success: true }
})
```

### WebSocket czat w czasie rzeczywistym

Dodaj `ws` do zależności i utwórz WebSocket server w `main.js` dla
wieloosobowego czatu bez pollingu.

### Okładki z IGDB API

Zarejestruj się na https://api.igdb.com i pobieraj okładki automatycznie
przy seedowaniu bazy gier.

---

## Roadmap

- [x] Autentykacja (login/rejestracja) + sesje SQLite
- [x] Sklep z wyszukiwarką i kategoriami
- [x] Integracja FitGirl Repacks (scraping + magnet)
- [x] Kolejka pobrań z paskami postępu
- [x] Biblioteka gier z uruchamianiem
- [x] Czat ogólny + wiadomości 1:1
- [x] Ustawienia z przełącznikami
- [x] Profil użytkownika
- [ ] Prawdziwy klient torrent (libtorrent / WebTorrent)
- [ ] Automatyczny instalator FitGirl (.exe autorun)
- [ ] Czat WebSocket w czasie rzeczywistym
- [ ] Okładki gier z IGDB API
- [ ] Powiadomienia systemowe (Electron Notification API)
- [ ] Aktualizacje launchera (electron-updater)
- [ ] Osiągnięcia i statystyki szczegółowe
- [ ] Strona szczegółów gry z recenzjami
- [ ] Screenshoty i galerie gier

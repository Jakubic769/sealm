# SEALM — Instrukcja Uruchomienia

## Wymagania

| Narzędzie   | Wersja minimalna | Instalacja                          |
|-------------|------------------|-------------------------------------|
| Node.js     | 18.x LTS         | https://nodejs.org                  |
| npm         | 9.x              | dołączony do Node.js                |
| Git         | dowolna          | https://git-scm.com                 |
| qBittorrent | 4.x (opcjonalnie)| https://qbittorrent.org             |

---

## Szybki start (dev)

```bash
# 1. Klonuj repozytorium
git clone https://github.com/twoj-nick/sealm.git
cd sealm

# 2. Zainstaluj zależności
npm install

# 3. Uruchom w trybie deweloperskim
npm run electron:dev
```

Aplikacja otworzy okno Electron z React DevTools po ~15s.

---

## Konfiguracja IGDB (opcjonalna — okładki gier)

1. Wejdź na https://dev.twitch.tv/console
2. Utwórz nową aplikację → skopiuj `Client ID` i `Client Secret`
3. Uruchom SEALM, przejdź do **Ustawienia → IGDB**
   lub ustaw zmienne środowiskowe przed startem:

```bash
IGDB_CLIENT_ID=xxx IGDB_CLIENT_SECRET=yyy npm run electron:dev
```

SEALM automatycznie pobierze okładki dla wszystkich gier w tle.

---

## Build produkcyjny

```bash
# Windows (.exe installer NSIS + portable)
npm run electron:build:win

# Linux (AppImage + .deb)
npm run electron:build:linux

# Oba systemy jednocześnie
npm run dist
```

Wynik w katalogu `dist/`.

---

## Konfiguracja auto-update (GitHub Releases)

1. Edytuj `package.json` → `build.publish.owner` i `build.publish.repo`
2. W GitHub repo utwórz secret `GH_TOKEN` z uprawnieniem `contents: write`
3. Wersja `1.0.0` w `package.json` → tag `v1.0.0` → push → GitHub Actions buduje i tworzy release automatycznie:

```bash
npm version patch   # → 1.0.1
git push --follow-tags
```

---

## Struktura katalogów po buildzie

```
dist/
├── SEALM-Setup-1.0.0-x64.exe    ← installer Windows (NSIS)
├── SEALM-1.0.0-x64.exe           ← portable Windows
├── SEALM-1.0.0-x64.AppImage      ← Linux AppImage
├── SEALM-1.0.0-amd64.deb         ← Linux Debian package
└── latest.yml                    ← manifest dla auto-updater
```

---

## Zmienne środowiskowe

| Zmienna               | Opis                                        | Wymagana |
|-----------------------|---------------------------------------------|----------|
| `IGDB_CLIENT_ID`      | Twitch/IGDB Client ID                       | Nie      |
| `IGDB_CLIENT_SECRET`  | Twitch/IGDB Client Secret                   | Nie      |
| `NODE_ENV`            | `development` lub `production`              | Nie      |
| `GH_TOKEN`            | GitHub token dla electron-updater           | Dla build|

---

## Rozwiązywanie problemów

### Czarny ekran po uruchomieniu
```bash
# Wyczyść cache React
rm -rf build/
npm run electron:dev
```

### `better-sqlite3` błąd binarki
```bash
npm rebuild better-sqlite3
```

### WebTorrent nie startuje
Zainstaluj qBittorrent jako fallback — SEALM automatycznie otworzy link magnet w systemowym kliencie.

### Port 45678 zajęty (WebSocket czat)
Zmień `WS_PORT` w `electron/chatServer.js` na inny wolny port (np. 45679).

### IGDB zwraca 401
Token Twitch wygasł. SEALM odświeża go automatycznie przy następnym starcie.
Możesz wymusić odświeżenie usuwając `igdb.token` z pliku konfiguracyjnego:
```
Windows: %APPDATA%\sealm\config.json
Linux:   ~/.config/sealm/config.json
```

---

## Dane użytkownika

Wszystkie dane (baza SQLite, ustawienia, cache okładek) przechowywane są w:

```
Windows: %APPDATA%\sealm\
Linux:   ~/.config/sealm/
macOS:   ~/Library/Application Support/sealm/
```

---

## Architektura w skrócie

```
┌─────────────────────────────────────────────────────────┐
│                   SEALM Application                      │
│                                                          │
│  ┌──────────────┐    IPC    ┌──────────────────────────┐ │
│  │  React UI    │◄────────►│  Electron Main Process   │ │
│  │  (Renderer)  │  Bridge  │                          │ │
│  │              │ preload  │  ┌──────────────────────┐│ │
│  │  React Router│          │  │    better-sqlite3    ││ │
│  │  Zustand     │          │  │    (sealm.db)        ││ │
│  │  Framer      │          │  └──────────────────────┘│ │
│  │  Motion      │          │  ┌──────────────────────┐│ │
│  └──────────────┘          │  │  WebSocket Server    ││ │
│                            │  │  (ws://127.0.0.1:    ││ │
│  ┌──────────────┐          │  │   45678)             ││ │
│  │  WebSocket   │◄────────►│  └──────────────────────┘│ │
│  │  Client      │   WS     │  ┌──────────────────────┐│ │
│  └──────────────┘          │  │  TorrentManager      ││ │
│                            │  │  (WebTorrent/shell)  ││ │
│                            │  └──────────────────────┘│ │
│                            │  ┌──────────────────────┐│ │
│                            │  │  IGDB Client         ││ │
│                            │  │  (Twitch OAuth)      ││ │
│                            │  └──────────────────────┘│ │
│                            └──────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

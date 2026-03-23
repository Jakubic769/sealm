import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

// ── Electron bridge ──────────────────────────────────────────────────────────
// window.sealm jest wstrzykiwane przez Electron preload.js PRZED renderem.
// Jeśli go nie ma (np. otwarto w przeglądarce), tworzymy stub z ostrzeżeniami.
// W normalnym trybie Electron preload ustawia window.sealm zanim JS się wykona.

if (typeof window.sealm === 'undefined') {
  const warn = (name) => async () => {
    console.error(`[SEALM] Brak połączenia z Electron. Funkcja: ${name}`)
    return { success: false, error: 'Uruchom przez: npm run electron:dev' }
  }
  const stub = () => () => {}   // event listener stub — returns unsubscribe noop

  window.sealm = {
    window:        { minimize: ()=>{}, maximize: ()=>{}, close: ()=>{}, hide: ()=>{} },
    auth:          { register: warn('auth.register'), login: warn('auth.login'), logout: async()=>{}, validate: async()=>({ valid:false }) },
    games:         { list: async()=>[], get: async()=>({ game: null, reviews: [] }) },
    library:       {
      addCustom: async () => ({ success: false, error: 'Unavailable outside Electron' }), list: async()=>[], launch: warn('library.launch'), updateConfig: warn('library.updateConfig') },
    downloads:     { list: async()=>[], add: warn('downloads.add'), remove: warn('downloads.remove') },
    reviews:       { add: warn('reviews.add') },
    messages:      { list: async()=>[], send: warn('messages.send'), onNew: (_cb) => () => {} },
    users:         { online: async()=>[] },
    fitgirl:       { search: async()=>({ success:false, results:[] }), getMagnet: async()=>({ success:false, magnets:[] }), catalog: { sync: async()=>({ success:false, added:0, total:0 }), search: async()=>([]), stats: async()=>({ count:0 }), getPage: async()=>({ success:false, magnets:[], coverUrl:null }), fetchCover: async()=>null, getMagnet: async()=>({ success:false, magnets:[] }), onProgress: (_cb) => () => {} } },
    torrent:       { start: warn('torrent.start'), pause: ()=>{}, resume: ()=>{}, remove: ()=>{}, list: async()=>[], onProgress: (_cb) => () => {}, onDone: (_cb) => () => {}, onError: (_cb) => () => {} },
    chat:          { getWsPort: async()=>45678, onlineCount: async()=>0 },
    notifications: { updateSettings: ()=>{}, test: ()=>{}, notifyDownloadDone: ()=>{}, notifyChatMessage: ()=>{} },
    achievements:  { list: async()=>[], stats: async()=>({ total:0, unlocked:0, points:0, percent:0 }), trigger: ()=>{}, onUnlocked: (_cb) => () => {} },
    playtime:      {
      track: async () => ({ success: false }), start: ()=>{}, end: ()=>{}, history: async()=>[] },
    friends:       { list: async()=>[], pending: async()=>[], request: warn('friends.request'), accept: ()=>{}, remove: ()=>{}, searchUsers: async()=>[], onRequest: (_cb) => () => {} },
    igdb:          { getCover: async()=>({ success:false, url:null }), getMetadata: async()=>({ success:false }), enrichAll: ()=>{}, setCredentials: ()=>{}, hasCredentials: async()=>({ has:false }) },
    updater:       { check: ()=>{}, download: ()=>{}, install: ()=>{}, onEvent: (_cb) => () => {} },
    dialog:        { openFile: warn('dialog.openFile'), openDirectory: warn('dialog.openDirectory') },
    onNavigate:    (_cb) => () => {},
  }
  console.warn('[SEALM] Running without Electron preload — using stub. Use: npm run electron:dev')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

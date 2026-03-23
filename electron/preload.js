const { contextBridge, ipcRenderer } = require('electron')

// Expose a safe, typed API to the renderer process
contextBridge.exposeInMainWorld('sealm', {
  // ── Window controls ──────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
    hide:     () => ipcRenderer.send('window:hide'),
  },

  // ── Auth ─────────────────────────────────────────────────────────────────
  auth: {
    register: (data)    => ipcRenderer.invoke('auth:register', data),
    login:    (data)    => ipcRenderer.invoke('auth:login', data),
    logout:   (data)    => ipcRenderer.invoke('auth:logout', data),
    validate: (data)    => ipcRenderer.invoke('auth:validate', data),
  },

  // ── Games ────────────────────────────────────────────────────────────────
  games: {
    list:     (filters) => ipcRenderer.invoke('games:list', filters),
    get:      (data)    => ipcRenderer.invoke('games:get', data),
  },

  // ── Library ──────────────────────────────────────────────────────────────
  library: {
    list:         (data) => ipcRenderer.invoke('library:list', data),
    launch:       (data) => ipcRenderer.invoke('library:launch', data),
    updateConfig: (data) => ipcRenderer.invoke('library:updateConfig', data),
    addCustom:    (data) => ipcRenderer.invoke('library:addCustom', data),
    remove:       (data) => ipcRenderer.invoke('library:remove', data),
  },

  // ── Downloads ────────────────────────────────────────────────────────────
  downloads: {
    list:     (data)    => ipcRenderer.invoke('downloads:list', data),
    add:      (data)    => ipcRenderer.invoke('downloads:add', data),
    remove:   (data)    => ipcRenderer.invoke('downloads:remove', data),
  },

  // ── Reviews ──────────────────────────────────────────────────────────────
  reviews: {
    add:      (data)    => ipcRenderer.invoke('reviews:add', data),
  },

  // ── Messages / Chat ──────────────────────────────────────────────────────
  messages: {
    list:     (data)    => ipcRenderer.invoke('messages:list', data),
    send:     (data)    => ipcRenderer.invoke('messages:send', data),
    onNew:    (cb)      => {
      ipcRenderer.on('messages:new', (_, msg) => cb(msg))
      return () => ipcRenderer.removeAllListeners('messages:new')
    },
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  users: {
    online:       ()     => ipcRenderer.invoke('users:online'),
    update:       (data) => ipcRenderer.invoke('users:update', data),
    ensureLocal:  (data) => ipcRenderer.invoke('users:ensureLocal', data),
  },

  // ── FitGirl / DODI Catalog ──────────────────────────────────────────────
  fitgirl: {
    // Legacy (stare handlery — zostawiamy dla kompatybilności)
    search:    (data)   => ipcRenderer.invoke('fitgirl:search', data),
    getMagnet: (data)   => ipcRenderer.invoke('fitgirl:getMagnet', data),
    // Nowe handlery katalogowe
    catalog: {
      sync:       (data) => ipcRenderer.invoke('fg:sync', data || {}),
      search:     (data) => ipcRenderer.invoke('fg:search', data),
      stats:      (data) => ipcRenderer.invoke('fg:stats', data || {}),
      getPage:    (data) => ipcRenderer.invoke('fg:getPage', data),
      fetchCover: (data) => ipcRenderer.invoke('fg:fetchCover', data),
      getMagnet:  (data) => ipcRenderer.invoke('fg:getPage', data),
      clear:      (data) => ipcRenderer.invoke('fg:clear', data),
      fetchView:  (data) => ipcRenderer.invoke('fg:fetchView', data),
      fetchUrl:   (data) => ipcRenderer.invoke('fg:fetchUrl', data),
      onProgress: (cb)   => {
        ipcRenderer.on('fg:sync:progress', (_, d) => cb(d))
        return () => ipcRenderer.removeAllListeners('fg:sync:progress')
      },
    },
  },

  // ── Torrent ──────────────────────────────────────────────────────────────
  torrent: {
    start:    (data) => ipcRenderer.invoke('torrent:start', data),
    pause:    (data) => ipcRenderer.invoke('torrent:pause', data),
    resume:   (data) => ipcRenderer.invoke('torrent:resume', data),
    remove:   (data) => ipcRenderer.invoke('torrent:remove', data),
    list:     ()     => ipcRenderer.invoke('torrent:list'),
    onProgress: (cb) => {
      ipcRenderer.on('torrent:progress', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:progress')
    },
    onDone: (cb) => {
      ipcRenderer.on('torrent:done', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:done')
    },
    onError: (cb) => {
      ipcRenderer.on('torrent:error', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:error')
    },
    onInstalled: (cb) => {
      ipcRenderer.on('torrent:game_installed', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:game_installed')
    },
    onInstallerLaunched: (cb) => {
      ipcRenderer.on('torrent:installer_launched', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:installer_launched')
    },
    onLog: (cb) => {
      ipcRenderer.on('torrent:log', (_, msg) => cb(msg))
      return () => ipcRenderer.removeAllListeners('torrent:log')
    },
    onMetadata: (cb) => {
      ipcRenderer.on('torrent:metadata', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:metadata')
    },
    onWarning: (cb) => {
      ipcRenderer.on('torrent:warning', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:warning')
    },
    onPeer: (cb) => {
      ipcRenderer.on('torrent:peer', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('torrent:peer')
    },
    launchSetup:  (data) => ipcRenderer.invoke('torrent:launchSetup', data),
    reportDone:   (data) => ipcRenderer.invoke('torrent:reportDone', data),
  },

  // ── Chat WebSocket ────────────────────────────────────────────────────────
  chat: {
    getWsPort: () => ipcRenderer.invoke('chat:wsPort'),
    onlineCount: () => ipcRenderer.invoke('chat:onlineCount'),
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: {
    updateSettings: (data) => ipcRenderer.invoke('notifications:settings', data),
    test: ()               => ipcRenderer.invoke('notifications:test'),
    notifyDownloadDone: (data) => ipcRenderer.send('notify:downloadComplete', data),
    notifyChatMessage:  (data) => ipcRenderer.send('notify:chatMessage', data),
  },

  // ── IGDB ──────────────────────────────────────────────────────────────────
  igdb: {
    getCover:        (data) => ipcRenderer.invoke('igdb:getCover', data),
    getMetadata:     (data) => ipcRenderer.invoke('igdb:getMetadata', data),
    enrichAll:       ()     => ipcRenderer.invoke('igdb:enrichAll'),
    setCredentials:  (data) => ipcRenderer.invoke('igdb:setCredentials', data),
    hasCredentials:  ()     => ipcRenderer.invoke('igdb:hasCredentials'),
  },

  // ── Updater ───────────────────────────────────────────────────────────────
  updater: {
    check:    () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install:  () => ipcRenderer.invoke('updater:install'),
    onEvent: (cb) => {
      const channels = ['updater:checking','updater:available','updater:not-available','updater:progress','updater:downloaded','updater:error']
      channels.forEach(ch => {
        ipcRenderer.on(ch, (_, data) => {
          // Forward as custom window event for UpdaterBanner
          window.dispatchEvent(new CustomEvent(`sealm:${ch}`, { detail: data }))
          cb(ch, data)
        })
      })
      return () => channels.forEach(ch => ipcRenderer.removeAllListeners(ch))
    },
  },

  // ── Dialog ────────────────────────────────────────────────────────────────
  dialog: {
    openFile:      (opts) => ipcRenderer.invoke('dialog:openFile', opts),
    openDirectory: ()     => ipcRenderer.invoke('dialog:openDirectory'),
  },

  // ── Achievements ──────────────────────────────────────────────────────────
  achievements: {
    list:    (data) => ipcRenderer.invoke('achievements:list', data),
    stats:   (data) => ipcRenderer.invoke('achievements:stats', data),
    trigger: (data) => ipcRenderer.invoke('achievements:trigger', data),
    onUnlocked: (cb) => {
      ipcRenderer.on('achievement:unlocked', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('achievement:unlocked')
    },
  },

  // ── Playtime ──────────────────────────────────────────────────────────────
  playtime: {
    track: (data) => ipcRenderer.invoke('playtime:track', data),
  },

  // ── Friends ───────────────────────────────────────────────────────────────
  friends: {
    list:        (data) => ipcRenderer.invoke('friends:list', data),
    pending:     (data) => ipcRenderer.invoke('friends:pending', data),
    request:     (data) => ipcRenderer.invoke('friends:request', data),
    accept:      (data) => ipcRenderer.invoke('friends:accept', data),
    remove:      (data) => ipcRenderer.invoke('friends:remove', data),
    searchUsers: (data) => ipcRenderer.invoke('friends:searchUsers', data),
    onRequest: (cb) => {
      ipcRenderer.on('friends:request', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('friends:request')
    },
  },

  // ── Language / Settings ───────────────────────────────────────────────────
  settings: {
    get:    ()     => ipcRenderer.invoke('settings:get'),
    set:    (data) => ipcRenderer.invoke('settings:set', data),
  },

  // ── App lifecycle ─────────────────────────────────────────────────────────────
  onBeforeQuit: (cb) => {
    ipcRenderer.on('app:before-quit', () => {
      window.dispatchEvent(new CustomEvent('sealm:before-quit'))
      cb()
    })
  },

  // ── Navigation (from tray/menu) ──────────────────────────────────────────
  onNavigate: (cb) => {
    ipcRenderer.on('navigate', (_, route) => cb(route))
    return () => ipcRenderer.removeAllListeners('navigate')
  },
})

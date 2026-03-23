// electron/torrent-preload.js
// Preload dla ukrytego okna WebTorrent
// Ma dostęp do Node.js (require) I do Electron IPC

const { ipcRenderer } = require('electron')

const DHT_BOOTSTRAP = [
  '87.98.162.88:6881',
  'dht.transmissionbt.com:6881',
  'dht.libtorrent.org:25401',
  'router.bittorrent.com:6881',
  'router.utorrent.com:6881',
]

const TRACKERS = [
  'udp://130.162.100.98:1337/announce',
  'udp://161.97.67.210:80/announce',
  'udp://207.241.226.186:6969/announce',
  'udp://207.241.224.124:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://acxx.de:6969/announce',
  'udp://black.tracker.group:6969/announce',
  'udp://bt1.archive.org:6969/announce',
  'udp://bt2.archive.org:6969/announce',
  'https://tracker.gbitt.info/announce',
  'https://opentracker.i2p.rocks/announce',
  'https://tracker.nanoha.org/announce',
  'http://tracker.bt4g.com:2095/announce',
  'http://open.acgnxtracker.com/announce',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.fastcast.nz',
]

function log(msg) {
  ipcRenderer.send('torrent-worker:log', String(msg))
}

const active = new Map()
let client = null

async function init() {
  try {
    log('Inicjalizacja WebTorrent w renderer...')
    const WebTorrent = require('webtorrent')
    log(`WebTorrent ${WebTorrent.VERSION} | WEBRTC: ${WebTorrent.WEBRTC_SUPPORT}`)

    client = new WebTorrent({
      maxConns: 500,
      uploadLimit: 0,
      dht: { bootstrap: DHT_BOOTSTRAP },
      utp: true,
      lsd: true,
    })

    client.on('error', e => log(`client error: ${e.message}`))

    // Czekaj na DHT ready (max 8s)
    await new Promise(resolve => {
      const t = setTimeout(resolve, 8000)
      if (client.dht) {
        client.dht.once('ready', () => { clearTimeout(t); resolve() })
      } else {
        clearTimeout(t); resolve()
      }
    })

    const nodes = client.dht?.toJSON?.()?.nodes?.length || 0
    log(`✅ Gotowy | DHT nodes: ${nodes} | WEBRTC: ${WebTorrent.WEBRTC_SUPPORT}`)
    ipcRenderer.send('torrent-worker:ready', { nodes, webrtc: WebTorrent.WEBRTC_SUPPORT })

  } catch(e) {
    log(`❌ init error: ${e.message}`)
    ipcRenderer.send('torrent-worker:error', e.message)
  }
}

// Odbierz komendy z main process
ipcRenderer.on('torrent:cmd', (_, cmd) => {
  try { handleCmd(cmd) }
  catch(e) { log(`cmd error: ${e.message}`) }
})

function handleCmd(cmd) {
  log(`CMD: ${cmd.type} | "${cmd.gameTitle || ''}"`)
  switch(cmd.type) {
    case 'add':    addTorrent(cmd);    break
    case 'pause':  active.get(cmd.downloadId)?.torrent?.pause();  break
    case 'resume': active.get(cmd.downloadId)?.torrent?.resume(); break
    case 'remove': removeTorrent(cmd); break
    case 'ping':   ipcRenderer.send('torrent-worker:pong'); break
  }
}

function addTorrent({ downloadId, magnetUri, savePath, gameTitle }) {
  if (!client) {
    ipcRenderer.send('torrent-worker:torrent_error', { downloadId, error: 'Klient nie gotowy' })
    return
  }

  log(`Dodaję: "${gameTitle}" → ${savePath}`)

  // Dodaj trackery do magnet URI
  let mag = magnetUri
  for (const tr of TRACKERS) {
    const enc = encodeURIComponent(tr)
    if (!mag.includes(enc)) mag += `&tr=${enc}`
  }

  try {
    const torrent = client.add(mag, { path: savePath, announce: TRACKERS })
    const entry = { torrent, _interval: null }
    active.set(downloadId, entry)

    ipcRenderer.send('torrent-worker:started', { downloadId, gameTitle })

    torrent.on('infoHash', () => {
      log(`InfoHash: ${torrent.infoHash}`)
      ipcRenderer.send('torrent-worker:infoHash', { downloadId, infoHash: torrent.infoHash })
    })

    torrent.on('metadata', () => {
      log(`📦 "${torrent.name}" | ${Math.round((torrent.length||0)/1024/1024)}MB | ${torrent.files?.length} plików`)
      ipcRenderer.send('torrent-worker:metadata', {
        downloadId, name: torrent.name, size: torrent.length, files: torrent.files?.length
      })
    })

    torrent.on('wire', wire => {
      log(`🔗 Peer: ${wire.remoteAddress} | łącznie: ${torrent.numPeers}`)
      ipcRenderer.send('torrent-worker:peer', {
        downloadId, address: wire.remoteAddress, totalPeers: torrent.numPeers
      })
    })

    torrent.on('warning', w => {
      const m = String(w?.message || w)
      if (!m.includes('timed out') && !m.includes('ENOTFOUND') && !m.includes('fetch failed') &&
          !m.includes('EAI_AGAIN') && !m.includes('Non-200') && !m.includes('ECONNREFUSED')) {
        log(`warning: ${m}`)
      }
    })

    entry._interval = setInterval(() => {
      if (!torrent.client) { clearInterval(entry._interval); return }
      const progress  = Math.round(torrent.progress * 1000) / 10
      const speedKbps = Math.round(torrent.downloadSpeed / 1024)
      const etaSec    = torrent.timeRemaining ? Math.round(torrent.timeRemaining / 1000) : null
      ipcRenderer.send('torrent-worker:progress', {
        downloadId, progress, speedKbps, etaSec, peers: torrent.numPeers
      })
    }, 2000)

    // Diagnostyka po 20s
    setTimeout(() => {
      if (!active.has(downloadId)) return
      const nodes = client.dht?.toJSON?.()?.nodes?.length || 0
      log(`[20s] peers=${torrent.numPeers} dht=${nodes} speed=${Math.round(torrent.downloadSpeed/1024)}KB/s`)
      if (torrent.numPeers === 0) {
        ipcRenderer.send('torrent-worker:warning', {
          downloadId,
          warning: `Brak peerów po 20s (DHT: ${nodes} nodes). Sprawdź czy ISP nie blokuje BitTorrent.`
        })
      }
    }, 20000)

    torrent.on('done', () => {
      clearInterval(entry._interval)
      log(`✅ Downloaded: "${torrent.name}"`)
      ipcRenderer.send('torrent-worker:done', { downloadId, savePath, gameTitle, name: torrent.name })
      torrent.destroy()
      active.delete(downloadId)
    })

    torrent.on('error', e => {
      clearInterval(entry._interval)
      log(`❌ ${e.message}`)
      ipcRenderer.send('torrent-worker:torrent_error', { downloadId, error: e.message })
      active.delete(downloadId)
    })

  } catch(e) {
    log(`add error: ${e.message}`)
    ipcRenderer.send('torrent-worker:torrent_error', { downloadId, error: e.message })
  }
}

function removeTorrent({ downloadId }) {
  const e = active.get(downloadId)
  if (e) { clearInterval(e._interval); e.torrent?.destroy(); active.delete(downloadId) }
  ipcRenderer.send('torrent-worker:removed', { downloadId })
}

// Start
init()

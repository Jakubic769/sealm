// electron/torrent-worker.mjs
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import { createServer } from 'net'
import { Resolver } from 'dns/promises'

const require = createRequire(import.meta.url)

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
function log(msg)  { send({ type: 'log', msg: String(msg) }) }

// ── Test DNS ──────────────────────────────────────────────────────────────────
async function testDns() {
  try {
    const resolver = new Resolver()
    resolver.setServers(['8.8.8.8', '1.1.1.1', '9.9.9.9'])
    const result = await resolver.resolve4('tracker.opentrackr.org')
    log(`DNS OK: tracker.opentrackr.org → ${result[0]}`)
    return true
  } catch(e) {
    log(`DNS błąd: ${e.message}`)
    return false
  }
}

// ── Trackery jako IP (obejście DNS) ───────────────────────────────────────────
// Część trackerów po IP żeby ominąć problemy DNS
const TRACKERS_IP = [
  // tracker.opentrackr.org = 130.162.100.98
  'udp://130.162.100.98:1337/announce',
  // open.stealth.si = 161.97.67.210
  'udp://161.97.67.210:80/announce',
  // exodus.desync.com = 198.251.87.145
  'udp://198.251.87.145:6969/announce',
  // bt1.archive.org
  'udp://207.241.226.186:6969/announce',
  // bt2.archive.org
  'udp://207.241.224.124:6969/announce',
  // p4p.arenabg.com = 109.201.134.183
  'udp://109.201.134.183:1337/announce',
]

const TRACKERS_DOMAIN = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker.army:6969/announce',
  'udp://acxx.de:6969/announce',
  'udp://black.tracker.group:6969/announce',
  'udp://uploads.gamecoast.net:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://bt1.archive.org:6969/announce',
  'udp://bt2.archive.org:6969/announce',
  'udp://tracker.birkenwald.de:6969/announce',
  'https://tracker.gbitt.info/announce',
  'https://tracker.nanoha.org/announce',
  'https://opentracker.i2p.rocks/announce',
  'https://1337.abcvg.info/announce',
  'http://tracker.bt4g.com:2095/announce',
  'http://open.acgnxtracker.com/announce',
  'http://tracker.electro-torrent.pl:80/announce',
]

// DHT bootstrap po IP (żeby ominąć DNS)
const DHT_BOOTSTRAP = [
  // router.bittorrent.com = 67.215.246.10
  '67.215.246.10:6881',
  // router.utorrent.com = 82.221.103.244
  '82.221.103.244:6881',
  // dht.transmissionbt.com = 87.98.162.88
  '87.98.162.88:6881',
  'router.bittorrent.com:6881',
  'router.utorrent.com:6881',
  'dht.transmissionbt.com:6881',
  'dht.aelitis.com:6881',
]

async function getFreePort() {
  return new Promise(res => {
    const s = createServer()
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) })
  })
}

let client = null

async function initClient() {
  log(`Node ${process.version} | ${process.platform}`)

  // Sprawdź DNS
  const dnsOk = await testDns()
  log(`DNS dostępny: ${dnsOk}`)

  try {
    const torrentPort = await getFreePort()
    const dhtPort     = await getFreePort()
    log(`Porty: torrent=${torrentPort} dht=${dhtPort}`)

    const { default: WebTorrent } = await import('webtorrent')

    client = new WebTorrent({
      maxConns:    500,
      uploadLimit: 0,
      torrentPort,
      dhtPort,
      dht:  { bootstrap: DHT_BOOTSTRAP },
      utp:  true,
      lsd:  true,
    })

    client.on('error', e => log(`client error: ${e.message}`))

    // Czekaj na DHT
    await new Promise(res => setTimeout(res, 3000))

    const nodes = client.dht?.toJSON?.()?.nodes?.length || 0
    log(`✅ WebTorrent gotowy | DHT nodes: ${nodes} | port: ${torrentPort}`)
    return true
  } catch(e) {
    log(`❌ init error: ${e.message}`)
    return false
  }
}

const ready = await initClient()
log('Worker uruchomiony')

// ── Komendy ───────────────────────────────────────────────────────────────────
const torrents = new Map()
let buf = ''

process.stdin.on('data', chunk => {
  buf += chunk.toString()
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try { handle(JSON.parse(line)) }
    catch(e) { log(`parse error: ${e.message}`) }
  }
})
process.stdin.on('end', () => { client?.destroy(); process.exit(0) })

function handle(cmd) {
  log(`CMD: ${cmd.type} | "${cmd.gameTitle}"`)
  switch(cmd.type) {
    case 'add':    addTorrent(cmd); break
    case 'pause':  torrents.get(cmd.downloadId)?.torrent?.pause(); break
    case 'resume': torrents.get(cmd.downloadId)?.torrent?.resume(); break
    case 'remove': removeTorrent(cmd); break
    case 'ping':   send({ type:'pong', ready }); break
  }
}

function addTorrent({ downloadId, magnetUri, savePath, gameTitle }) {
  if (!client) { send({ type:'torrent_error', downloadId, error:'WebTorrent nie uruchomiony' }); return }

  try { mkdirSync(savePath, { recursive: true }) } catch {}

  send({ type:'started', downloadId, gameTitle })
  log(`Start: "${gameTitle}" → ${savePath}`)

  // Użyj IP trackerów + domenowych
  const allTrackers = [...TRACKERS_IP, ...TRACKERS_DOMAIN]

  // Dodaj trackery do magnet URI
  let mag = magnetUri
  for (const tr of allTrackers) {
    const enc = encodeURIComponent(tr)
    if (!mag.includes(enc)) mag += `&tr=${enc}`
  }

  const torrent = client.add(mag, {
    path:     savePath,
    announce: allTrackers,
  })

  const entry = { torrent, savePath, gameTitle, _interval: null }
  torrents.set(downloadId, entry)

  torrent.on('infoHash', () => {
    log(`InfoHash: ${torrent.infoHash}`)
    send({ type:'infoHash', downloadId, infoHash: torrent.infoHash })
  })

  torrent.on('metadata', () => {
    log(`Metadata: "${torrent.name}" | ${Math.round((torrent.length||0)/1024/1024)}MB`)
    send({ type:'metadata', downloadId, name:torrent.name, size:torrent.length, files:torrent.files?.length })
  })

  torrent.on('wire', wire => {
    log(`Peer: ${wire.remoteAddress} | total: ${torrent.numPeers}`)
    send({ type:'peer', downloadId, address:wire.remoteAddress, totalPeers:torrent.numPeers })
  })

  // NIE loguj każdego warning żeby nie zaśmiecać
  torrent.on('warning', w => {
    const msg = String(w.message || w)
    // Loguj tylko ważne
    if (!msg.includes('timed out') && !msg.includes('ENOTFOUND') && !msg.includes('fetch failed')) {
      log(`warning: ${msg}`)
    }
  })

  entry._interval = setInterval(() => {
    if (!torrent.client) { clearInterval(entry._interval); return }
    const progress  = Math.round(torrent.progress * 1000) / 10
    const speedKbps = Math.round(torrent.downloadSpeed / 1024)
    const etaSec    = torrent.timeRemaining ? Math.round(torrent.timeRemaining / 1000) : null
    send({ type:'progress', downloadId, progress, speedKbps, etaSec, peers: torrent.numPeers })
  }, 2000)

  // Diagnostyka po 20s
  setTimeout(() => {
    if (!torrents.has(downloadId)) return
    const nodes = client.dht?.toJSON?.()?.nodes?.length || 0
    log(`[20s] peers=${torrent.numPeers} | dht=${nodes} | speed=${Math.round(torrent.downloadSpeed/1024)}KB/s`)
    if (torrent.numPeers === 0) {
      send({ type:'warning', downloadId,
        warning: `Brak peerów po 20s (DHT nodes: ${nodes}). Torrent prawdopodobnie martwy lub brak seedów.` })
    }
  }, 20000)

  torrent.on('done', () => {
    clearInterval(entry._interval)
    log(`✅ Done: "${torrent.name}"`)
    send({ type:'done', downloadId, savePath, gameTitle, name:torrent.name })
    torrent.destroy()
    torrents.delete(downloadId)
  })

  torrent.on('error', e => {
    clearInterval(entry._interval)
    log(`error: ${e.message}`)
    send({ type:'torrent_error', downloadId, error:e.message })
    torrents.delete(downloadId)
  })
}

function removeTorrent({ downloadId }) {
  const e = torrents.get(downloadId)
  if (e) {
    clearInterval(e._interval)
    e.torrent?.destroy()
    torrents.delete(downloadId)
  }
  send({ type:'removed', downloadId })
}

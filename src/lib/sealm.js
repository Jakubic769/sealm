/**
 * src/lib/sealm.js
 *
 * Bezpieczny dostęp do window.sealm (Electron IPC bridge).
 * Używaj zamiast window.sealm bezpośrednio — obsługuje timing
 * gdy Electron preload jeszcze nie wstrzyknął API.
 */

const TIMEOUT_MS = 6000

export function waitForSealm(timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (window.sealm) return resolve(window.sealm)
    const start = Date.now()
    const id = setInterval(() => {
      if (window.sealm) {
        clearInterval(id)
        resolve(window.sealm)
      } else if (Date.now() - start > timeout) {
        clearInterval(id)
        reject(new Error(
          'Cannot connect to app.\n' +
          'Make sure you are running via "npm run electron:dev", not the browser.'
        ))
      }
    }, 50)
  })
}

// Wersja synchroniczna — zwraca null jeśli niedostępne
export function getSealm() {
  return window.sealm || null
}

// Wersja z fallback — nie rzuca błędu, tylko loguje
export async function sealmCall(fn, fallback = null) {
  try {
    const sealm = await waitForSealm()
    return await fn(sealm)
  } catch (e) {
    console.warn('[sealm]', e.message)
    return fallback
  }
}

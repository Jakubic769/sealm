/**
 * src/hooks/useGameCover.js
 *
 * Hook do asynchronicznego ładowania okładek gier z IGDB.
 * - Cachuje URL-e w localStorage (unikamy zbędnych zapytań)
 * - Zwraca { coverUrl, loading, error }
 * - Fallback: gradient generowany z tytułu gry
 */

import { useState, useEffect } from 'react'

const CACHE_KEY = 'sealm_cover_cache'
const MAX_CACHE = 200

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveCache(cache) {
  try {
    // Keep only last MAX_CACHE entries
    const entries = Object.entries(cache)
    const trimmed = entries.length > MAX_CACHE
      ? Object.fromEntries(entries.slice(-MAX_CACHE))
      : cache
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed))
  } catch {}
}

const memoryCache = loadCache()

export function useGameCover(gameId, title, existingCoverUrl) {
  const [coverUrl, setCoverUrl] = useState(existingCoverUrl || null)
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    // Already have a URL from DB
    if (existingCoverUrl) { setCoverUrl(existingCoverUrl); return }
    if (!title || !window.sealm) return

    const cacheKey = `cover_${gameId || title}`

    // Memory cache hit
    if (memoryCache[cacheKey]) {
      setCoverUrl(memoryCache[cacheKey])
      return
    }

    // Fetch from IGDB via IPC
    setLoading(true)
    window.sealm.igdb.getCover({ title })
      .then(result => {
        if (result.success && result.url) {
          memoryCache[cacheKey] = result.url
          saveCache(memoryCache)
          setCoverUrl(result.url)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [gameId, title, existingCoverUrl])

  return { coverUrl, loading }
}

// ─── Sync hook: just returns cached or null (no fetch) ────────────────────────
export function useCachedCover(gameId, title) {
  const cacheKey = `cover_${gameId || title}`
  return memoryCache[cacheKey] || null
}

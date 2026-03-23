/**
 * src/components/ui/GameCover.js
 *
 * Komponent okładki gry:
 *  - Jeśli dostępny URL (IGDB) → wyświetla zdjęcie
 *  - Podczas ładowania → szkielet (skeleton loader)
 *  - Fallback → gradient z inicjałami tytułu
 */

import React, { useState } from 'react'
import { useGameCover } from '../../hooks/useGameCover'

// Generate deterministic gradient from game title
const PALETTES = [
  ['#1a0a2e','#3b1f5e','#c4b5fd'],
  ['#0d1b2a','#1e3a5f','#60a5fa'],
  ['#1a0a0a','#4a1818','#fca5a5'],
  ['#160a28','#3d1f6e','#d8b4fe'],
  ['#0a1a10','#1a5c2e','#6ee7b7'],
  ['#0a1628','#1e3a5f','#7dd3fc'],
  ['#1a1510','#503c14','#fde68a'],
  ['#1a0010','#4a0030','#f9a8d4'],
  ['#0a1020','#1a2040','#a5b4fc'],
  ['#101a0a','#2e5c1a','#86efac'],
]

function getPalette(title) {
  let hash = 0
  for (const c of (title || '')) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return PALETTES[Math.abs(hash) % PALETTES.length]
}

function getInitials(title) {
  return (title || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

export default function GameCover({
  gameId,
  title,
  existingCoverUrl,
  width,
  height,
  style = {},
  className = '',
  children,
  showInitials = true,
  fontSize = 22,
}) {
  const { coverUrl, loading } = useGameCover(gameId, title, existingCoverUrl)
  const [imgError, setImgError] = useState(false)
  const palette  = getPalette(title)
  const initials = getInitials(title)

  const baseStyle = {
    width:        width  || '100%',
    height:       height || '100%',
    borderRadius: 'inherit',
    overflow:     'hidden',
    position:     'relative',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
    ...style,
  }

  // Skeleton while fetching
  if (loading && !coverUrl) {
    return (
      <div className={`skeleton ${className}`} style={{ ...baseStyle, background: 'none' }}>
        {children}
      </div>
    )
  }

  // Image loaded successfully
  if (coverUrl && !imgError) {
    return (
      <div className={className} style={{ ...baseStyle, background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}>
        <img
          src={coverUrl}
          alt={title}
          onError={() => setImgError(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            position: 'absolute', inset: 0,
          }}
        />
        {children}
      </div>
    )
  }

  // Gradient fallback
  return (
    <div
      className={className}
      style={{
        ...baseStyle,
        background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
      }}
    >
      {showInitials && (
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize,
          fontWeight: 700,
          color: palette[2],
          letterSpacing: 2,
          userSelect: 'none',
        }}>
          {initials}
        </span>
      )}
      {children}
    </div>
  )
}

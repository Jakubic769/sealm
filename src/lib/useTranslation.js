// src/lib/useTranslation.js
import { useState, useEffect } from 'react'
import { t, getLanguage } from './i18n'

export function useTranslation() {
  const [lang, setLang] = useState(getLanguage())

  useEffect(() => {
    const handler = (e) => setLang(e.detail)
    window.addEventListener('sealm:language', handler)
    return () => window.removeEventListener('sealm:language', handler)
  }, [])

  return { t, lang }
}

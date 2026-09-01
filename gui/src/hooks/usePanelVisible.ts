import { useCallback, useState } from 'react'

/**
 * Visibilité d'un panneau latéral, mémorisée d'une session à l'autre.
 *
 * Même raison que pour la largeur (voir usePanelWidth) : c'est une préférence
 * d'affichage locale, elle n'a rien à faire dans le document partagé.
 */
export function usePanelVisible(key: string, fallback = true): [boolean, () => void] {
  const [visible, setVisible] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === '1'
    } catch {
      return fallback
    }
  })

  const toggle = useCallback(() => {
    setVisible((current) => {
      const next = !current
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // Stockage indisponible : l'état reste en mémoire pour la session.
      }
      return next
    })
  }, [key])

  return [visible, toggle]
}

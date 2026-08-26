import { useCallback, useState } from 'react'

/**
 * Largeur d'un panneau latéral, mémorisée d'une session à l'autre.
 *
 * localStorage plutôt que le serveur : c'est une préférence d'affichage locale,
 * elle n'a rien à faire dans le document partagé avec l'agent.
 */
export function usePanelWidth(key: string, fallback: number): [number, (width: number) => void, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key))
      return Number.isFinite(stored) && stored > 0 ? stored : fallback
    } catch {
      return fallback
    }
  })

  // L'écriture n'a lieu qu'à la fin du geste : un drag produit des dizaines de
  // valeurs intermédiaires qu'il serait inutile de persister.
  const commit = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(key, String(value))
      } catch {
        // Stockage indisponible (navigation privée) : la largeur reste en mémoire.
      }
    },
    [key]
  )

  return [width, setWidth, commit]
}

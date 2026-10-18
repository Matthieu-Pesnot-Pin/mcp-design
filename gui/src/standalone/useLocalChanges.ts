import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'

/**
 * Chargement initial de la version autonome. Personne d'autre n'écrit dans le
 * projet : il n'y a rien à interroger ensuite. Exporté sous le nom du hook du
 * serveur, qu'il remplace dans ce build.
 */
export function useServerChanges() {
  useEffect(() => {
    void useDesignStore.getState().refreshDesigns()
    void useRemarkStore.getState().refresh()
  }, [])
}

/** Recharge la GUI après une modification du projet faite hors de l'éditeur (import). */
export async function reloadFromProject(openId?: string) {
  const store = useDesignStore.getState()
  await store.refreshDesigns()
  await useRemarkStore.getState().refresh()
  const target = openId ?? store.design?.id
  if (!target) return
  if (useDesignStore.getState().designs.some((design) => design.id === target)) await store.openDesign(target)
  else useDesignStore.setState({ design: null, selectedIds: [] })
}

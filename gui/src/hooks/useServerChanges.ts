import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'

const TAG = '[mcp-design]'
const POLL_INTERVAL_MS = 3000

interface ServerEvent {
  type?: string
  data?: { designId?: string }
}

type ChangesResponse =
  | { epoch: string; seq: number; reset: true }
  | { epoch: string; seq: number; reset: false; events: ServerEvent[] }

/** Recharge tout ce que la GUI affiche : la position du client ne permet pas de savoir ce qui a changé. */
function reloadAll() {
  const store = useDesignStore.getState()
  void store.refreshDesigns()
  void useRemarkStore.getState().refresh()
  if (store.design) void store.reloadCurrent(store.design.id)
}

function applyEvent(event: ServerEvent) {
  const store = useDesignStore.getState()
  if (event.type === 'DESIGNS_UPDATED') {
    void store.refreshDesigns()
  } else if (event.type === 'DESIGN_UPDATED') {
    void store.refreshDesigns()
    if (event.data?.designId) void store.reloadCurrent(event.data.designId)
  } else if (event.type === 'REMARKS_UPDATED') {
    void useRemarkStore.getState().refresh()
  }
}

/**
 * Canal descendant serveur -> GUI : interroge `api/changes` toutes les 3 s.
 * Sert à deux choses : l'état initial au chargement, et le rafraîchissement
 * quand l'agent modifie un design pendant que l'utilisateur le regarde. Chaque
 * requête se termine aussitôt, la suivante part une fois la précédente finie.
 */
export function useServerChanges() {
  useEffect(() => {
    let position: { epoch: string; seq: number } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    async function poll() {
      try {
        const query = position ? `?since=${position.seq}&epoch=${encodeURIComponent(position.epoch)}` : ''
        const response = await fetch(`api/changes${query}`)
        if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`)
        const changes = (await response.json()) as ChangesResponse
        if (stopped) return

        if (changes.reset) reloadAll()
        else changes.events.forEach(applyEvent)
        position = { epoch: changes.epoch, seq: changes.seq }
      } catch (err) {
        console.error(`${TAG} Polling api/changes failed: ${(err as Error).message}`)
      }
      if (!stopped) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    void poll()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])
}

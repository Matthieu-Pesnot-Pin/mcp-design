import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'

const TAG = '[mcp-design]'

function readyStateLabel(state: number): string {
  if (state === EventSource.CONNECTING) return 'CONNECTING'
  if (state === EventSource.OPEN) return 'OPEN'
  if (state === EventSource.CLOSED) return 'CLOSED'
  return `UNKNOWN(${state})`
}

/**
 * Canal descendant serveur -> GUI. Sert à deux choses : l'état initial au
 * chargement, et le rafraîchissement quand l'agent modifie un design pendant
 * que l'utilisateur le regarde.
 */
export function useIPC() {
  useEffect(() => {
    const sseUrl = 'api/events'
    const eventSource = new EventSource(sseUrl)
    let lastDiagnosticsAt = 0

    eventSource.onopen = () => {
      useDesignStore.getState().setConnected(true)
      void useDesignStore.getState().refreshDesigns()
    }

    eventSource.onerror = () => {
      const state = eventSource.readyState
      const label = readyStateLabel(state)
      const hint =
        state === EventSource.CONNECTING
          ? 'Browser is reconnecting (server unreachable, proxy timeout, or network issue)'
          : state === EventSource.CLOSED
            ? 'Connection permanently closed (HTTP error, server stopped, or proxy reset)'
            : 'Stream was OPEN when error fired: transient glitch or browser quirk'

      console.error(`${TAG} SSE onerror — readyState=${label} (${state}). ${hint}`)
      useDesignStore.getState().setConnected(false)

      const now = Date.now()
      if (now - lastDiagnosticsAt < 8000) return
      lastDiagnosticsAt = now

      void fetch('api/client-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcp: 'mcp-design',
          kind: 'EventSource_error',
          sseUrl,
          readyState: state,
          readyStateLabel: label,
          hint,
          time: new Date().toISOString(),
        }),
      }).catch(() => {
        console.warn(`${TAG} Could not POST client-diagnostics (server probably down)`)
      })
    }

    eventSource.onmessage = (event) => {
      let message: { type?: string; data?: { designs?: unknown; designId?: string } }
      try {
        message = JSON.parse(event.data)
      } catch {
        return // ping / connected : messages non-JSON attendus
      }

      const store = useDesignStore.getState()
      if (message.type === 'INITIAL_STATE' || message.type === 'DESIGNS_UPDATED') {
        void store.refreshDesigns()
      } else if (message.type === 'DESIGN_UPDATED') {
        void store.refreshDesigns()
        if (message.data?.designId) void store.reloadCurrent(message.data.designId)
      }
    }

    return () => eventSource.close()
  }, [])
}

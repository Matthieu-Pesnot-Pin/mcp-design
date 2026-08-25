import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import type { Tool } from '../types'

const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'rect', o: 'ellipse', l: 'line', t: 'text' }

/** Un champ de saisie a toujours la priorité : les raccourcis d'outil ne doivent pas manger la frappe. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      const store = useDesignStore.getState()
      if (!store.design) return

      const modifier = event.ctrlKey || event.metaKey

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        store.duplicateSelected()
        return
      }
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        store.setSelection(store.design.nodes.map((node) => node.id))
        return
      }
      if (modifier) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.deleteSelected()
        return
      }
      if (event.key === 'Escape') {
        store.setSelection([])
        store.setTool('select')
        return
      }

      if (event.key.startsWith('Arrow') && store.selectedIds.length > 0) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0

        const selected = new Set(store.selectedIds)
        store.replaceNodes(
          store.design.nodes.map((node) => (selected.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node))
        )
        return
      }

      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool) store.setTool(tool)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

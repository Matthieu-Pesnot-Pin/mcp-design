import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'
import type { Tool } from '../types'

// « i » réarme l'outil icône avec la dernière icône choisie ; en choisir une
// autre passe par le sélecteur de la barre d'outils.
const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'rect', o: 'ellipse', l: 'line', t: 'text', i: 'icon' }

/** Un champ de saisie a toujours la priorité : les raccourcis d'outil ne doivent pas manger la frappe. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      // Barre espace maintenue : le canvas passe en déplacement de vue. Le
      // preventDefault empêche le défilement de page par défaut du navigateur.
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        useDesignStore.getState().setPanMode(true)
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        return
      }

      const remarks = useRemarkStore.getState()
      // La page des retours recouvre le canvas : seul Échap, qui la ferme, s'applique.
      if (remarks.roundsOpen) {
        if (event.key === 'Escape') remarks.setRoundsOpen(false)
        return
      }

      const store = useDesignStore.getState()
      if (!store.design) return

      const modifier = event.ctrlKey || event.metaKey

      if (!modifier && !event.altKey && event.key.toLowerCase() === 'm') {
        void remarks.setMode(remarks.mode === 'remarks' ? 'edit' : 'remarks')
        return
      }

      // En mode Remarques le design ne se modifie pas : aucun raccourci
      // d'édition ne s'applique. Échap ferme la remarque en cours, puis le mode.
      if (remarks.mode === 'remarks') {
        if (event.key !== 'Escape') return
        if (remarks.finishOpen) remarks.setFinishOpen(false)
        else if (remarks.composer) remarks.closeComposer()
        else void remarks.setMode('edit')
        return
      }

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
      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        if (event.shiftKey) store.ungroupSelected()
        else store.groupSelected()
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

        const startNodes = store.design.nodes.filter((node) => store.selectedIds.includes(node.id))
        store.moveSelection(dx, dy, startNodes)
        return
      }

      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool) store.setTool(tool)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') useDesignStore.getState().setPanMode(false)
    }
    // Un changement de fenêtre pendant que la barre espace est enfoncée ne doit
    // pas laisser le canvas bloqué en mode déplacement.
    const onBlur = () => useDesignStore.getState().setPanMode(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}

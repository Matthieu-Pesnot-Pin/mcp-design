import { create } from 'zustand'
import type { AreaHit } from '@shared/feedback'
import type { Box } from '@shared/tree'
import { api, type RemarkTargetInput } from '../utils/api'
import type { CanvasMode, FeedbackRound, Remark, RemarksState } from '../types'
import { useDesignStore } from './useDesignStore'

/** Remarque en cours de rédaction, avant son enregistrement. */
export type Composer =
  | { kind: 'page'; text: string }
  | { kind: 'node'; nodeId: string; text: string; capture: boolean }
  | { kind: 'area'; box: Box; hits: AreaHit[]; elementIds: string[]; text: string; capture: boolean }

const SHOW_SENT_KEY = 'mcp-design.remarks-show-sent'

function readShowSent(): boolean {
  try {
    return localStorage.getItem(SHOW_SENT_KEY) !== 'false'
  } catch {
    return true
  }
}

interface RemarkState {
  mode: CanvasMode
  remarks: Remark[]
  rounds: FeedbackRound[]
  /** Chemin du fichier des remarques, affiché à l'utilisateur. */
  file: string
  composer: Composer | null
  saving: boolean
  /** Remarque survolée dans le panneau : mise en évidence sur la planche. */
  hoveredId: string | null
  /** Remarque désignée sur la planche : mise en évidence dans le panneau. */
  focusedId: string | null
  /** Afficher les remarques déjà transmises, en plus des brouillons. */
  showSent: boolean
  finishOpen: boolean
  /** La page des retours est affichée à la place de l'espace de travail. */
  roundsOpen: boolean

  setMode: (mode: CanvasMode) => Promise<void>
  refresh: () => Promise<void>
  openPageComposer: () => void
  /** Vise un élément ; le texte déjà saisi est conservé. */
  openNodeComposer: (nodeId: string) => void
  /** Vise une zone ; le texte déjà saisi est conservé. */
  openAreaComposer: (box: Box, hits: AreaHit[]) => void
  setComposerText: (text: string) => void
  toggleComposerCapture: () => void
  toggleAreaElement: (id: string) => void
  closeComposer: () => void
  /** Ferme le compositeur seulement s'il n'y a rien à perdre. */
  closeComposerIfEmpty: () => void
  saveComposer: () => Promise<void>
  updateText: (id: string, text: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
  submit: (remarkIds: string[], title: string) => Promise<FeedbackRound | null>
  renameRound: (round: number, title: string) => Promise<void>
  setRemarkProcessed: (round: number, remarkId: string, processed: boolean) => Promise<void>
  /** Marque ou rouvre toutes les remarques d'un retour, ou de tous les retours avec null. */
  setRoundsProcessed: (round: number | null, processed: boolean) => Promise<void>
  setHovered: (id: string | null) => void
  setFocused: (id: string | null) => void
  setShowSent: (show: boolean) => void
  setFinishOpen: (open: boolean) => void
  setRoundsOpen: (open: boolean) => void
}

function fail(err: unknown) {
  useDesignStore.getState().setError((err as Error).message)
}

export const useRemarkStore = create<RemarkState>((set, get) => {
  function apply(state: RemarksState) {
    set({ remarks: state.remarks, rounds: state.rounds, file: state.file })
  }

  return {
    mode: 'edit',
    remarks: [],
    rounds: [],
    file: '',
    composer: null,
    saving: false,
    hoveredId: null,
    focusedId: null,
    showSent: readShowSent(),
    finishOpen: false,
    roundsOpen: false,

    setMode: async (mode) => {
      if (mode === get().mode) return
      const design = useDesignStore.getState()
      if (mode === 'remarks') {
        // Les captures sont rendues depuis le design enregistré : une
        // modification encore en attente doit d'abord partir.
        if (design.saveState === 'saving') await design.flushSave()
        design.setSelection([])
        design.setTool('select')
      }
      set({ mode, composer: null, hoveredId: null, focusedId: null })
    },

    refresh: async () => {
      try {
        apply(await api.listRemarks())
      } catch (err) {
        fail(err)
      }
    },

    openPageComposer: () => set({ composer: { kind: 'page', text: '' } }),

    openNodeComposer: (nodeId) => {
      const current = get().composer
      set({
        composer: {
          kind: 'node',
          nodeId,
          text: current?.text ?? '',
          capture: current && current.kind !== 'page' ? current.capture : true,
        },
      })
    },

    openAreaComposer: (box, hits) => {
      const current = get().composer
      set({
        composer: {
          kind: 'area',
          box,
          hits,
          // Un élément qui déborde de la zone n'est cité que si on le demande.
          elementIds: hits.filter((hit) => !hit.partial).map((hit) => hit.id),
          text: current?.text ?? '',
          capture: current && current.kind !== 'page' ? current.capture : true,
        },
      })
    },

    setComposerText: (text) => {
      const composer = get().composer
      if (composer) set({ composer: { ...composer, text } })
    },

    toggleComposerCapture: () => {
      const composer = get().composer
      if (composer && composer.kind !== 'page') set({ composer: { ...composer, capture: !composer.capture } })
    },

    toggleAreaElement: (id) => {
      const composer = get().composer
      if (composer?.kind !== 'area') return
      const elementIds = composer.elementIds.includes(id)
        ? composer.elementIds.filter((entry) => entry !== id)
        : [...composer.elementIds, id]
      set({ composer: { ...composer, elementIds } })
    },

    closeComposer: () => set({ composer: null }),

    closeComposerIfEmpty: () => {
      if (get().composer?.text.trim() === '') set({ composer: null })
    },

    saveComposer: async () => {
      const { composer, saving } = get()
      const design = useDesignStore.getState().design
      if (!composer || !design || saving || composer.text.trim() === '') return

      const target: RemarkTargetInput =
        composer.kind === 'page'
          ? { kind: 'page' }
          : composer.kind === 'node'
            ? { kind: 'node', nodeId: composer.nodeId }
            : {
                kind: 'area',
                box: composer.box,
                // L'ordre de la planche, pas celui des clics.
                elementIds: composer.hits.filter((hit) => composer.elementIds.includes(hit.id)).map((hit) => hit.id),
              }

      set({ saving: true })
      try {
        const result = await api.addRemark({
          designId: design.id,
          target,
          text: composer.text,
          capture: composer.kind !== 'page' && composer.capture,
        })
        apply(result)
        // Une autre remarque a pu être commencée pendant l'enregistrement : elle reste ouverte.
        set((state) => ({ composer: state.composer === composer ? null : state.composer, focusedId: result.remark.id }))
      } catch (err) {
        fail(err)
      } finally {
        set({ saving: false })
      }
    },

    updateText: async (id, text) => {
      try {
        apply(await api.updateRemark(id, text))
        return true
      } catch (err) {
        fail(err)
        return false
      }
    },

    remove: async (id) => {
      try {
        apply(await api.deleteRemark(id))
        set((state) => ({
          hoveredId: state.hoveredId === id ? null : state.hoveredId,
          focusedId: state.focusedId === id ? null : state.focusedId,
        }))
      } catch (err) {
        fail(err)
      }
    },

    submit: async (remarkIds, title) => {
      try {
        const result = await api.submitFeedback(remarkIds, title)
        apply(result)
        return result.round
      } catch (err) {
        fail(err)
        return null
      }
    },

    setHovered: (hoveredId) => set({ hoveredId }),
    setFocused: (focusedId) => set({ focusedId }),

    setShowSent: (showSent) => {
      try {
        localStorage.setItem(SHOW_SENT_KEY, String(showSent))
      } catch {
        // Stockage indisponible : le choix reste valable pour la session.
      }
      set({ showSent })
    },

    renameRound: async (round, title) => {
      try {
        apply(await api.renameRound(round, title))
      } catch (err) {
        fail(err)
      }
    },

    setRemarkProcessed: async (round, remarkId, processed) => {
      try {
        apply(await api.setRemarkProcessed(round, remarkId, processed))
      } catch (err) {
        fail(err)
      }
    },

    setRoundsProcessed: async (round, processed) => {
      try {
        apply(await api.setRoundsProcessed(round, processed))
      } catch (err) {
        fail(err)
      }
    },

    setFinishOpen: (finishOpen) => set({ finishOpen }),
    setRoundsOpen: (roundsOpen) => set({ roundsOpen, composer: null }),
  }
})

/** Brouillons d'un design, ou de tout le projet sans argument. */
export function draftsOf(remarks: Remark[], designId?: string): Remark[] {
  return remarks.filter((remark) => remark.status === 'draft' && (designId === undefined || remark.designId === designId))
}

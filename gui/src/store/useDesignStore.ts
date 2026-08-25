import { create } from 'zustand'
import type { NodeKind } from '@shared/node-defaults'
import { api } from '../utils/api'
import { createNode } from '../utils/nodes'
import type { Design, DesignNode, DesignSummary, SaveState, Tool } from '../types'

/** Ce qu'un undo restaure : le document, jamais la sélection ni l'outil courant. */
interface Snapshot {
  nodes: DesignNode[]
  name: string
  width: number
  height: number
  background: string
}

const HISTORY_LIMIT = 100
const SAVE_DEBOUNCE_MS = 400

interface DesignState {
  connected: boolean
  designs: DesignSummary[]
  design: Design | null
  loading: boolean
  error: string | null

  tool: Tool
  selectedIds: string[]
  editingTextId: string | null
  zoom: number
  saveState: SaveState

  past: Snapshot[]
  future: Snapshot[]

  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
  setTool: (tool: Tool) => void
  setZoom: (zoom: number) => void
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void
  setEditingText: (id: string | null) => void

  refreshDesigns: () => Promise<void>
  openDesign: (id: string) => Promise<void>
  createDesign: (input: { name: string; width?: number; height?: number }) => Promise<string | null>
  removeDesign: (id: string) => Promise<void>
  /** Recharge depuis le serveur après une modification faite par l'agent. */
  reloadCurrent: (designId: string) => Promise<void>

  addNode: (type: NodeKind, patch: Partial<DesignNode>) => string | null
  patchNodes: (ids: string[], patch: Partial<DesignNode>, options?: { history?: boolean }) => void
  replaceNodes: (nodes: DesignNode[], options?: { history?: boolean }) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  reorderSelected: (direction: 'front' | 'back' | 'forward' | 'backward') => void
  patchArtboard: (patch: Partial<Pick<Design, 'name' | 'width' | 'height' | 'background'>>) => void

  /** Ouvre une transaction d'historique avant un geste continu (drag, redimensionnement). */
  beginHistory: () => void
  undo: () => void
  redo: () => void
  flushSave: () => Promise<void>
}

function snapshotOf(design: Design): Snapshot {
  return {
    nodes: structuredClone(design.nodes),
    name: design.name,
    width: design.width,
    height: design.height,
    background: design.background,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedFlagTimer: ReturnType<typeof setTimeout> | null = null

export const useDesignStore = create<DesignState>((set, get) => {
  /**
   * Sauvegarde différée : un drag génère des dizaines de mutations, on n'envoie
   * que l'état final. Le serveur enregistre la modification comme venant de
   * l'utilisateur — c'est ce que l'agent relira via get_changes.
   */
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    set({ saveState: 'saving' })
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
  }

  async function persist() {
    const design = get().design
    if (!design) return
    try {
      const result = await api.saveDesign(design)
      // La révision vient du serveur ; les noeuds locaux font foi (l'utilisateur
      // a pu continuer à dessiner pendant la requête).
      set((state) => ({
        saveState: 'saved',
        designs: result.designs,
        design: state.design ? { ...state.design, revision: result.design.revision } : state.design,
      }))
      if (savedFlagTimer) clearTimeout(savedFlagTimer)
      savedFlagTimer = setTimeout(() => {
        if (get().saveState === 'saved') set({ saveState: 'idle' })
      }, 1500)
    } catch (err) {
      set({ saveState: 'error', error: (err as Error).message })
    }
  }

  /** Applique une mutation du document, empile l'historique et programme la sauvegarde. */
  function commit(mutate: (design: Design) => Design, options?: { history?: boolean }) {
    const state = get()
    if (!state.design) return

    const previous = snapshotOf(state.design)
    const next = mutate(state.design)

    set({
      design: next,
      past: options?.history === false ? state.past : [...state.past, previous].slice(-HISTORY_LIMIT),
      future: options?.history === false ? state.future : [],
    })
    scheduleSave()
  }

  function restore(snapshot: Snapshot, design: Design): Design {
    return {
      ...design,
      nodes: structuredClone(snapshot.nodes),
      name: snapshot.name,
      width: snapshot.width,
      height: snapshot.height,
      background: snapshot.background,
    }
  }

  return {
    connected: false,
    designs: [],
    design: null,
    loading: false,
    error: null,

    tool: 'select',
    selectedIds: [],
    editingTextId: null,
    zoom: 1,
    saveState: 'idle',

    past: [],
    future: [],

    setConnected: (connected) => set({ connected }),
    setError: (error) => set({ error }),
    setTool: (tool) => set({ tool, editingTextId: null }),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.1, zoom)) }),
    setSelection: (selectedIds) => set({ selectedIds, editingTextId: null }),
    toggleSelection: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((selected) => selected !== id)
          : [...state.selectedIds, id],
        editingTextId: null,
      })),
    setEditingText: (editingTextId) => set({ editingTextId }),

    refreshDesigns: async () => {
      try {
        set({ designs: await api.listDesigns() })
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    openDesign: async (id) => {
      set({ loading: true, error: null })
      try {
        const design = await api.getDesign(id)
        set({ design, loading: false, selectedIds: [], editingTextId: null, past: [], future: [] })
      } catch (err) {
        set({ loading: false, error: (err as Error).message })
      }
    },

    createDesign: async (input) => {
      try {
        const result = await api.createDesign(input)
        set({
          designs: result.designs,
          design: result.design,
          selectedIds: [],
          editingTextId: null,
          past: [],
          future: [],
        })
        return result.design.id
      } catch (err) {
        set({ error: (err as Error).message })
        return null
      }
    },

    removeDesign: async (id) => {
      try {
        const result = await api.deleteDesign(id)
        set((state) => ({
          designs: result.designs,
          design: state.design?.id === id ? null : state.design,
          selectedIds: state.design?.id === id ? [] : state.selectedIds,
        }))
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    reloadCurrent: async (designId) => {
      const state = get()
      if (state.design?.id !== designId) return
      // Une sauvegarde en vol écraserait ce que l'agent vient d'écrire.
      if (saveTimer || state.saveState === 'saving') return
      try {
        const design = await api.getDesign(designId)
        set((current) => ({
          design,
          selectedIds: current.selectedIds.filter((id) => design.nodes.some((node) => node.id === id)),
          editingTextId: null,
        }))
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    addNode: (type, patch) => {
      const design = get().design
      if (!design) return null

      const node = createNode(type, patch, design.nodes.length + 1)
      commit((current) => ({ ...current, nodes: [...current.nodes, node] }))
      set({ selectedIds: [node.id], tool: 'select' })
      return node.id
    },

    patchNodes: (ids, patch, options) => {
      if (ids.length === 0) return
      const targets = new Set(ids)
      commit(
        (design) => ({
          ...design,
          nodes: design.nodes.map((node) => (targets.has(node.id) ? { ...node, ...patch } : node)),
        }),
        options
      )
    },

    replaceNodes: (nodes, options) => {
      commit((design) => ({ ...design, nodes }), options)
    },

    deleteSelected: () => {
      const { selectedIds } = get()
      if (selectedIds.length === 0) return
      const targets = new Set(selectedIds)
      commit((design) => ({ ...design, nodes: design.nodes.filter((node) => !targets.has(node.id)) }))
      set({ selectedIds: [], editingTextId: null })
    },

    duplicateSelected: () => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      const targets = new Set(selectedIds)
      const copies = design.nodes
        .filter((node) => targets.has(node.id))
        .map((node, index) => {
          const { id: _id, type: _type, ...style } = node
          return createNode(
            node.type,
            { ...style, x: node.x + 20, y: node.y + 20, name: `${node.name} copie` },
            design.nodes.length + index + 1
          )
        })

      commit((current) => ({ ...current, nodes: [...current.nodes, ...copies] }))
      set({ selectedIds: copies.map((node) => node.id) })
    },

    reorderSelected: (direction) => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      const targets = new Set(selectedIds)
      const moving = design.nodes.filter((node) => targets.has(node.id))
      const rest = design.nodes.filter((node) => !targets.has(node.id))

      let nodes: DesignNode[]
      if (direction === 'front') {
        nodes = [...rest, ...moving]
      } else if (direction === 'back') {
        nodes = [...moving, ...rest]
      } else {
        // Décalage d'un cran : on déplace chaque noeud sélectionné individuellement.
        nodes = [...design.nodes]
        const step = direction === 'forward' ? 1 : -1
        const indexes = nodes
          .map((node, index) => ({ node, index }))
          .filter(({ node }) => targets.has(node.id))
          .map(({ index }) => index)
        const ordered = step === 1 ? indexes.reverse() : indexes

        for (const index of ordered) {
          const target = index + step
          if (target < 0 || target >= nodes.length || targets.has(nodes[target].id)) continue
          ;[nodes[index], nodes[target]] = [nodes[target], nodes[index]]
        }
      }

      commit((current) => ({ ...current, nodes }))
    },

    patchArtboard: (patch) => {
      commit((design) => ({ ...design, ...patch }))
    },

    beginHistory: () => {
      const design = get().design
      if (!design) return
      set((state) => ({ past: [...state.past, snapshotOf(design)].slice(-HISTORY_LIMIT), future: [] }))
    },

    undo: () => {
      const state = get()
      if (!state.design || state.past.length === 0) return

      const previous = state.past[state.past.length - 1]
      set({
        design: restore(previous, state.design),
        past: state.past.slice(0, -1),
        future: [...state.future, snapshotOf(state.design)],
        editingTextId: null,
      })
      scheduleSave()
    },

    redo: () => {
      const state = get()
      if (!state.design || state.future.length === 0) return

      const next = state.future[state.future.length - 1]
      set({
        design: restore(next, state.design),
        future: state.future.slice(0, -1),
        past: [...state.past, snapshotOf(state.design)],
        editingTextId: null,
      })
      scheduleSave()
    },

    flushSave: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      await persist()
    },
  }
})

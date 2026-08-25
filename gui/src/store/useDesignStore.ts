import { create } from 'zustand'
import type { NodeKind } from '@shared/node-defaults'
import {
  boundsOf,
  childrenByParent,
  computeLayout,
  descendantIds,
  flattenPreOrder,
  outermostAncestor,
  spaceOriginOf,
  unionBoundsOf,
  type Box,
  type Layout,
} from '@shared/tree'
import { api } from '../utils/api'
import { cloneSubtrees, createNode, newGroupId, withoutSelectedAncestors } from '../utils/nodes'
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
  /** Groupes dépliés dans le panneau des calques. */
  expandedIds: string[]
  zoom: number
  /** Décalage de la vue, en pixels écran, appliqué avant le zoom. */
  pan: { x: number; y: number }
  /** Barre espace maintenue : le clic-glisser déplace la vue au lieu des éléments. */
  panMode: boolean
  saveState: SaveState

  past: Snapshot[]
  future: Snapshot[]

  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
  setTool: (tool: Tool) => void
  setZoom: (zoom: number) => void
  setPan: (pan: { x: number; y: number }) => void
  /** Zoome en gardant fixe le point du document situé sous `screen`. */
  zoomAround: (zoom: number, screen: { x: number; y: number }) => void
  setPanMode: (panMode: boolean) => void
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void
  setEditingText: (id: string | null) => void
  toggleExpanded: (id: string) => void

  refreshDesigns: () => Promise<void>
  openDesign: (id: string) => Promise<void>
  createDesign: (input: { name: string; width?: number; height?: number }) => Promise<string | null>
  removeDesign: (id: string) => Promise<void>
  /** Recharge depuis le serveur après une modification faite par l'agent. */
  reloadCurrent: (designId: string) => Promise<void>

  addNode: (type: NodeKind, patch: Partial<Omit<DesignNode, 'id' | 'type'>>) => string | null
  patchNodes: (ids: string[], patch: Partial<DesignNode>, options?: { history?: boolean }) => void
  replaceNodes: (nodes: DesignNode[], options?: { history?: boolean }) => void
  moveSelection: (dx: number, dy: number, startNodes: DesignNode[], options?: { history?: boolean }) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  groupSelected: () => void
  ungroupSelected: () => void
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
      // La révision et la taille dérivée des groupes viennent du serveur ; les
      // noeuds locaux font foi (l'utilisateur a pu continuer pendant la requête).
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

  /**
   * Applique une mutation du document, empile l'historique et programme la
   * sauvegarde. La taille des groupes est recalculée localement pour que le
   * cadre de sélection suive le geste sans attendre l'aller-retour serveur.
   */
  function commit(mutate: (design: Design) => Design, options?: { history?: boolean }) {
    const state = get()
    if (!state.design) return

    const previous = snapshotOf(state.design)
    const mutated = mutate(state.design)
    const next = { ...mutated, nodes: refreshGroupSizes(flattenPreOrder(mutated.nodes)) }

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
    expandedIds: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    panMode: false,
    saveState: 'idle',

    past: [],
    future: [],

    setConnected: (connected) => set({ connected }),
    setError: (error) => set({ error }),
    setTool: (tool) => set({ tool, editingTextId: null }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    setPan: (pan) => set({ pan }),

    zoomAround: (zoom, screen) => {
      const state = get()
      const next = clampZoom(zoom)
      // Le point du document sous le curseur doit rester au même endroit :
      // pan' = curseur - point * zoom'. Purement arithmétique, donc insensible
      // à la mise en page (pas de dépendance à une barre de défilement).
      const point = { x: (screen.x - state.pan.x) / state.zoom, y: (screen.y - state.pan.y) / state.zoom }
      set({ zoom: next, pan: { x: screen.x - point.x * next, y: screen.y - point.y * next } })
    },

    setPanMode: (panMode) => set({ panMode }),
    setSelection: (selectedIds) => set({ selectedIds, editingTextId: null }),
    toggleSelection: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((selected) => selected !== id)
          : [...state.selectedIds, id],
        editingTextId: null,
      })),
    setEditingText: (editingTextId) => set({ editingTextId }),
    toggleExpanded: (id) =>
      set((state) => ({
        expandedIds: state.expandedIds.includes(id)
          ? state.expandedIds.filter((expanded) => expanded !== id)
          : [...state.expandedIds, id],
      })),

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
        set({
          design,
          loading: false,
          selectedIds: [],
          editingTextId: null,
          expandedIds: design.nodes.filter((node) => node.type === 'group').map((node) => node.id),
          past: [],
          future: [],
        })
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
          expandedIds: [],
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
          expandedIds: [
            ...new Set([
              ...current.expandedIds,
              ...design.nodes.filter((node) => node.type === 'group').map((node) => node.id),
            ]),
          ],
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

    moveSelection: (dx, dy, startNodes, options) => {
      const design = get().design
      if (!design) return

      // Un noeud dont le groupe est aussi sélectionné se déplacerait deux fois.
      const movable = new Set(withoutSelectedAncestors(design.nodes, startNodes.map((node) => node.id)))
      const origins = new Map(startNodes.map((node) => [node.id, { x: node.x, y: node.y }]))

      commit(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            if (!movable.has(node.id)) return node
            const origin = origins.get(node.id)
            return origin ? { ...node, x: origin.x + dx, y: origin.y + dy } : node
          }),
        }),
        options
      )
    },

    deleteSelected: () => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      // Supprimer un groupe emporte son contenu, comme côté serveur.
      const targets = new Set(selectedIds)
      for (const id of selectedIds) for (const descendant of descendantIds(design.nodes, id)) targets.add(descendant)

      commit((current) => ({ ...current, nodes: current.nodes.filter((node) => !targets.has(node.id)) }))
      set({ selectedIds: [], editingTextId: null })
    },

    duplicateSelected: () => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      const roots = withoutSelectedAncestors(design.nodes, selectedIds)
      const copies = cloneSubtrees(design.nodes, roots)
      const copiedRootIds = copies
        .filter((node) => node.parentId === null || !copies.some((other) => other.id === node.parentId))
        .map((node) => node.id)

      commit((current) => ({ ...current, nodes: [...current.nodes, ...copies] }))
      set({ selectedIds: copiedRootIds })
    },

    groupSelected: () => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      const memberIds = withoutSelectedAncestors(design.nodes, selectedIds)
      const parents = new Set(memberIds.map((id) => design.nodes.find((node) => node.id === id)?.parentId ?? null))
      if (parents.size > 1) {
        set({ error: 'Les éléments à grouper doivent appartenir au même groupe.' })
        return
      }

      const parentId = [...parents][0] ?? null
      const layout = computeLayout(design.nodes)
      const box = unionBoundsOf(layout, memberIds)
      if (!box) return

      const spaceOrigin = spaceOriginOf(layout, parentId)
      const groupId = newGroupId()
      const members = new Set(memberIds)
      const group: DesignNode = {
        id: groupId,
        type: 'group',
        name: `Groupe ${design.nodes.filter((node) => node.type === 'group').length + 1}`,
        parentId,
        x: box.x - spaceOrigin.x,
        y: box.y - spaceOrigin.y,
        width: box.width,
        height: box.height,
        rotation: 0,
        opacity: 1,
      }

      commit((current) => {
        // Les coordonnées deviennent relatives au groupe : rien ne bouge à l'écran.
        const rebased = current.nodes.map((node) =>
          members.has(node.id)
            ? { ...node, parentId: groupId, x: node.x - group.x, y: node.y - group.y }
            : node
        )
        const lastMember = rebased.filter((node) => members.has(node.id)).at(-1)!
        const result: DesignNode[] = []
        for (const node of rebased) {
          if (!members.has(node.id)) result.push(node)
          else if (node.id === lastMember.id) result.push(group, ...rebased.filter((n) => members.has(n.id)))
        }
        return { ...current, nodes: result }
      })

      set((state) => ({ selectedIds: [groupId], expandedIds: [...state.expandedIds, groupId] }))
    },

    ungroupSelected: () => {
      const { design, selectedIds } = get()
      if (!design) return

      const dissolved = new Set(
        design.nodes.filter((node) => selectedIds.includes(node.id) && node.type === 'group').map((node) => node.id)
      )
      if (dissolved.size === 0) return

      const promoted: string[] = []
      commit((current) => {
        const byId = new Map(current.nodes.map((node) => [node.id, node]))
        // Remonte jusqu'au premier groupe conservé en cumulant les offsets.
        const surviving = (parentId: string | null) => {
          let dx = 0
          let dy = 0
          let cursor = parentId
          while (cursor !== null && dissolved.has(cursor)) {
            const group = byId.get(cursor)!
            dx += group.x
            dy += group.y
            cursor = group.parentId
          }
          return { parentId: cursor, dx, dy }
        }

        const nodes: DesignNode[] = []
        for (const node of current.nodes) {
          if (dissolved.has(node.id)) continue
          const target = surviving(node.parentId)
          if (target.parentId === node.parentId) {
            nodes.push(node)
            continue
          }
          promoted.push(node.id)
          nodes.push({ ...node, parentId: target.parentId, x: node.x + target.dx, y: node.y + target.dy })
        }
        return { ...current, nodes }
      })

      set({ selectedIds: promoted })
    },

    reorderSelected: (direction) => {
      const { design, selectedIds } = get()
      if (!design || selectedIds.length === 0) return

      const targets = new Set(withoutSelectedAncestors(design.nodes, selectedIds))
      const children = childrenByParent(design.nodes)

      // Le réordonnancement se fait entre frères : l'ordre global est ensuite
      // reconstruit en parcours préfixe, comme le fait le serveur.
      const reordered = new Map<string, DesignNode[]>()
      for (const [parentId, siblings] of children) {
        const moving = siblings.filter((node) => targets.has(node.id))
        if (moving.length === 0) continue

        let next = [...siblings]
        if (direction === 'front') {
          next = [...next.filter((node) => !targets.has(node.id)), ...moving]
        } else if (direction === 'back') {
          next = [...moving, ...next.filter((node) => !targets.has(node.id))]
        } else {
          const step = direction === 'forward' ? 1 : -1
          const indexes = next
            .map((node, index) => (targets.has(node.id) ? index : -1))
            .filter((index) => index >= 0)
          for (const index of step === 1 ? indexes.reverse() : indexes) {
            const swap = index + step
            if (swap < 0 || swap >= next.length || targets.has(next[swap].id)) continue
            ;[next[index], next[swap]] = [next[swap], next[index]]
          }
        }
        reordered.set(parentId ?? '', next)
      }

      commit((current) => {
        const merged = childrenByParent(current.nodes)
        for (const [key, siblings] of reordered) merged.set(key === '' ? null : key, siblings)

        const flat: DesignNode[] = []
        const visit = (parentId: string | null) => {
          for (const node of merged.get(parentId) ?? []) {
            flat.push(node)
            if (node.type === 'group') visit(node.id)
          }
        }
        visit(null)
        return { ...current, nodes: flat }
      })
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

const clampZoom = (zoom: number) => Math.min(8, Math.max(0.05, zoom))

/** La taille d'un groupe suit son contenu — recalculée à chaque mutation, comme côté serveur. */
function refreshGroupSizes(nodes: DesignNode[]): DesignNode[] {
  if (!nodes.some((node) => node.type === 'group')) return nodes
  const layout = computeLayout(nodes)
  return nodes.map((node) => {
    if (node.type !== 'group') return node
    const box = boundsOf(layout, node.id)
    return node.width === box.width && node.height === box.height ? node : { ...node, ...{ width: box.width, height: box.height } }
  })
}

/** Sélecteurs dérivés, calculés une fois par rendu du canvas. */
export function selectLayout(design: Design | null): Layout {
  return computeLayout(design?.nodes ?? [])
}

export function selectionBox(layout: Layout, ids: string[]): Box | null {
  return unionBoundsOf(layout, ids)
}

/** Ce que sélectionne un clic dans le canvas : le groupe le plus haut, ou l'élément lui-même. */
export function clickTarget(nodes: DesignNode[], id: string, deep: boolean): string {
  if (deep) return id
  return outermostAncestor(nodes, id)?.id ?? id
}

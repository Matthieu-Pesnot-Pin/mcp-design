import type { RenderNode } from '@shared/render'

/** Le noeud manipulé par le canvas est exactement celui que rend l'exporteur. */
export type DesignNode = RenderNode

export interface Design {
  id: string
  name: string
  /** Groupe de pages, chemin "Parent/Enfant", ou null à la racine. */
  group: string | null
  width: number
  height: number
  background: string
  nodes: DesignNode[]
  createdAt: string
  updatedAt: string
  revision: number
  lastEditor: 'agent' | 'user'
}

export interface DesignSummary {
  id: string
  name: string
  /** Groupe de pages, chemin "Parent/Enfant", ou null à la racine. */
  group: string | null
  width: number
  height: number
  nodeCount: number
  updatedAt: string
  revision: number
  lastEditor: 'agent' | 'user'
  /** Modifications pas encore récupérées par l'agent via mark_synced. */
  pendingChanges: number
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'text'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

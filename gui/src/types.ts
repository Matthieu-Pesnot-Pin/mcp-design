import type { RenderNode } from '@shared/render'
import type { FeedbackRound, Remark, RoundRemark } from '@shared/feedback'

export type { FeedbackRound, Remark, RoundRemark }

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

export type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'text' | 'icon'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Édition du design, ou rédaction de remarques pour l'agent. */
export type CanvasMode = 'edit' | 'remarks'

/** Remarques et retours, tels que le serveur les renvoie après chaque action. */
export interface RemarksState {
  remarks: Remark[]
  rounds: FeedbackRound[]
  /** Chemin du fichier des remarques, dans le dossier de données du projet. */
  file: string
}

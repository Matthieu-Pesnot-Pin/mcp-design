import { NODE_DEFAULTS, clampNodeSize, defaultNodeName, type NodeKind } from '@shared/node-defaults'
import { ancestorsOf, descendantIds, type Box } from '@shared/tree'
import type { DesignNode } from '../types'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(): string {
  let out = ''
  for (const byte of crypto.getRandomValues(new Uint8Array(8))) out += ALPHABET[byte % ALPHABET.length]
  return out
}

/** Même forme d'identifiant que côté serveur : rien ne distingue une forme dessinée d'une forme générée. */
export function newNodeId(): string {
  return `n_${randomSuffix()}`
}

export function newGroupId(): string {
  return `g_${randomSuffix()}`
}

/**
 * `patch` exclut volontairement `id` et `type` : un appelant qui recopie un
 * noeud existant (duplication) réintroduirait sinon son identifiant, et deux
 * noeuds partageant un id cassent aussi bien le rendu que le diff côté agent.
 */
export function createNode(type: NodeKind, patch: Partial<Omit<DesignNode, 'id' | 'type'>>, index: number): DesignNode {
  const base = {
    id: newNodeId(),
    type,
    name: defaultNodeName(type, index),
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    ...NODE_DEFAULTS[type],
    ...patch,
  } as DesignNode

  const size = clampNodeSize(type, base.width, base.height)
  return { ...base, width: size.width, height: size.height }
}

/**
 * Copie un ensemble de noeuds avec tout leur contenu, en réattribuant les
 * identifiants et en recâblant les liens parent/enfant sur les copies.
 */
export function cloneSubtrees(nodes: DesignNode[], rootIds: string[]): DesignNode[] {
  const included = new Set(rootIds)
  for (const id of rootIds) for (const descendant of descendantIds(nodes, id)) included.add(descendant)

  const source = nodes.filter((node) => included.has(node.id))
  const idMap = new Map(source.map((node) => [node.id, node.type === 'group' ? newGroupId() : newNodeId()]))
  const roots = new Set(rootIds)

  return source.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    parentId: node.parentId !== null ? (idMap.get(node.parentId) ?? node.parentId) : null,
    // Seuls les noeuds copiés au premier niveau sont décalés : les descendants
    // sont exprimés dans l'espace de leur parent et suivent donc tout seuls.
    x: node.x + (roots.has(node.id) ? 20 : 0),
    y: node.y + (roots.has(node.id) ? 20 : 0),
  }))
}

/** Retire les noeuds dont un ancêtre est déjà sélectionné, pour ne pas les déplacer deux fois. */
export function withoutSelectedAncestors(nodes: DesignNode[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds)
  return selectedIds.filter((id) => !ancestorsOf(nodes, id).some((ancestor) => selected.has(ancestor.id)))
}

export function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}

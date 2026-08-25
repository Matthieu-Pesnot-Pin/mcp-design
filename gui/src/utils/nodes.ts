import { NODE_DEFAULTS, clampNodeSize, defaultNodeName, type NodeKind } from '@shared/node-defaults'
import { normalizedBox } from '@shared/render'
import type { DesignNode } from '../types'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Même forme d'identifiant que côté serveur, pour que rien ne distingue une forme dessinée d'une forme générée. */
export function newNodeId(): string {
  let out = ''
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return `n_${out}`
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

/** Boîte englobante commune à plusieurs noeuds — sert au cadre de sélection multiple. */
export function boundingBox(nodes: DesignNode[]): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    const box = normalizedBox(node)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}

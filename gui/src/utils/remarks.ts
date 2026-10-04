import type { Remark } from '@shared/feedback'
import { instanceRootOf } from '@shared/instances'
import { ancestorsOf, type Box, type Layout } from '@shared/tree'
import { clickTarget, drillTarget } from '../store/useDesignStore'
import type { DesignNode } from '../types'

/**
 * Élément visé par un clic en mode Remarques, sur les noeuds expansés du canvas.
 *
 * Mêmes règles qu'en édition : le groupe le plus haut, l'élément exact avec
 * Alt. Un clic à l'intérieur de l'élément déjà visé descend d'un niveau, comme
 * le double-clic de l'édition.
 */
export function remarkTargetOf(nodes: DesignNode[], rawId: string, alt: boolean, currentId: string | null): string {
  if (alt) return instanceRootOf(rawId)
  const chain = [rawId, ...ancestorsOf(nodes, rawId).map((node) => node.id)]
  const id =
    currentId !== null && chain.includes(currentId)
      ? drillTarget(nodes, rawId, [currentId])
      : clickTarget(nodes, rawId, [], false)
  return instanceRootOf(id)
}

/** Boîte courante de ce que vise une remarque ; `missing` si l'élément a disparu. */
export function remarkBox(remark: Remark, layout: Layout): { box: Box; missing: boolean } | null {
  const target = remark.target
  if (target.kind === 'page') return null
  if (target.kind === 'area') return { box: target.box, missing: false }
  const current = layout.bounds.get(target.element.id)
  return current ? { box: current, missing: false } : { box: target.box, missing: true }
}

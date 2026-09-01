import { nodeKindLabel } from '@shared/node-defaults'
import { childrenByParent } from '@shared/tree'
import { useDesignStore } from '../store/useDesignStore'
import type { DesignNode } from '../types'

/**
 * Arbre des calques, du premier plan vers l'arrière-plan (inverse de l'ordre de
 * rendu) : c'est l'ordre auquel on s'attend en regardant la planche de face.
 */
export function LayerPanel() {
  const design = useDesignStore((state) => state.design)
  const selectedIds = useDesignStore((state) => state.selectedIds)
  const expandedIds = useDesignStore((state) => state.expandedIds)
  const setSelection = useDesignStore((state) => state.setSelection)
  const toggleSelection = useDesignStore((state) => state.toggleSelection)
  const toggleExpanded = useDesignStore((state) => state.toggleExpanded)
  const reorderSelected = useDesignStore((state) => state.reorderSelected)
  const groupSelected = useDesignStore((state) => state.groupSelected)
  const ungroupSelected = useDesignStore((state) => state.ungroupSelected)

  if (!design) return null

  const children = childrenByParent(design.nodes)
  const hasGroupSelected = design.nodes.some((node) => selectedIds.includes(node.id) && node.type === 'group')
  const byId = new Map(design.nodes.map((node) => [node.id, node]))

  const renderLevel = (parentId: string | null, depth: number): React.ReactNode[] =>
    [...(children.get(parentId) ?? [])].reverse().flatMap((node: DesignNode) => {
      const isGroup = node.type === 'group'
      const expanded = expandedIds.includes(node.id)
      const count = children.get(node.id)?.length ?? 0

      const row = (
        <li key={node.id}>
          <div className="layer-row" style={{ paddingLeft: depth * 14 }}>
            {isGroup ? (
              <button
                type="button"
                className="layer-twisty"
                aria-label={expanded ? 'Replier le groupe' : 'Déplier le groupe'}
                onClick={() => toggleExpanded(node.id)}
              >
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="layer-twisty" />
            )}
            <button
              type="button"
              className="layer-item"
              data-active={selectedIds.includes(node.id) || undefined}
              data-group={isGroup || undefined}
              onClick={(event) => (event.shiftKey ? toggleSelection(node.id) : setSelection([node.id]))}
            >
              <span className="layer-kind">{nodeKindLabel(node.type)}</span>
              <span className="layer-name">{node.name}</span>
              {isGroup && <span className="layer-count">{count}</span>}
              {/* Une instance n'a pas de contenu propre : ce qu'elle reproduit
                  est la seule chose utile à lire sur sa ligne. */}
              {node.type === 'instance' && (
                <span className="layer-count" title="Instance liée à ce groupe">
                  ◇ {byId.get(node.componentId ?? '')?.name ?? '?'}
                </span>
              )}
            </button>
          </div>
        </li>
      )

      return isGroup && expanded ? [row, ...renderLevel(node.id, depth + 1)] : [row]
    })

  return (
    <section className="layers">
      <div className="layers-header">
        <h2>Calques</h2>
        <div className="layers-actions">
          <button
            type="button"
            className="icon-button"
            title="Grouper la sélection (Ctrl+G)"
            disabled={selectedIds.length === 0}
            onClick={groupSelected}
          >
            ⧉
          </button>
          <button
            type="button"
            className="icon-button"
            title="Dissoudre le groupe (Ctrl+Maj+G)"
            disabled={!hasGroupSelected}
            onClick={ungroupSelected}
          >
            ⧅
          </button>
          <button
            type="button"
            className="icon-button"
            title="Monter d'un cran"
            disabled={selectedIds.length === 0}
            onClick={() => reorderSelected('forward')}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            title="Descendre d'un cran"
            disabled={selectedIds.length === 0}
            onClick={() => reorderSelected('backward')}
          >
            ↓
          </button>
        </div>
      </div>

      <ul>{renderLevel(null, 0)}</ul>

      {design.nodes.length === 0 && <p className="empty-hint">Aucun élément sur cette planche.</p>}
    </section>
  )
}

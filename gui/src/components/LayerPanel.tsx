import { nodeKindLabel } from '@shared/node-defaults'
import { useDesignStore } from '../store/useDesignStore'

/** Liste des calques, du premier plan vers l'arrière-plan (inverse de l'ordre de rendu). */
export function LayerPanel() {
  const design = useDesignStore((state) => state.design)
  const selectedIds = useDesignStore((state) => state.selectedIds)
  const setSelection = useDesignStore((state) => state.setSelection)
  const toggleSelection = useDesignStore((state) => state.toggleSelection)
  const reorderSelected = useDesignStore((state) => state.reorderSelected)

  if (!design) return null

  return (
    <section className="layers">
      <div className="layers-header">
        <h2>Calques</h2>
        <div className="layers-actions">
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

      <ul>
        {[...design.nodes].reverse().map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="layer-item"
              data-active={selectedIds.includes(node.id) || undefined}
              onClick={(event) => (event.shiftKey ? toggleSelection(node.id) : setSelection([node.id]))}
            >
              <span className="layer-kind">{nodeKindLabel(node.type)}</span>
              <span className="layer-name">{node.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {design.nodes.length === 0 && <p className="empty-hint">Aucun élément sur cette planche.</p>}
    </section>
  )
}

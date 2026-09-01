import { useDesignStore } from '../store/useDesignStore'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]

export function Toolbar({
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
}: {
  leftVisible: boolean
  rightVisible: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const zoom = useDesignStore((state) => state.zoom)
  const setZoom = useDesignStore((state) => state.setZoom)
  const undo = useDesignStore((state) => state.undo)
  const redo = useDesignStore((state) => state.redo)
  const canUndo = useDesignStore((state) => state.past.length > 0)
  const canRedo = useDesignStore((state) => state.future.length > 0)
  const saveState = useDesignStore((state) => state.saveState)
  const connected = useDesignStore((state) => state.connected)
  const design = useDesignStore((state) => state.design)

  const saveLabel = {
    idle: 'À jour',
    saving: 'Enregistrement…',
    saved: 'Enregistré',
    error: 'Échec de la sauvegarde',
  }[saveState]

  return (
    <header className="toolbar">
      {/* Les outils de dessin vivent dans la palette flottante (ToolPalette) :
          la barre du haut ne garde que ce qui sert à chaque session. */}
      <div className="tool-row">
        <button
          type="button"
          className="tool-button"
          data-active={leftVisible || undefined}
          onClick={onToggleLeft}
          title={leftVisible ? 'Masquer la liste des pages' : 'Afficher la liste des pages'}
          aria-label={leftVisible ? 'Masquer la liste des pages' : 'Afficher la liste des pages'}
          aria-pressed={leftVisible}
        >
          <span className="tool-glyph">◧</span>
        </button>
        <button
          type="button"
          className="tool-button"
          data-active={rightVisible || undefined}
          onClick={onToggleRight}
          title={rightVisible ? 'Masquer le panneau de propriétés' : 'Afficher le panneau de propriétés'}
          aria-label={rightVisible ? 'Masquer le panneau de propriétés' : 'Afficher le panneau de propriétés'}
          aria-pressed={rightVisible}
        >
          <span className="tool-glyph">◨</span>
        </button>
      </div>

      <div className="tool-row">
        <button
          type="button"
          className="tool-button"
          onClick={undo}
          disabled={!canUndo}
          title="Annuler (Ctrl+Z)"
          aria-label="Annuler (Ctrl+Z)"
        >
          <span className="tool-glyph">↶</span>
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={redo}
          disabled={!canRedo}
          title="Rétablir (Ctrl+Y)"
          aria-label="Rétablir (Ctrl+Y)"
        >
          <span className="tool-glyph">↷</span>
        </button>
      </div>

      <label className="zoom-control">
        Zoom
        <select value={ZOOM_STEPS.includes(zoom) ? zoom : ''} onChange={(event) => setZoom(Number(event.target.value))}>
          {!ZOOM_STEPS.includes(zoom) && <option value="">{Math.round(zoom * 100)} %</option>}
          {ZOOM_STEPS.map((step) => (
            <option key={step} value={step}>
              {Math.round(step * 100)} %
            </option>
          ))}
        </select>
      </label>

      <div className="toolbar-status">
        {design && <span className="status-name">{design.name}</span>}
        <span className="status-chip" data-state={saveState}>
          {saveLabel}
        </span>
        <span className="status-chip" data-state={connected ? 'saved' : 'error'}>
          {connected ? 'Connecté' : 'Déconnecté'}
        </span>
      </div>
    </header>
  )
}

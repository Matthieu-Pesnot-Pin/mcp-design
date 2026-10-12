import { useDesignStore } from '../store/useDesignStore'
import { roundProgress } from '@shared/feedback'
import { draftsOf, useRemarkStore } from '../store/useRemarkStore'
import { Icon } from './Icon'

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
  const design = useDesignStore((state) => state.design)
  const mode = useRemarkStore((state) => state.mode)
  const setMode = useRemarkStore((state) => state.setMode)
  const drafts = useRemarkStore((state) => (design ? draftsOf(state.remarks, design.id).length : 0))
  const remarking = mode === 'remarks'
  const openRounds = useRemarkStore(
    (state) => state.rounds.filter((round) => roundProgress(round).status !== 'done').length
  )
  const setRoundsOpen = useRemarkStore((state) => state.setRoundsOpen)

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
          disabled={!canUndo || remarking}
          title="Annuler (Ctrl+Z)"
          aria-label="Annuler (Ctrl+Z)"
        >
          <span className="tool-glyph">↶</span>
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={redo}
          disabled={!canRedo || remarking}
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

      <div className="mode-switch" role="group" aria-label="Mode du canvas">
        <button
          type="button"
          data-active={!remarking || undefined}
          disabled={!design}
          onClick={() => void setMode('edit')}
          title="Éditer le design (M)"
        >
          <Icon name="pen-tool" />
          Édition
        </button>
        <button
          type="button"
          data-active={remarking || undefined}
          data-mode="remarks"
          disabled={!design}
          onClick={() => void setMode('remarks')}
          title="Rédiger des remarques pour l'agent (M)"
        >
          <Icon name="message-square" />
          Remarques
          {drafts > 0 && <span className="mode-count">{drafts}</span>}
        </button>
      </div>

      <button
        type="button"
        className="rounds-button"
        onClick={() => setRoundsOpen(true)}
        title="Retours transmis à l'agent et leur traitement"
      >
        <Icon name="list-checks" />
        Retours
        {openRounds > 0 && <span className="rounds-count">{openRounds}</span>}
      </button>

      <div className="toolbar-status">
        {design && <span className="status-name">{design.name}</span>}
        <span className="status-chip" data-state={saveState}>
          {saveLabel}
        </span>
      </div>
    </header>
  )
}

import { useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { IconPicker } from './IconPicker'
import type { Tool } from '../types'

const TOOLS: Array<{ id: Tool; label: string; shortcut: string; glyph: string }> = [
  { id: 'select', label: 'Sélection', shortcut: 'V', glyph: '↖' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', glyph: '◯' },
  { id: 'line', label: 'Ligne', shortcut: 'L', glyph: '╱' },
  { id: 'text', label: 'Texte', shortcut: 'T', glyph: 'T' },
]

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]

export function Toolbar() {
  const tool = useDesignStore((state) => state.tool)
  const setTool = useDesignStore((state) => state.setTool)
  const pendingIcon = useDesignStore((state) => state.pendingIcon)
  const setPendingIcon = useDesignStore((state) => state.setPendingIcon)
  const [pickerOpen, setPickerOpen] = useState(false)
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
      <div className="tool-group">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tool-button"
            data-active={tool === entry.id || undefined}
            title={`${entry.label} (${entry.shortcut})`}
            onClick={() => setTool(entry.id)}
          >
            <span className="tool-glyph">{entry.glyph}</span>
            <span className="tool-label">{entry.label}</span>
          </button>
        ))}

        {/* L'outil icône ouvre d'abord le sélecteur : poser une icône suppose
            d'avoir choisi laquelle, contrairement à un rectangle. */}
        <div className="tool-popover-anchor">
          <button
            type="button"
            className="tool-button"
            data-active={tool === 'icon' || undefined}
            title={`Icône — ${pendingIcon} (I)`}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <span className="tool-glyph">☆</span>
            <span className="tool-label">Icône</span>
          </button>
          {pickerOpen && (
            <IconPicker
              current={pendingIcon}
              onPick={(name) => {
                setPendingIcon(name)
                setPickerOpen(false)
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="tool-group">
        <button type="button" className="tool-button" onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
          ↶
        </button>
        <button type="button" className="tool-button" onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Y)">
          ↷
        </button>
      </div>

      <div className="tool-group">
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
      </div>

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

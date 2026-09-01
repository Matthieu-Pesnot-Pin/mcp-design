import { useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { usePanelVisible } from '../hooks/usePanelVisible'
import { IconPicker } from './IconPicker'
import type { Tool } from '../types'

const TOOLS: Array<{ id: Tool; label: string; shortcut: string; glyph: string }> = [
  { id: 'select', label: 'Sélection', shortcut: 'V', glyph: '↖' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', glyph: '◯' },
  { id: 'line', label: 'Ligne', shortcut: 'L', glyph: '╱' },
  { id: 'text', label: 'Texte', shortcut: 'T', glyph: 'T' },
]

const ICON_TOOL = { id: 'icon' as Tool, label: 'Icône', shortcut: 'I', glyph: '☆' }

/**
 * Palette d'outils flottante, posée sur le canvas et repliée par défaut.
 *
 * Les outils servent rarement — les raccourcis clavier (voir useKeyboard) restent
 * le chemin principal — donc au repos la palette se réduit à un seul bouton qui
 * affiche l'outil actif.
 */
export function ToolPalette() {
  const tool = useDesignStore((state) => state.tool)
  const setTool = useDesignStore((state) => state.setTool)
  const pendingIcon = useDesignStore((state) => state.pendingIcon)
  const setPendingIcon = useDesignStore((state) => state.setPendingIcon)
  const [expanded, toggleExpanded] = usePanelVisible('mcp-design.tool-palette-expanded', false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const active = tool === ICON_TOOL.id ? ICON_TOOL : (TOOLS.find((entry) => entry.id === tool) ?? TOOLS[0])

  if (!expanded) {
    return (
      <div className="tool-palette" data-collapsed>
        <button
          type="button"
          className="tool-button"
          title={`Outils — actif : ${active.label} (${active.shortcut})`}
          aria-label={`Afficher les outils — actif : ${active.label} (${active.shortcut})`}
          aria-expanded={false}
          onClick={toggleExpanded}
        >
          <span className="tool-glyph">{active.glyph}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="tool-palette">
      <div className="tool-grid">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tool-button"
            data-active={tool === entry.id || undefined}
            title={`${entry.label} (${entry.shortcut})`}
            aria-label={`${entry.label} (${entry.shortcut})`}
            aria-pressed={tool === entry.id}
            onClick={() => setTool(entry.id)}
          >
            <span className="tool-glyph">{entry.glyph}</span>
          </button>
        ))}

        {/* L'outil icône ouvre d'abord le sélecteur : poser une icône suppose
            d'avoir choisi laquelle, contrairement à un rectangle. */}
        <div className="tool-popover-anchor">
          <button
            type="button"
            className="tool-button"
            data-active={tool === ICON_TOOL.id || undefined}
            title={`Icône — ${pendingIcon} (I)`}
            aria-label={`Icône — ${pendingIcon} (I)`}
            aria-pressed={tool === ICON_TOOL.id}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <span className="tool-glyph">{ICON_TOOL.glyph}</span>
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

      <button
        type="button"
        className="tool-palette-collapse"
        title="Replier les outils"
        aria-label="Replier les outils"
        aria-expanded
        onClick={() => {
          setPickerOpen(false)
          toggleExpanded()
        }}
      >
        ⌄
      </button>
    </div>
  )
}

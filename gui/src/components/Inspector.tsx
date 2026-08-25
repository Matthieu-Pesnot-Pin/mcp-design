import { nodeKindLabel } from '@shared/node-defaults'
import { useDesignStore } from '../store/useDesignStore'
import { round } from '../utils/nodes'
import type { DesignNode } from '../types'

const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800]
const ALIGNMENTS: Array<{ value: 'left' | 'center' | 'right'; glyph: string; label: string }> = [
  { value: 'left', glyph: '⇤', label: 'Aligner à gauche' },
  { value: 'center', glyph: '↔', label: 'Centrer' },
  { value: 'right', glyph: '⇥', label: 'Aligner à droite' },
]

/** Champ numérique : ne remonte la valeur que si elle est réellement exploitable. */
function NumberField({
  label,
  value,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string
  value: number | undefined
  step?: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value === undefined ? '' : round(value)}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | undefined
  onChange: (value: string) => void
}) {
  const safe = value ?? '#000000'
  return (
    <label className="field">
      <span>{label}</span>
      <span className="color-input">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(safe) ? safe : '#000000'} onChange={(event) => onChange(event.target.value)} />
        <input type="text" value={safe} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  )
}

export function Inspector() {
  const design = useDesignStore((state) => state.design)
  const selectedIds = useDesignStore((state) => state.selectedIds)
  const patchNodes = useDesignStore((state) => state.patchNodes)
  const patchArtboard = useDesignStore((state) => state.patchArtboard)
  const deleteSelected = useDesignStore((state) => state.deleteSelected)
  const duplicateSelected = useDesignStore((state) => state.duplicateSelected)
  const reorderSelected = useDesignStore((state) => state.reorderSelected)

  if (!design) return null

  const selected = design.nodes.filter((node) => selectedIds.includes(node.id))
  const patch = (fields: Partial<DesignNode>) => patchNodes(selectedIds, fields)

  if (selected.length === 0) {
    return (
      <aside className="inspector">
        <h2>Planche</h2>
        <label className="field">
          <span>Nom</span>
          <input value={design.name} onChange={(event) => patchArtboard({ name: event.target.value })} />
        </label>
        <div className="field-row">
          <NumberField label="Largeur" value={design.width} min={1} onChange={(width) => patchArtboard({ width: Math.max(1, width) })} />
          <NumberField label="Hauteur" value={design.height} min={1} onChange={(height) => patchArtboard({ height: Math.max(1, height) })} />
        </div>
        <ColorField label="Fond" value={design.background} onChange={(background) => patchArtboard({ background })} />
        <p className="empty-hint">Sélectionnez un élément pour modifier ses propriétés.</p>
      </aside>
    )
  }

  // En sélection multiple, seules les propriétés communes à tous les types sont éditables.
  const uniformType = selected.every((node) => node.type === selected[0].type) ? selected[0].type : null
  const first = selected[0]
  const isMulti = selected.length > 1

  return (
    <aside className="inspector">
      <h2>
        {isMulti ? `${selected.length} éléments` : first.name}
        {uniformType && <span className="inspector-type">{nodeKindLabel(uniformType)}</span>}
      </h2>

      {!isMulti && (
        <label className="field">
          <span>Nom du calque</span>
          <input
            value={first.name}
            onChange={(event) => {
              const value = event.target.value
              if (value.trim() !== '') patch({ name: value })
            }}
          />
        </label>
      )}

      <div className="field-row">
        <NumberField label="X" value={first.x} onChange={(x) => patch({ x })} />
        <NumberField label="Y" value={first.y} onChange={(y) => patch({ y })} />
      </div>
      <div className="field-row">
        <NumberField label="L" value={first.width} onChange={(width) => patch({ width })} />
        <NumberField label="H" value={first.height} onChange={(height) => patch({ height })} />
      </div>
      <div className="field-row">
        <NumberField label="Rotation" value={first.rotation} onChange={(rotation) => patch({ rotation })} />
        <NumberField
          label="Opacité"
          value={first.opacity}
          step={0.05}
          min={0}
          max={1}
          onChange={(opacity) => patch({ opacity: Math.min(1, Math.max(0, opacity)) })}
        />
      </div>

      {uniformType && uniformType !== 'line' && uniformType !== 'text' && (
        <>
          <ColorField label="Remplissage" value={first.fill} onChange={(fill) => patch({ fill })} />
          <ColorField label="Contour" value={first.stroke} onChange={(stroke) => patch({ stroke })} />
          <div className="field-row">
            <NumberField
              label="Épaisseur"
              value={first.strokeWidth}
              min={0}
              onChange={(strokeWidth) => patch({ strokeWidth: Math.max(0, strokeWidth) })}
            />
            {uniformType === 'rect' && (
              <NumberField
                label="Arrondi"
                value={first.radius}
                min={0}
                onChange={(radius) => patch({ radius: Math.max(0, radius) })}
              />
            )}
          </div>
        </>
      )}

      {uniformType === 'line' && (
        <>
          <ColorField label="Couleur" value={first.stroke} onChange={(stroke) => patch({ stroke })} />
          <NumberField
            label="Épaisseur"
            value={first.strokeWidth}
            min={0}
            onChange={(strokeWidth) => patch({ strokeWidth: Math.max(0, strokeWidth) })}
          />
        </>
      )}

      {uniformType === 'text' && (
        <>
          {!isMulti && (
            <label className="field">
              <span>Contenu</span>
              <textarea rows={3} value={first.text ?? ''} onChange={(event) => patch({ text: event.target.value })} />
            </label>
          )}
          <ColorField label="Couleur" value={first.color} onChange={(color) => patch({ color })} />
          <div className="field-row">
            <NumberField
              label="Taille"
              value={first.fontSize}
              min={1}
              onChange={(fontSize) => patch({ fontSize: Math.max(1, fontSize) })}
            />
            <label className="field">
              <span>Graisse</span>
              <select value={first.fontWeight ?? 400} onChange={(event) => patch({ fontWeight: Number(event.target.value) })}>
                {FONT_WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <NumberField
              label="Interligne"
              value={first.lineHeight}
              step={0.05}
              min={0.5}
              onChange={(lineHeight) => patch({ lineHeight: Math.max(0.5, lineHeight) })}
            />
            <label className="field">
              <span>Style</span>
              <button
                type="button"
                className="toggle-button"
                data-active={first.fontStyle === 'italic' || undefined}
                onClick={() => patch({ fontStyle: first.fontStyle === 'italic' ? 'normal' : 'italic' })}
              >
                Italique
              </button>
            </label>
          </div>
          <div className="field">
            <span>Alignement</span>
            <div className="segmented">
              {ALIGNMENTS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  title={entry.label}
                  data-active={(first.textAlign ?? 'left') === entry.value || undefined}
                  onClick={() => patch({ textAlign: entry.value })}
                >
                  {entry.glyph}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="inspector-actions">
        <button type="button" onClick={() => reorderSelected('front')} title="Mettre au premier plan">
          Devant
        </button>
        <button type="button" onClick={() => reorderSelected('back')} title="Mettre à l'arrière-plan">
          Derrière
        </button>
        <button type="button" onClick={duplicateSelected} title="Dupliquer (Ctrl+D)">
          Dupliquer
        </button>
        <button type="button" className="danger" onClick={deleteSelected} title="Supprimer (Suppr)">
          Supprimer
        </button>
      </div>
    </aside>
  )
}

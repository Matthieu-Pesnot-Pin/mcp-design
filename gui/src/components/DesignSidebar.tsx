import { useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'

const PRESETS = [
  { label: 'Desktop 1440 × 900', width: 1440, height: 900 },
  { label: 'Mobile 375 × 812', width: 375, height: 812 },
  { label: 'Carré 1080 × 1080', width: 1080, height: 1080 },
]

export function DesignSidebar() {
  const designs = useDesignStore((state) => state.designs)
  const current = useDesignStore((state) => state.design)
  const openDesign = useDesignStore((state) => state.openDesign)
  const createDesign = useDesignStore((state) => state.createDesign)
  const removeDesign = useDesignStore((state) => state.removeDesign)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(0)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    await createDesign({ name: trimmed, ...PRESETS[preset] })
    setName('')
    setCreating(false)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Designs</h1>
        <button type="button" className="ghost-button" onClick={() => setCreating((open) => !open)}>
          {creating ? 'Annuler' : '+ Nouveau'}
        </button>
      </div>

      {creating && (
        <form className="create-form" onSubmit={submit}>
          <input
            autoFocus
            placeholder="Nom du design"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select value={preset} onChange={(event) => setPreset(Number(event.target.value))}>
            {PRESETS.map((entry, index) => (
              <option key={entry.label} value={index}>
                {entry.label}
              </option>
            ))}
          </select>
          <button type="submit" className="primary-button" disabled={name.trim() === ''}>
            Créer
          </button>
        </form>
      )}

      <ul className="design-list">
        {designs.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="design-item"
              data-active={current?.id === entry.id || undefined}
              onClick={() => void openDesign(entry.id)}
            >
              <span className="design-name">{entry.name}</span>
              <span className="design-meta">
                {entry.width} × {entry.height} · {entry.nodeCount} élément{entry.nodeCount > 1 ? 's' : ''}
              </span>
              {entry.pendingChanges > 0 && (
                <span className="design-badge" title="Modifications pas encore récupérées par l'agent">
                  {entry.pendingChanges} à synchroniser
                </span>
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              title="Supprimer ce design"
              onClick={() => {
                if (confirm(`Supprimer définitivement « ${entry.name} » ?`)) void removeDesign(entry.id)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {designs.length === 0 && !creating && (
        <p className="empty-hint">
          Aucun design. Créez-en un ici, ou demandez à l'agent d'en générer un avec l'outil <code>create_design</code>.
        </p>
      )}
    </aside>
  )
}

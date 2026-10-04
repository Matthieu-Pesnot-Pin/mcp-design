import { useMemo, useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { draftsOf, useRemarkStore } from '../store/useRemarkStore'
import { Icon } from './Icon'
import { GROUP_SEPARATOR, buildGroupTree, groupPaths, type GroupBranch } from '../utils/design-groups'
import type { DesignSummary } from '../types'

const PRESETS = [
  { label: 'Desktop 1440 × 900', width: 1440, height: 900 },
  { label: 'Mobile 375 × 812', width: 375, height: 812 },
  { label: 'Carré 1080 × 1080', width: 1080, height: 1080 },
]

const COLLAPSED_KEY = 'mcp-design.collapsed-groups'

function readCollapsed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function DesignSidebar() {
  const designs = useDesignStore((state) => state.designs)
  const createDesign = useDesignStore((state) => state.createDesign)
  const setDesignGroup = useDesignStore((state) => state.setDesignGroup)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [preset, setPreset] = useState(0)
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed)
  /** Chemin du groupe survolé pendant un glisser-déposer, pour le retour visuel. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const tree = useMemo(() => buildGroupTree(designs), [designs])
  const knownGroups = useMemo(() => groupPaths(designs), [designs])

  const toggleGroup = (path: string) => {
    setCollapsed((current) => {
      const next = current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // Stockage indisponible : le pliage reste valable pour la session.
      }
      return next
    })
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    await createDesign({ name: trimmed, group: group.trim() || null, ...PRESETS[preset] })
    setName('')
    setCreating(false)
  }

  /** Déposer une page sur un groupe la range dedans ; `null` la remet à la racine. */
  const dropOn = (path: string | null) => (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('text/design-id')) return
    event.preventDefault()
    // Le groupe le plus profond survolé gagne : sans cela le dépôt retomberait
    // toujours sur la racine, qui englobe tout l'arbre.
    event.stopPropagation()
    setDropTarget(null)
    const designId = event.dataTransfer.getData('text/design-id')
    if (!designId) return
    const moved = designs.find((entry) => entry.id === designId)
    if (!moved || (moved.group ?? null) === path) return
    void setDesignGroup(designId, path)
  }

  const allowDrop = (path: string | null) => (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('text/design-id')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(path ?? '')
  }

  /**
   * Le survol d'un enfant émet un dragleave sur le parent : sans ce test, la
   * cible clignoterait en passant d'une page à l'autre du même groupe.
   */
  const leaveDrop = (event: React.DragEvent) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    setDropTarget(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Pages</h1>
        <button type="button" className="ghost-button" onClick={() => setCreating((open) => !open)}>
          {creating ? 'Annuler' : '+ Nouvelle'}
        </button>
      </div>

      {creating && (
        <form className="create-form" onSubmit={submit}>
          <input
            autoFocus
            placeholder="Nom de la page"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            list="design-groups"
            placeholder="Groupe (optionnel, ex. Marketing/Landing)"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          />
          <datalist id="design-groups">
            {knownGroups.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
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

      <div
        className="design-tree"
        data-drop={dropTarget === '' || undefined}
        onDragOver={allowDrop(null)}
        onDragLeave={leaveDrop}
        onDrop={dropOn(null)}
      >
        <Branch
          branch={tree}
          depth={0}
          collapsed={collapsed}
          dropTarget={dropTarget}
          onToggle={toggleGroup}
          onDragOverGroup={allowDrop}
          onDragLeaveGroup={leaveDrop}
          onDropGroup={dropOn}
        />
      </div>

      {designs.length === 0 && !creating && (
        <p className="empty-hint">
          Aucune page. Créez-en une ici, ou demandez à l'agent d'en générer avec l'outil <code>create_design</code>.
        </p>
      )}
    </aside>
  )
}

/** Un niveau de l'arbre : ses pages, puis ses sous-groupes. */
function Branch({
  branch,
  depth,
  collapsed,
  dropTarget,
  onToggle,
  onDragOverGroup,
  onDragLeaveGroup,
  onDropGroup,
}: {
  branch: GroupBranch
  depth: number
  collapsed: string[]
  dropTarget: string | null
  onToggle: (path: string) => void
  onDragOverGroup: (path: string | null) => (event: React.DragEvent) => void
  onDragLeaveGroup: (event: React.DragEvent) => void
  onDropGroup: (path: string | null) => (event: React.DragEvent) => void
}) {
  return (
    <>
      <ul className="design-list">
        {branch.designs.map((entry) => (
          <DesignRow key={entry.id} entry={entry} depth={depth} />
        ))}
      </ul>

      {branch.children.map((child) => {
        const isCollapsed = collapsed.includes(child.path)
        return (
          <div
            key={child.path}
            className="design-group"
            // Tout le bloc accepte le depot, en-tete comme pages : viser une
            // page du groupe range bien dans ce groupe.
            data-drop={dropTarget === child.path || undefined}
            onDragOver={onDragOverGroup(child.path)}
            onDragLeave={onDragLeaveGroup}
            onDrop={onDropGroup(child.path)}
          >
            <button
              type="button"
              className="design-group-header"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => onToggle(child.path)}
            >
              <span className="design-group-caret">{isCollapsed ? '▸' : '▾'}</span>
              <span className="design-group-name">{child.name}</span>
              <span className="design-group-count">{child.total}</span>
            </button>

            {!isCollapsed && (
              <Branch
                branch={child}
                depth={depth + 1}
                collapsed={collapsed}
                dropTarget={dropTarget}
                onToggle={onToggle}
                onDragOverGroup={onDragOverGroup}
                onDragLeaveGroup={onDragLeaveGroup}
                onDropGroup={onDropGroup}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

function DesignRow({ entry, depth }: { entry: DesignSummary; depth: number }) {
  const current = useDesignStore((state) => state.design)
  const openDesign = useDesignStore((state) => state.openDesign)
  const removeDesign = useDesignStore((state) => state.removeDesign)
  const setDesignGroup = useDesignStore((state) => state.setDesignGroup)
  const drafts = useRemarkStore((state) => draftsOf(state.remarks, entry.id).length)

  return (
    <li>
      <button
        type="button"
        className="design-item"
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable
        onDragStart={(event) => {
          // Type de données maison : le survol d'un groupe ne doit réagir qu'à
          // une page glissée, pas à un fichier ou à du texte venu d'ailleurs.
          event.dataTransfer.setData('text/design-id', entry.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        data-active={current?.id === entry.id || undefined}
        onClick={() => void openDesign(entry.id)}
      >
        <span className="design-name">
          {entry.name}
          {drafts > 0 && (
            <span className="remark-badge" title={`${drafts} remarque${drafts > 1 ? 's' : ''} non transmise${drafts > 1 ? 's' : ''}`}>
              <Icon name="message-square" size={10} strokeWidth={2.5} />
              {drafts}
            </span>
          )}
        </span>
        <span className="design-meta">
          {entry.width} × {entry.height} · {entry.nodeCount} élément{entry.nodeCount > 1 ? 's' : ''}
        </span>
        {entry.pendingChanges > 0 && (
          <span className="design-badge" title="Modifications pas encore récupérées par l'agent">
            {entry.pendingChanges} à synchroniser
          </span>
        )}
      </button>
      {entry.group && (
        <button
          type="button"
          className="icon-button"
          title={`Sortir du groupe « ${entry.group.split(GROUP_SEPARATOR).at(-1)} »`}
          onClick={() => void setDesignGroup(entry.id, null)}
        >
          ⤴
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        title="Supprimer cette page"
        onClick={() => {
          if (confirm(`Supprimer définitivement « ${entry.name} » ?`)) void removeDesign(entry.id)
        }}
      >
        ✕
      </button>
    </li>
  )
}

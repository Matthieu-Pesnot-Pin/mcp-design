import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHost } from '../host'
import { useDesignStore } from '../store/useDesignStore'
import { draftsOf, useRemarkStore } from '../store/useRemarkStore'
import { Icon } from './Icon'
import {
  branchPaths,
  buildGroupTree,
  designsOf,
  filterTree,
  findBranch,
  groupInitials,
  groupPaths,
  searchTree,
  type GroupBranch,
} from '../utils/design-groups'
import type { DesignSummary } from '../types'

const PRESETS = [
  { label: 'Desktop 1440 × 900', width: 1440, height: 900 },
  { label: 'Mobile 375 × 812', width: 375, height: 812 },
  { label: 'Carré 1080 × 1080', width: 1080, height: 1080 },
]

const COLLAPSED_KEY = 'mcp-design.collapsed-groups'
const SCOPE_KEY = 'mcp-design.sidebar-scope'

/** Couleurs des avatars de groupe, attribuées d'après le nom du groupe. */
const AVATAR_COLORS = ['#1b4dd6', '#0f766e', '#c2410c', '#7c3aed', '#db2777', '#475569', '#a16207', '#15803d']

type PageFilter = 'all' | 'pending' | 'remarks'

function readStored<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : parse(JSON.parse(raw))
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Stockage indisponible : la préférence reste valable pour la session.
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

/** Comparaison de recherche insensible à la casse et aux accents. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** « il y a 5 min », « il y a 7 j » ; au-delà d'un mois, la date. */
function relativeTime(iso: string): string {
  const date = new Date(iso)
  const seconds = (Date.now() - date.getTime()) / 1000
  if (seconds < 60) return "à l'instant"
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`
  if (seconds < 30 * 86400) return `il y a ${Math.floor(seconds / 86400)} j`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('fr', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function branchSummary(branch: GroupBranch): string {
  const pages = designsOf(branch)
  const pending = pages.filter((page) => page.pendingChanges > 0).length
  return `${plural(pages.length, 'page')} · ${pending} à synchroniser`
}

/** Ferme un menu flottant au clic en dehors de son conteneur ou sur Échap. */
function useDismiss(open: boolean, container: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, container, close])
}

export function DesignSidebar() {
  const host = useHost()
  const designs = useDesignStore((state) => state.designs)
  const createDesign = useDesignStore((state) => state.createDesign)
  const setDesignGroup = useDesignStore((state) => state.setDesignGroup)
  const remarks = useRemarkStore((state) => state.remarks)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [preset, setPreset] = useState(0)
  const [collapsed, setCollapsed] = useState<string[]>(() =>
    readStored(COLLAPSED_KEY, (raw) => (Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []), [])
  )
  const [scope, setScope] = useState<string | null>(() =>
    readStored(SCOPE_KEY, (raw) => (typeof raw === 'string' ? raw : null), null)
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PageFilter>('all')
  /** Chemin du groupe survolé pendant un glisser-déposer, pour le retour visuel. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const tree = useMemo(() => buildGroupTree(designs), [designs])
  const knownGroups = useMemo(() => groupPaths(designs), [designs])

  // Un groupe choisi qui n'existe plus (vidé ou renommé) ne restreint rien.
  const scopeBranch = useMemo(() => (scope === null ? null : findBranch(tree, scope)), [tree, scope])
  const root = scopeBranch ?? tree
  const rootPath = scopeBranch?.path ?? null

  const draftCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const remark of draftsOf(remarks)) counts.set(remark.designId, (counts.get(remark.designId) ?? 0) + 1)
    return counts
  }, [remarks])

  const searched = useMemo(() => {
    const needle = fold(query.trim())
    return needle === '' ? root : searchTree(root, (text) => fold(text).includes(needle))
  }, [root, query])

  const searchedPages = useMemo(() => designsOf(searched), [searched])
  const pendingCount = searchedPages.filter((design) => design.pendingChanges > 0).length
  const remarkCount = searchedPages.filter((design) => draftCounts.has(design.id)).length

  const visible = useMemo(() => {
    if (filter === 'pending') return filterTree(searched, (design) => design.pendingChanges > 0)
    if (filter === 'remarks') return filterTree(searched, (design) => draftCounts.has(design.id))
    return searched
  }, [searched, filter, draftCounts])

  // Une recherche ou un filtre déplie tout : un résultat caché dans un groupe
  // replié ne se verrait pas.
  const forceOpen = query.trim() !== '' || filter !== 'all'

  const chooseScope = (path: string | null) => {
    setScope(path)
    writeStored(SCOPE_KEY, path)
  }

  const toggleGroup = (path: string) => {
    setCollapsed((current) => {
      const next = current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
      writeStored(COLLAPSED_KEY, next)
      return next
    })
  }

  const rootGroupPaths = useMemo(() => branchPaths(root), [root])
  const allCollapsed = rootGroupPaths.length > 0 && rootGroupPaths.every((path) => collapsed.includes(path))

  /** Replie tous les groupes du groupe affiché, ou les déplie s'ils le sont déjà tous. */
  const toggleAll = () => {
    setCollapsed((current) => {
      const next = allCollapsed
        ? current.filter((path) => !rootGroupPaths.includes(path))
        : [...new Set([...current, ...rootGroupPaths])]
      writeStored(COLLAPSED_KEY, next)
      return next
    })
  }

  const toggleCreating = () => {
    if (!creating) setGroup(rootPath ?? '')
    setCreating((open) => !open)
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

  const filters: { id: PageFilter; label: React.ReactNode; count: number; title: string }[] = [
    { id: 'all', label: 'Toutes', count: searchedPages.length, title: 'Toutes les pages' },
    {
      id: 'pending',
      label: (
        <>
          <span className="pending-dot" />À synchroniser
        </>
      ),
      count: pendingCount,
      title: host.pendingFilterTitle,
    },
    {
      id: 'remarks',
      label: <Icon name="message-square" size={12} strokeWidth={2.5} />,
      count: remarkCount,
      title: 'Pages avec des remarques non transmises',
    },
  ]

  return (
    <aside className="sidebar">
      <datalist id="design-groups">
        {knownGroups.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>

      <div className="sidebar-top">
        <ScopePicker tree={tree} current={scopeBranch} onChange={chooseScope} />

        <div className="sidebar-search-row">
          <label className="sidebar-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Rechercher page ou dossier"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
              }}
            />
          </label>
          <button
            type="button"
            className="collapse-all-button"
            // Une recherche ou un filtre actif garde tout déplié : le bouton
            // n'aurait alors aucun effet visible.
            disabled={forceOpen || rootGroupPaths.length === 0}
            title={allCollapsed ? 'Tout déplier' : 'Tout replier'}
            aria-label={allCollapsed ? 'Tout déplier' : 'Tout replier'}
            onClick={toggleAll}
          >
            <Icon name={allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up'} size={16} />
          </button>
        </div>

        <div className="sidebar-filters" role="radiogroup" aria-label="Filtrer les pages">
          {filters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={filter === entry.id}
              className="filter-chip"
              data-kind={entry.id}
              data-active={filter === entry.id || undefined}
              title={entry.title}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              <span className="filter-chip-count">{entry.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className="design-tree"
        data-drop={dropTarget === (rootPath ?? '') || undefined}
        onDragOver={allowDrop(rootPath)}
        onDragLeave={leaveDrop}
        onDrop={dropOn(rootPath)}
      >
        <Branch
          branch={visible}
          rootLabel={scopeBranch ? null : 'Hors groupe'}
          collapsed={collapsed}
          forceOpen={forceOpen}
          dropTarget={dropTarget}
          draftCounts={draftCounts}
          onToggle={toggleGroup}
          onDragOverGroup={allowDrop}
          onDragLeaveGroup={leaveDrop}
          onDropGroup={dropOn}
        />

        {designs.length === 0 ? (
          <p className="empty-hint">{host.emptyPagesHint}</p>
        ) : (
          visible.total === 0 && <p className="empty-hint">Aucune page ne correspond.</p>
        )}
      </div>

      <div className="sidebar-foot">
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
        <button type="button" className="new-page-button" data-open={creating || undefined} onClick={toggleCreating}>
          {creating ? (
            'Annuler'
          ) : (
            <>
              <Icon name="plus" size={16} strokeWidth={2.25} />
              Nouvelle page
            </>
          )}
        </button>
      </div>
    </aside>
  )
}

/** Choix du groupe affiché : tous les groupes, ou un seul groupe de premier niveau. */
function ScopePicker({
  tree,
  current,
  onChange,
}: {
  tree: GroupBranch
  current: GroupBranch | null
  onChange: (path: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, container, close)

  const choose = (path: string | null) => {
    onChange(path)
    setOpen(false)
  }

  return (
    <div className="scope-picker" ref={container}>
      <button
        type="button"
        className="scope-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <GroupAvatar branch={current} />
        <span className="scope-text">
          <span className="scope-name">{current?.name ?? 'Tous les groupes'}</span>
          <span className="scope-summary">{branchSummary(current ?? tree)}</span>
        </span>
        <Icon name="chevrons-up-down" size={16} />
      </button>

      {open && (
        <ul className="scope-menu" role="listbox">
          {[null, ...tree.children].map((branch) => {
            const selected = (branch?.path ?? null) === (current?.path ?? null)
            return (
              <li key={branch?.path ?? ''}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="scope-option"
                  onClick={() => choose(branch?.path ?? null)}
                >
                  <GroupAvatar branch={branch} small />
                  <span className="scope-option-name">{branch?.name ?? 'Tous les groupes'}</span>
                  <span className="scope-option-count">{(branch ?? tree).total}</span>
                  {selected && <Icon name="check" size={14} strokeWidth={2.5} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function GroupAvatar({ branch, small }: { branch: GroupBranch | null; small?: boolean }) {
  return (
    <span
      className="group-avatar"
      data-small={small || undefined}
      style={{ background: branch ? avatarColor(branch.name) : 'var(--ink)' }}
      aria-hidden="true"
    >
      {branch ? groupInitials(branch.name) : <Icon name="layout-grid" size={small ? 12 : 16} />}
    </span>
  )
}

/** Un niveau de l'arbre : ses sous-groupes, puis ses pages. */
function Branch({
  branch,
  rootLabel = null,
  collapsed,
  forceOpen,
  dropTarget,
  draftCounts,
  onToggle,
  onDragOverGroup,
  onDragLeaveGroup,
  onDropGroup,
}: {
  branch: GroupBranch
  /** Intitulé posé au-dessus des pages du niveau quand des groupes les précèdent. */
  rootLabel?: string | null
  collapsed: string[]
  forceOpen: boolean
  dropTarget: string | null
  draftCounts: Map<string, number>
  onToggle: (path: string) => void
  onDragOverGroup: (path: string | null) => (event: React.DragEvent) => void
  onDragLeaveGroup: (event: React.DragEvent) => void
  onDropGroup: (path: string | null) => (event: React.DragEvent) => void
}) {
  return (
    <>
      {branch.children.map((child) => {
        const isCollapsed = !forceOpen && collapsed.includes(child.path)
        return (
          <div
            key={child.path}
            className="design-group"
            // Tout le bloc accepte le dépôt, en-tête comme pages : viser une
            // page du groupe range bien dans ce groupe.
            data-drop={dropTarget === child.path || undefined}
            onDragOver={onDragOverGroup(child.path)}
            onDragLeave={onDragLeaveGroup}
            onDrop={onDropGroup(child.path)}
          >
            <button
              type="button"
              className="design-group-header"
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(child.path)}
            >
              <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={14} strokeWidth={2.25} />
              <Icon name={isCollapsed ? 'folder' : 'folder-open'} size={16} strokeWidth={1.75} />
              <span className="design-group-name">{child.name}</span>
              <span className="design-group-count">{child.total}</span>
            </button>

            {!isCollapsed && (
              <div className="design-group-body">
                <Branch
                  branch={child}
                  collapsed={collapsed}
                  forceOpen={forceOpen}
                  dropTarget={dropTarget}
                  draftCounts={draftCounts}
                  onToggle={onToggle}
                  onDragOverGroup={onDragOverGroup}
                  onDragLeaveGroup={onDragLeaveGroup}
                  onDropGroup={onDropGroup}
                />
              </div>
            )}
          </div>
        )
      })}

      {branch.designs.length > 0 && (
        <>
          {rootLabel && branch.children.length > 0 && <p className="design-tree-label">{rootLabel}</p>}
          <ul className="design-list">
            {branch.designs.map((entry) => (
              <DesignCard key={entry.id} entry={entry} drafts={draftCounts.get(entry.id) ?? 0} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** Aperçu du format de la page : un rectangle aux proportions de la planche. */
function Thumbnail({ width, height }: { width: number; height: number }) {
  const box = { width: 36, height: 26 }
  const ratio = width / height
  const size =
    ratio > box.width / box.height
      ? { width: box.width, height: Math.max(6, Math.round(box.width / ratio)) }
      : { width: Math.max(6, Math.round(box.height * ratio)), height: box.height }
  return (
    <span className="design-thumb" aria-hidden="true">
      <span className="design-thumb-page" style={size} />
    </span>
  )
}

function DesignCard({ entry, drafts }: { entry: DesignSummary; drafts: number }) {
  const active = useDesignStore((state) => state.design?.id === entry.id)
  const openDesign = useDesignStore((state) => state.openDesign)
  const removeDesign = useDesignStore((state) => state.removeDesign)
  const duplicateDesign = useDesignStore((state) => state.duplicateDesign)
  const setDesignGroup = useDesignStore((state) => state.setDesignGroup)

  const [menu, setMenu] = useState<'closed' | 'actions' | 'move'>('closed')
  const [target, setTarget] = useState('')
  const container = useRef<HTMLLIElement>(null)
  const close = useCallback(() => setMenu('closed'), [])
  useDismiss(menu !== 'closed', container, close)

  const startMove = () => {
    setTarget(entry.group ?? '')
    setMenu('move')
  }

  const submitMove = (event: React.FormEvent) => {
    event.preventDefault()
    const next = target.trim() || null
    setMenu('closed')
    if (next !== (entry.group ?? null)) void setDesignGroup(entry.id, next)
  }

  return (
    <li ref={container} className="design-card" data-active={active || undefined} data-menu={menu !== 'closed' || undefined}>
      <button
        type="button"
        className="design-card-main"
        draggable
        onDragStart={(event) => {
          // Type de données maison : le survol d'un groupe ne doit réagir qu'à
          // une page glissée, pas à un fichier ou à du texte venu d'ailleurs.
          event.dataTransfer.setData('text/design-id', entry.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        title={entry.name}
        onClick={() => void openDesign(entry.id)}
      >
        <Thumbnail width={entry.width} height={entry.height} />
        <span className="design-card-text">
          <span className="design-card-name">{entry.name}</span>
          <span className="design-card-meta">
            {entry.width} × {entry.height} · {relativeTime(entry.updatedAt)}
          </span>
        </span>
      </button>

      <span className="design-card-status">
        {drafts > 0 && (
          <span className="remark-badge" title={`${plural(drafts, 'remarque')} non transmise${drafts > 1 ? 's' : ''}`}>
            <Icon name="message-square" size={10} strokeWidth={2.5} />
            {drafts}
          </span>
        )}
        {entry.pendingChanges > 0 && (
          <span
            className="pending-dot"
            title={`${plural(entry.pendingChanges, 'modification')} à synchroniser`}
            aria-label={`${plural(entry.pendingChanges, 'modification')} à synchroniser`}
          />
        )}
      </span>

      <button
        type="button"
        className="design-card-more"
        title="Plus d'actions"
        aria-haspopup="menu"
        aria-expanded={menu !== 'closed'}
        onClick={() => setMenu((current) => (current === 'closed' ? 'actions' : 'closed'))}
      >
        <Icon name="ellipsis" size={16} />
      </button>

      {menu === 'actions' && (
        <div className="card-menu" role="menu">
          <button type="button" role="menuitem" onClick={startMove}>
            <Icon name="folder-input" size={16} strokeWidth={1.75} />
            Déplacer vers…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu('closed')
              void duplicateDesign(entry.id, `${entry.name} (copie)`)
            }}
          >
            <Icon name="copy" size={16} strokeWidth={1.75} />
            Dupliquer
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            data-danger
            onClick={() => {
              setMenu('closed')
              if (confirm(`Supprimer définitivement « ${entry.name} » ?`)) void removeDesign(entry.id)
            }}
          >
            <Icon name="trash-2" size={16} strokeWidth={1.75} />
            Supprimer
          </button>
        </div>
      )}

      {menu === 'move' && (
        <form className="card-menu card-move" onSubmit={submitMove}>
          <label htmlFor={`move-${entry.id}`}>Déplacer vers le groupe</label>
          <input
            id={`move-${entry.id}`}
            autoFocus
            list="design-groups"
            placeholder="Vide : hors groupe"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <div className="card-move-actions">
            <button type="button" className="ghost-button" onClick={close}>
              Annuler
            </button>
            <button type="submit" className="primary-button">
              Déplacer
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { CORE_ICONS, ICON_GRID, iconElements, iconNames } from '@shared/icons'
import { iconElementToSvg } from '@shared/render'

/** Au-delà, la grille rame au clavier sans rien apporter : on affine la recherche. */
const MAX_RESULTS = 120

/**
 * Vignette d'une icône, rendue par le MÊME code que le canvas et que l'export :
 * ce que l'utilisateur choisit ici est exactement ce qui sera dessiné.
 */
function IconGlyph({ name }: { name: string }) {
  const markup = useMemo(() => (iconElements(name) ?? []).map(iconElementToSvg).join(''), [name])
  return (
    <svg
      viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`}
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

/**
 * Sélecteur d'icônes.
 *
 * L'index de synonymes (le double du poids de la géométrie) est chargé à la
 * demande : tant que personne n'ouvre ce panneau, il ne coûte rien au premier
 * affichage du canvas.
 */
export function IconPicker({ current, onPick, onClose }: { current?: string; onPick: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<((query: string, limit?: number) => Array<{ name: string }>) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    import('@shared/icons/search').then((module) => {
      if (!cancelled) setSearch(() => module.searchIcons)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Clic à l'extérieur ou Échap : le panneau se ferme sans rien poser.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const results = useMemo(() => {
    const trimmed = query.trim()
    // Sans recherche, la sélection courante : de quoi habiller une interface
    // sans savoir ce que la bibliothèque contient.
    if (trimmed === '') return CORE_ICONS.slice(0, MAX_RESULTS)
    if (search) return search(trimmed, MAX_RESULTS).map((match) => match.name)
    // Repli tant que l'index n'est pas chargé : recherche sur les noms seuls.
    return iconNames()
      .filter((name) => name.includes(trimmed.toLowerCase()))
      .slice(0, MAX_RESULTS)
  }, [query, search])

  return (
    <div className="icon-picker" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        className="icon-picker-search"
        placeholder="Chercher une icône (en anglais)…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length === 0 ? (
        <p className="empty-hint">Aucune icône pour « {query} ». Essayez un terme anglais plus simple.</p>
      ) : (
        <div className="icon-picker-grid">
          {results.map((name) => (
            <button
              key={name}
              type="button"
              className="icon-picker-cell"
              data-active={name === current || undefined}
              title={name}
              onClick={() => onPick(name)}
            >
              <IconGlyph name={name} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

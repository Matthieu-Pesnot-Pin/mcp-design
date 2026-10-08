import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { PATH_SEPARATOR, nodePath, type Remark } from '@shared/feedback'
import { regionToSvg } from '@shared/render'
import { ancestorsOf, boundsOf, type Box, type Layout } from '@shared/tree'
import { useRemarkStore, type Composer } from '../store/useRemarkStore'
import type { Design, DesignNode } from '../types'
import { remarkBox } from '../utils/remarks'
import { Icon } from './Icon'
import { api } from '../utils/api'

/** Remarques du design affichées sur la planche, selon le choix « transmises ». */
function useVisibleRemarks(designId: string): Remark[] {
  const remarks = useRemarkStore((state) => state.remarks)
  const showSent = useRemarkStore((state) => state.showSent)
  return useMemo(
    () => remarks.filter((remark) => remark.designId === designId && (showSent || remark.status === 'draft')),
    [remarks, designId, showSent]
  )
}

function composerBox(composer: Composer | null, layout: Layout): Box | null {
  if (composer?.kind === 'node') return boundsOf(layout, composer.nodeId)
  if (composer?.kind === 'area') return composer.box
  return null
}

/** Contours dessinés dans le SVG de la planche, à l'échelle du document. */
export function RemarkShapes({ designId, layout, hoverId }: { designId: string; layout: Layout; hoverId: string | null }) {
  const remarks = useVisibleRemarks(designId)
  const composer = useRemarkStore((state) => state.composer)
  const hoveredId = useRemarkStore((state) => state.hoveredId)
  const focusedId = useRemarkStore((state) => state.focusedId)

  const target = composerBox(composer, layout)
  const targetId = composer?.kind === 'node' ? composer.nodeId : null

  return (
    <g className="remark-shapes">
      {remarks.map((remark) => {
        const placed = remarkBox(remark, layout)
        if (!placed) return null
        const highlighted = remark.id === hoveredId || remark.id === focusedId
        // Une zone reste toujours visible ; un élément n'est entouré que
        // lorsqu'on désigne sa remarque.
        if (remark.target.kind === 'node' && !highlighted) return null
        return (
          <rect
            key={remark.id}
            className="remark-frame"
            data-status={remark.status}
            data-highlighted={highlighted || undefined}
            x={placed.box.x}
            y={placed.box.y}
            width={placed.box.width}
            height={placed.box.height}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}

      {hoverId && hoverId !== targetId && (
        <BoxRect className="remark-hover" box={boundsOf(layout, hoverId)} />
      )}
      {target && <BoxRect className="remark-aim" box={target} />}
    </g>
  )
}

function BoxRect({ className, box }: { className: string; box: Box }) {
  return (
    <rect
      className={className}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      vectorEffect="non-scaling-stroke"
    />
  )
}

/**
 * Pastilles, étiquette de survol et bulle de saisie. Elles vivent hors de la
 * surface zoomée, comme les poignées : taille constante à l'écran.
 */
export function RemarkLayer({
  design,
  nodes,
  layout,
  zoom,
  hoverId,
}: {
  design: Design
  nodes: DesignNode[]
  layout: Layout
  zoom: number
  hoverId: string | null
}) {
  const remarks = useVisibleRemarks(design.id)
  const composer = useRemarkStore((state) => state.composer)
  const hoveredId = useRemarkStore((state) => state.hoveredId)
  const focusedId = useRemarkStore((state) => state.focusedId)
  const setFocused = useRemarkStore((state) => state.setFocused)
  const closeComposer = useRemarkStore((state) => state.closeComposer)

  // Changer de page abandonne la remarque en cours : elle visait l'autre planche.
  useEffect(() => closeComposer, [design.id, closeComposer])

  const pageRemarks = remarks.filter((remark) => remark.target.kind === 'page')
  const targetId = composer?.kind === 'node' ? composer.nodeId : null
  const hoverBox = hoverId && hoverId !== targetId ? boundsOf(layout, hoverId) : null

  return (
    <>
      {pageRemarks.length > 0 && (
        <button
          type="button"
          className="remark-page-chip"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setFocused(pageRemarks[0].id)}
        >
          <Icon name="file-text" size={12} />
          {pageRemarks.length === 1 ? '1 remarque sur la page' : `${pageRemarks.length} remarques sur la page`}
        </button>
      )}

      {hoverBox && (
        <div className="remark-hover-tag" style={{ left: hoverBox.x * zoom, top: hoverBox.y * zoom }}>
          {nodePath(nodes, hoverId!).join(PATH_SEPARATOR)}
        </div>
      )}

      {remarks.map((remark) => {
        const placed = remarkBox(remark, layout)
        if (!placed || remark.number === null) return null
        const corner =
          remark.target.kind === 'node'
            ? { x: placed.box.x + placed.box.width, y: placed.box.y }
            : { x: placed.box.x, y: placed.box.y }
        return (
          <button
            key={remark.id}
            type="button"
            className="remark-pin"
            data-status={remark.status}
            data-highlighted={remark.id === hoveredId || remark.id === focusedId || undefined}
            data-missing={placed.missing || undefined}
            style={{ left: corner.x * zoom, top: corner.y * zoom }}
            title={placed.missing ? 'Élément supprimé depuis la remarque' : remark.text}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setFocused(remark.id)}
          >
            {remark.number}
          </button>
        )
      })}

      {composer && composer.kind !== 'page' && (
        <RemarkComposer composer={composer} design={design} layout={layout} zoom={zoom} />
      )}
    </>
  )
}

/** Écart entre l'élément visé et la bulle de saisie, en pixels écran. */
const COMPOSER_GAP_PX = 10

function RemarkComposer({
  composer,
  design,
  layout,
  zoom,
}: {
  composer: Exclude<Composer, { kind: 'page' }>
  design: Design
  layout: Layout
  zoom: number
}) {
  const saving = useRemarkStore((state) => state.saving)
  const setText = useRemarkStore((state) => state.setComposerText)
  const toggleCapture = useRemarkStore((state) => state.toggleComposerCapture)
  const toggleElement = useRemarkStore((state) => state.toggleAreaElement)
  const openNodeComposer = useRemarkStore((state) => state.openNodeComposer)
  const closeComposer = useRemarkStore((state) => state.closeComposer)
  const save = useRemarkStore((state) => state.saveComposer)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const anchor = composerBox(composer, layout)!
  const nodeKey = composer.kind === 'node' ? composer.nodeId : null
  const areaBox = composer.kind === 'area' ? composer.box : null

  useEffect(() => {
    // Sans preventScroll, le navigateur ferait défiler le viewport du canvas,
    // dont la vue ne bouge que par transformation.
    textRef.current?.focus({ preventScroll: true })
  }, [composer.kind, nodeKey])

  // Sous l'élément par défaut ; au-dessus quand il n'y a pas la place en bas
  // du canvas et qu'il y en a davantage en haut.
  useLayoutEffect(() => {
    const element = boxRef.current
    const viewport = element?.closest('.canvas-viewport')
    if (!element || !viewport) return
    element.style.top = `${(anchor.y + anchor.height) * zoom + COMPOSER_GAP_PX}px`
    element.style.transform = ''
    const view = viewport.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const roomAbove = rect.top - view.top - (anchor.height * zoom + COMPOSER_GAP_PX * 2)
    if (rect.bottom > view.bottom && roomAbove > view.bottom - rect.top) {
      element.style.top = `${anchor.y * zoom - COMPOSER_GAP_PX}px`
      element.style.transform = 'translateY(-100%)'
    }
  })

  // SVG inséré dans la page, pas chargé par une balise <img> : un SVG servi
  // comme image ne charge aucune ressource externe, donc aucune image du design.
  const preview = useMemo(
    () => (areaBox ? regionToSvg(design, areaBox, { imageHref: api.imageUrl }) : null),
    [areaBox, design]
  )

  const canSave = composer.text.trim() !== '' && !saving

  return (
    <div
      ref={boxRef}
      className="remark-composer"
      style={{ left: anchor.x * zoom }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="remark-composer-head">
        <Icon name={composer.kind === 'node' ? 'mouse-pointer-click' : 'square-dashed-mouse-pointer'} />
        <h2>{composer.kind === 'node' ? 'Remarque sur un élément' : 'Remarque sur une zone'}</h2>
        <button type="button" className="icon-button" title="Annuler (Échap)" onClick={closeComposer}>
          <Icon name="x" />
        </button>
      </div>

      {composer.kind === 'node' ? (
        <div className="remark-composer-section">
          <div className="remark-breadcrumb">
            {[...ancestorsOf(design.nodes, composer.nodeId)].reverse().map((ancestor) => (
              <span key={ancestor.id}>
                <button type="button" className="link-button" onClick={() => openNodeComposer(ancestor.id)}>
                  {ancestor.name}
                </button>
                <span className="remark-breadcrumb-sep">›</span>
              </span>
            ))}
            <span className="remark-chip">{design.nodes.find((node) => node.id === composer.nodeId)?.name}</span>
          </div>
          <p className="remark-hint">Cliquez sur un niveau pour viser un parent ; Alt + clic sur la planche vise l’élément exact.</p>
        </div>
      ) : (
        <div className="remark-composer-section">
          <div
            className="remark-preview"
            role="img"
            aria-label="Aperçu de la zone"
            dangerouslySetInnerHTML={{ __html: preview! }}
          />
          <p className="remark-hint">
            x {Math.round(composer.box.x)}, y {Math.round(composer.box.y)} · {Math.round(composer.box.width)} ×{' '}
            {Math.round(composer.box.height)} px
          </p>
          <div className="remark-hits-head">
            <span className="section-label">Éléments détectés</span>
            <span className="remark-hint">
              {composer.elementIds.length} sur {composer.hits.length} cité{composer.elementIds.length > 1 ? 's' : ''}
            </span>
          </div>
          {composer.hits.length === 0 ? (
            <p className="remark-hint">Aucun élément dans cette zone.</p>
          ) : (
            <ul className="remark-hits">
              {composer.hits.map((hit) => (
                <li key={hit.id}>
                  <label data-off={!composer.elementIds.includes(hit.id) || undefined}>
                    <input
                      type="checkbox"
                      checked={composer.elementIds.includes(hit.id)}
                      onChange={() => toggleElement(hit.id)}
                    />
                    <span className="remark-hit-name">{hit.name}</span>
                    <span className="remark-hit-kind">
                      {hit.type}
                      {hit.partial ? ' · en partie' : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <textarea
        ref={textRef}
        className="remark-textarea"
        rows={3}
        placeholder="Ce que l'agent doit revoir…"
        value={composer.text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') closeComposer()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save()
        }}
      />

      <label className="remark-check">
        <input type="checkbox" checked={composer.capture} onChange={toggleCapture} />
        {composer.kind === 'node' ? "Joindre une capture de l'élément" : 'Joindre une capture de la zone'}
      </label>

      <div className="remark-composer-foot">
        <span className="remark-hint">Ctrl + Entrée · Échap</span>
        <button type="button" className="ghost-button" onClick={closeComposer}>
          Annuler
        </button>
        <button type="button" className="primary-button" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

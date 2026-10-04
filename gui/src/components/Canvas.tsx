import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { groupTransform, nodeToSvg, normalizedBox, textMetrics } from '@shared/render'
import { boundsOf, childrenByParent, computeLayout, spaceOriginOf, unionBoundsOf, type Box, type Layout } from '@shared/tree'
import { expandInstances, instanceRootOf } from '@shared/instances'
import { elementsInArea } from '@shared/feedback'
import { clickTarget, drillTarget, useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'
import { remarkTargetOf } from '../utils/remarks'
import { RemarkLayer, RemarkShapes } from './RemarkOverlay'
import { rectsIntersect, round } from '../utils/nodes'
import type { DesignNode, Tool } from '../types'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end'

interface Point {
  x: number
  y: number
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'create'; type: Exclude<Tool, 'select'>; origin: Point; point: Point }
  | { kind: 'move'; origin: Point; screen: Point; moved: boolean; startNodes: DesignNode[] }
  | { kind: 'resize'; handle: HandleId; origin: Point; startNode: DesignNode }
  | { kind: 'marquee'; origin: Point; point: Point }
  | { kind: 'pan'; clientX: number; clientY: number; panX: number; panY: number }
  /** Mode Remarques : un clic vise un élément, un glissement trace une zone. */
  | { kind: 'remark'; origin: Point; point: Point; screen: Point; nodeId: string | null; alt: boolean; moved: boolean }

const HANDLES: Array<{ id: HandleId; cursor: string; fx: number; fy: number }> = [
  { id: 'nw', cursor: 'nwse-resize', fx: 0, fy: 0 },
  { id: 'n', cursor: 'ns-resize', fx: 0.5, fy: 0 },
  { id: 'ne', cursor: 'nesw-resize', fx: 1, fy: 0 },
  { id: 'e', cursor: 'ew-resize', fx: 1, fy: 0.5 },
  { id: 'se', cursor: 'nwse-resize', fx: 1, fy: 1 },
  { id: 's', cursor: 'ns-resize', fx: 0.5, fy: 1 },
  { id: 'sw', cursor: 'nesw-resize', fx: 0, fy: 1 },
  { id: 'w', cursor: 'ew-resize', fx: 0, fy: 0.5 },
]

function boxFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** Zone ramenée dans les limites de la planche, au pixel près. */
function clampToArtboard(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.round(box.x))
  const y = Math.max(0, Math.round(box.y))
  return {
    x,
    y,
    width: Math.max(0, Math.min(width, Math.round(box.x + box.width)) - x),
    height: Math.max(0, Math.min(height, Math.round(box.y + box.height)) - y),
  }
}

/** En dessous, un glissement en mode Remarques ne trace pas de zone exploitable. */
const MIN_AREA_PX = 4

/** Appui précédent, retenu pour reconnaître un double-clic sans l'évènement natif. */
interface Press {
  id: string
  time: number
  x: number
  y: number
}

const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_SLOP_PX = 6
/**
 * Distance à parcourir avant qu'un appui devienne un déplacement.
 *
 * Sans ce seuil, le tremblement inévitable entre deux clics decale l'element
 * d'un pixel : le document mute, le SVG est réécrit, et le geste en cours n'est
 * plus un simple clic. C'est aussi ce qui evitait qu'on selectionne un element
 * sans le bouger.
 */
const DRAG_THRESHOLD_PX = 4

/**
 * Reconnaissance maison du double-clic.
 *
 * L'évènement `dblclick` du navigateur n'est pas utilisable ici : il n'est émis
 * que si les deux clics partagent une cible DOM, or le moindre tremblement de
 * souris entre les deux déclenche un déplacement, qui réécrit le contenu SVG du
 * noeud. La cible du second clic est alors un élément neuf, l'ancienne est
 * détachée, et le `dblclick` ne part jamais. On compare donc nous-mêmes le
 * noeud visé, l'instant et la distance — trois données que le re-rendu ne
 * change pas.
 */
function isDoubleClick(previous: Press | null, nodeId: string, event: { timeStamp: number; clientX: number; clientY: number }): boolean {
  return (
    previous !== null &&
    previous.id === nodeId &&
    event.timeStamp - previous.time < DOUBLE_CLICK_MS &&
    Math.abs(event.clientX - previous.x) < DOUBLE_CLICK_SLOP_PX &&
    Math.abs(event.clientY - previous.y) < DOUBLE_CLICK_SLOP_PX
  )
}

/** Nouvelle géométrie d'un noeud après déplacement d'une poignée de redimensionnement. */
function resizeNode(node: DesignNode, handle: HandleId, dx: number, dy: number): Partial<DesignNode> {
  if (node.type === 'line') {
    if (handle === 'start') {
      return {
        x: round(node.x + dx),
        y: round(node.y + dy),
        width: round(node.width - dx),
        height: round(node.height - dy),
      }
    }
    return { width: round(node.width + dx), height: round(node.height + dy) }
  }

  const box = normalizedBox(node)
  let { x, y, width, height } = box

  if (handle.includes('w')) {
    x = box.x + dx
    width = box.width - dx
  }
  if (handle.includes('e')) width = box.width + dx
  if (handle.includes('n')) {
    y = box.y + dy
    height = box.height - dy
  }
  if (handle.includes('s')) height = box.height + dy

  // Un retournement laisserait une taille négative : on borne plutôt que d'inverser,
  // ce qui garde le geste prévisible.
  const minSize = node.type === 'text' ? 20 : 4
  if (width < minSize) {
    if (handle.includes('w')) x = box.x + box.width - minSize
    width = minSize
  }
  if (height < minSize) {
    if (handle.includes('n')) y = box.y + box.height - minSize
    height = minSize
  }

  // Une icône reste carrée, comme côté serveur : son tracé l'est, et une boîte
  // rectangulaire ne ferait qu'ajouter du vide sur les côtés.
  if (node.type === 'icon') {
    const side = Math.max(minSize, Math.min(width, height))
    if (handle.includes('w')) x = box.x + box.width - side
    if (handle.includes('n')) y = box.y + box.height - side
    width = side
    height = side
  }

  return { x: round(x), y: round(y), width: round(width), height: round(height) }
}

export function Canvas() {
  const design = useDesignStore((state) => state.design)
  const tool = useDesignStore((state) => state.tool)
  const zoom = useDesignStore((state) => state.zoom)
  const pan = useDesignStore((state) => state.pan)
  const panMode = useDesignStore((state) => state.panMode)
  const selectedIds = useDesignStore((state) => state.selectedIds)
  const editingTextId = useDesignStore((state) => state.editingTextId)
  const remarking = useRemarkStore((state) => state.mode === 'remarks')
  const composerNodeId = useRemarkStore((state) => (state.composer?.kind === 'node' ? state.composer.nodeId : null))
  /** Élément que viserait un clic, en mode Remarques. */
  const [hoverId, setHoverId] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture>({ kind: 'none' })
  const lastPressRef = useRef<Press | null>(null)
  // Incrémenté à chaque début de geste : c'est ce qui (re)monte les écouteurs globaux.
  const [gestureTick, setGestureTick] = useState(0)
  const [rubberBand, setRubberBand] = useState<{ kind: 'create' | 'marquee' | 'area'; box: Box } | null>(null)

  // Le canvas travaille sur les noeuds EXPANSÉS : chaque instance y est déjà
  // remplacée par une copie du contenu de son composant, donc le rendu, les
  // bornes et le survol n'ont pas une seule branche de plus. Ces copies n'ont
  // pas d'existence en stockage : `instanceRootOf` ramène tout identifiant
  // sélectionné vers l'instance elle-même.
  const nodes = useMemo(() => expandInstances(design?.nodes ?? []), [design])
  const layout = useMemo(() => computeLayout(nodes), [nodes])
  const children = useMemo(() => childrenByParent(nodes), [nodes])

  /** Coordonnées document à partir d'un évènement pointeur, quel que soit le zoom. */
  const toDesignPoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom }
    },
    [pan.x, pan.y, zoom]
  )

  // --- Zoom et déplacement à la molette -------------------------------------

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    // React attache `onWheel` en passif : preventDefault n'y ferait rien, et le
    // navigateur zoomerait la page entière. D'où l'écouteur natif non passif.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()

      const state = useDesignStore.getState()
      const rect = viewport.getBoundingClientRect()

      if (event.ctrlKey || event.metaKey) {
        // Exponentiel : un cran de molette produit le même ratio à tous les niveaux de zoom.
        state.zoomAround(state.zoom * Math.exp(-event.deltaY * 0.0015), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
        return
      }

      // Molette seule : la vue défile, comme dans n'importe quel canvas.
      state.setPan({ x: state.pan.x - event.deltaX, y: state.pan.y - event.deltaY })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  // Au premier affichage d'une planche, on la centre dans la vue.
  const centeredFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!design || !viewport || centeredFor.current === design.id) return
    centeredFor.current = design.id

    const rect = viewport.getBoundingClientRect()
    const state = useDesignStore.getState()
    state.setPan({
      x: Math.max(32, (rect.width - design.width * state.zoom) / 2),
      y: Math.max(32, (rect.height - design.height * state.zoom) / 2),
    })
  }, [design])

  // --- Gestes ---------------------------------------------------------------

  useEffect(() => {
    if (gestureRef.current.kind === 'none') return

    const handleMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      const store = useDesignStore.getState()

      if (gesture.kind === 'pan') {
        store.setPan({
          x: gesture.panX + (event.clientX - gesture.clientX),
          y: gesture.panY + (event.clientY - gesture.clientY),
        })
        return
      }

      const point = toDesignPoint(event)
      if (gesture.kind === 'create') {
        gesture.point = point
        setRubberBand({ kind: 'create', box: boxFromPoints(gesture.origin, point) })
      } else if (gesture.kind === 'marquee') {
        gesture.point = point
        setRubberBand({ kind: 'marquee', box: boxFromPoints(gesture.origin, point) })
      } else if (gesture.kind === 'remark') {
        if (!gesture.moved) {
          const far =
            Math.abs(event.clientX - gesture.screen.x) >= DRAG_THRESHOLD_PX ||
            Math.abs(event.clientY - gesture.screen.y) >= DRAG_THRESHOLD_PX
          if (!far) return
          gesture.moved = true
        }
        gesture.point = point
        const current = store.design
        if (current) {
          setRubberBand({
            kind: 'area',
            box: clampToArtboard(boxFromPoints(gesture.origin, point), current.width, current.height),
          })
        }
      } else if (gesture.kind === 'move') {
        if (!gesture.moved) {
          const far =
            Math.abs(event.clientX - gesture.screen.x) >= DRAG_THRESHOLD_PX ||
            Math.abs(event.clientY - gesture.screen.y) >= DRAG_THRESHOLD_PX
          if (!far) return
          // L'historique n'ouvre une transaction qu'ici : un clic qui ne
          // deplace rien ne doit pas consommer un cran d'annulation.
          gesture.moved = true
          store.beginHistory()
        }
        store.moveSelection(round(point.x - gesture.origin.x), round(point.y - gesture.origin.y), gesture.startNodes, {
          history: false,
        })
      } else if (gesture.kind === 'resize') {
        const dx = point.x - gesture.origin.x
        const dy = point.y - gesture.origin.y
        store.patchNodes([gesture.startNode.id], resizeNode(gesture.startNode, gesture.handle, dx, dy), {
          history: false,
        })
      }
    }

    const handleUp = () => {
      const gesture = gestureRef.current
      const store = useDesignStore.getState()

      if (gesture.kind === 'create') {
        const dx = gesture.point.x - gesture.origin.x
        const dy = gesture.point.y - gesture.origin.y
        const isClick = Math.abs(dx) < 4 && Math.abs(dy) < 4

        if (gesture.type === 'line') {
          // Une ligne garde des deltas signés : c'est ce qui encode sa direction.
          store.addNode('line', {
            x: round(gesture.origin.x),
            y: round(gesture.origin.y),
            ...(isClick ? {} : { width: round(dx), height: round(dy) }),
          })
        } else {
          // Une icône se pose avec le dessin choisi dans la barre d'outils ; le
          // reste des types n'a pas de contenu à transporter.
          const content = gesture.type === 'icon' ? { icon: store.pendingIcon } : {}

          if (isClick) {
            // Simple clic : forme à la taille par défaut, ancrée au point cliqué.
            store.addNode(gesture.type, { ...content, x: round(gesture.origin.x), y: round(gesture.origin.y) })
          } else {
            const box = boxFromPoints(gesture.origin, gesture.point)
            store.addNode(gesture.type, {
              ...content,
              x: round(box.x),
              y: round(box.y),
              width: round(box.width),
              height: round(box.height),
            })
          }
        }
      } else if (gesture.kind === 'marquee') {
        const box = boxFromPoints(gesture.origin, gesture.point)
        // Le rectangle de sélection attrape les éléments de premier niveau :
        // un groupe est pris en entier, pas éclaté en ses membres.
        const hits = (store.design?.nodes ?? [])
          .filter((node) => node.parentId === null)
          .filter((node) => rectsIntersect(boundsOf(layout, node.id), box))
        store.setSelection(hits.map((node) => node.id))
      } else if (gesture.kind === 'remark' && store.design) {
        const remarks = useRemarkStore.getState()
        if (gesture.moved) {
          const area = clampToArtboard(boxFromPoints(gesture.origin, gesture.point), store.design.width, store.design.height)
          if (area.width >= MIN_AREA_PX && area.height >= MIN_AREA_PX) {
            remarks.openAreaComposer(area, elementsInArea(store.design.nodes, area))
          }
        } else if (gesture.nodeId) {
          const current = remarks.composer?.kind === 'node' ? remarks.composer.nodeId : null
          remarks.openNodeComposer(remarkTargetOf(nodes, gesture.nodeId, gesture.alt, current))
        } else {
          remarks.closeComposerIfEmpty()
        }
      }

      gestureRef.current = { kind: 'none' }
      setRubberBand(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [gestureTick, toDesignPoint, layout, nodes])

  if (!design) return null

  const selectionBox = remarking ? null : unionBoundsOf(layout, selectedIds)
  const singleSelection = selectedIds.length === 1 ? nodes.find((node) => node.id === selectedIds[0]) : undefined
  const resizable = !remarking && singleSelection && singleSelection.type !== 'group' ? singleSelection : undefined
  const editingNode = editingTextId ? nodes.find((node) => node.id === editingTextId) : undefined

  const beginGesture = (gesture: Gesture) => {
    gestureRef.current = gesture
    setGestureTick((tick) => tick + 1)
  }

  const beginPan = (event: React.PointerEvent) => {
    beginGesture({ kind: 'pan', clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y })
    event.preventDefault()
  }

  const startSurfaceGesture = (event: React.PointerEvent) => {
    // Espace maintenu ou clic molette : on déplace la vue, jamais le contenu.
    if (panMode || event.button === 1) {
      beginPan(event)
      return
    }
    if (event.button !== 0) return

    const point = toDesignPoint(event)
    if (remarking) {
      const screen = { x: event.clientX, y: event.clientY }
      beginGesture({ kind: 'remark', origin: point, point, screen, nodeId: null, alt: false, moved: false })
    } else if (tool === 'select') {
      // Un clic dans le vide coupe la série : deux clics sur un même élément
      // séparés par un clic ailleurs ne forment pas un double-clic.
      lastPressRef.current = null
      useDesignStore.getState().setSelection([])
      beginGesture({ kind: 'marquee', origin: point, point })
    } else {
      beginGesture({ kind: 'create', type: tool, origin: point, point })
    }
    event.preventDefault()
  }

  const startNodeGesture = (event: React.PointerEvent, node: DesignNode) => {
    if (panMode || event.button === 1) {
      beginPan(event)
      return
    }
    if (event.button !== 0) return
    if (remarking) {
      event.stopPropagation()
      const point = toDesignPoint(event)
      const screen = { x: event.clientX, y: event.clientY }
      beginGesture({ kind: 'remark', origin: point, point, screen, nodeId: node.id, alt: event.altKey, moved: false })
      return
    }
    if (tool !== 'select') return
    event.stopPropagation()

    const store = useDesignStore.getState()
    const doubleClick = isDoubleClick(lastPressRef.current, node.id, event)
    lastPressRef.current = { id: node.id, time: event.timeStamp, x: event.clientX, y: event.clientY }

    // Alt+clic vise l'élément exact ; le double-clic descend d'un cran vers lui ;
    // sinon on sélectionne son groupe le plus haut, ou le niveau déjà atteint.
    const targetId = instanceRootOf(
      event.altKey
        ? node.id
        : doubleClick
          ? drillTarget(nodes, node.id, store.selectedIds)
          : clickTarget(nodes, node.id, store.selectedIds, false)
    )

    if (event.shiftKey) {
      store.toggleSelection(targetId)
      return
    }

    // Plus rien à ouvrir sous le curseur : sur un texte, le cran suivant est son
    // édition. On ne démarre alors aucun geste, l'éditeur prend la main.
    if (doubleClick && targetId === node.id && node.type === 'text') {
      store.setSelection([node.id])
      store.setEditingText(node.id)
      return
    }

    const alreadySelected = store.selectedIds.includes(targetId)
    if (!alreadySelected) store.setSelection([targetId])

    const ids = alreadySelected ? store.selectedIds : [targetId]
    const startNodes = nodes.filter((candidate) => ids.includes(candidate.id))

    beginGesture({
      kind: 'move',
      origin: toDesignPoint(event),
      screen: { x: event.clientX, y: event.clientY },
      moved: false,
      startNodes: structuredClone(startNodes),
    })
  }

  const startResize = (event: React.PointerEvent, handle: HandleId) => {
    if (event.button !== 0 || !resizable) return
    event.stopPropagation()

    useDesignStore.getState().beginHistory()
    beginGesture({ kind: 'resize', handle, origin: toDesignPoint(event), startNode: structuredClone(resizable) })
  }

  const commitText = (value: string) => {
    const store = useDesignStore.getState()
    if (editingNode) store.patchNodes([editingNode.id], { text: value })
    store.setEditingText(null)
  }

  /** Rend récursivement l'arbre : un groupe devient un <g> transformé. */
  const renderNodes = (list: DesignNode[]): React.ReactNode[] =>
    list.map((node) => {
      if (node.type === 'group') {
        const bounds = boundsOf(layout, node.id)
        const origin = layout.origin.get(node.id) ?? { x: 0, y: 0 }
        const center = { cx: bounds.x + bounds.width / 2 - origin.x, cy: bounds.y + bounds.height / 2 - origin.y }
        return (
          <g
            key={node.id}
            className="canvas-group"
            transform={groupTransform(node, center)}
            opacity={node.opacity >= 1 ? undefined : node.opacity}
          >
            {renderNodes(children.get(node.id) ?? [])}
          </g>
        )
      }

      return (
        <g
          key={node.id}
          className="canvas-node"
          data-node-id={node.id}
          data-hidden={node.id === editingTextId || undefined}
          onPointerDown={(event) => startNodeGesture(event, node)}
          dangerouslySetInnerHTML={{ __html: nodeToSvg(node) }}
        />
      )
    })

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      data-pan={panMode || undefined}
      // Le viewport ne défile jamais : le navigateur le ferait pour amener un
      // champ de saisie à l'écran, et la vue, positionnée par transformation,
      // se décalerait sans que `pan` le sache.
      onScroll={(event) => {
        event.currentTarget.scrollTop = 0
        event.currentTarget.scrollLeft = 0
      }}
      onPointerDown={(event) => {
        // Clic dans le vide autour de la planche : désélectionne, ou déplace la
        // vue quand la barre espace est maintenue.
        if (panMode || event.button === 1) beginPan(event)
        else if (event.button === 0 && remarking) useRemarkStore.getState().closeComposerIfEmpty()
        else if (event.button === 0) useDesignStore.getState().setSelection([])
      }}
    >
      <div
        className="canvas-stage"
        style={{
          width: design.width * zoom,
          height: design.height * zoom,
          transform: `translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        <div
          ref={surfaceRef}
          className="canvas-surface"
          data-tool={tool}
          data-mode={remarking ? 'remarks' : undefined}
          style={{
            width: design.width,
            height: design.height,
            background: design.background,
            transform: `scale(${zoom})`,
          }}
          onPointerDown={startSurfaceGesture}
          onPointerMove={(event) => {
            if (!remarking || gestureRef.current.kind !== 'none') return
            const rawId = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
            const next = rawId === null ? null : remarkTargetOf(nodes, rawId, event.altKey, composerNodeId)
            if (next !== hoverId) setHoverId(next)
          }}
          onPointerLeave={() => setHoverId(null)}
        >
          <svg
            className="canvas-svg"
            width={design.width}
            height={design.height}
            viewBox={`0 0 ${design.width} ${design.height}`}
          >
            {renderNodes(children.get(null) ?? [])}

            {selectionBox && (
              <rect
                className="selection-frame"
                x={selectionBox.x}
                y={selectionBox.y}
                width={selectionBox.width}
                height={selectionBox.height}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {remarking && <RemarkShapes designId={design.id} layout={layout} hoverId={hoverId} />}

            {rubberBand && (
              <rect
                className={
                  rubberBand.kind === 'marquee'
                    ? 'marquee'
                    : rubberBand.kind === 'area'
                      ? 'remark-area-draft'
                      : 'creation-preview'
                }
                x={rubberBand.box.x}
                y={rubberBand.box.y}
                width={rubberBand.box.width}
                height={rubberBand.box.height}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>

        {/*
          Poignées et éditeur de texte vivent hors de la surface zoomée : leurs
          coordonnées sont donc multipliées par le zoom, mais leur taille à
          l'écran reste constante.
        */}
        {!panMode && resizable && <ResizeHandles node={resizable} layout={layout} zoom={zoom} onStart={startResize} />}

        {remarking && <RemarkLayer design={design} nodes={nodes} layout={layout} zoom={zoom} hoverId={hoverId} />}

        {!remarking && editingNode?.type === 'text' && (
          <TextEditor node={editingNode} box={boundsOf(layout, editingNode.id)} zoom={zoom} onCommit={commitText} />
        )}
      </div>
    </div>
  )
}

function ResizeHandles({
  node,
  layout,
  zoom,
  onStart,
}: {
  node: DesignNode
  layout: Layout
  zoom: number
  onStart: (event: React.PointerEvent, handle: HandleId) => void
}) {
  const box = boundsOf(layout, node.id)

  if (node.type === 'line') {
    // Une ligne se manipule par ses deux extrémités, pas par une boîte.
    const origin = spaceOriginOf(layout, node.parentId)
    return (
      <>
        <Handle
          cursor="move"
          left={(origin.x + node.x) * zoom}
          top={(origin.y + node.y) * zoom}
          onPointerDown={(event) => onStart(event, 'start')}
        />
        <Handle
          cursor="move"
          left={(origin.x + node.x + node.width) * zoom}
          top={(origin.y + node.y + node.height) * zoom}
          onPointerDown={(event) => onStart(event, 'end')}
        />
      </>
    )
  }

  return (
    <>
      {HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          cursor={handle.cursor}
          left={(box.x + box.width * handle.fx) * zoom}
          top={(box.y + box.height * handle.fy) * zoom}
          onPointerDown={(event) => onStart(event, handle.id)}
        />
      ))}
    </>
  )
}

function Handle({
  left,
  top,
  cursor,
  onPointerDown,
}: {
  left: number
  top: number
  cursor: string
  onPointerDown: (event: React.PointerEvent) => void
}) {
  return <div className="handle" style={{ left, top, cursor }} onPointerDown={onPointerDown} />
}

/** Éditeur de texte en place, calé sur la même métrique que le rendu SVG. */
function TextEditor({
  node,
  box,
  zoom,
  onCommit,
}: {
  node: DesignNode
  box: Box
  zoom: number
  onCommit: (value: string) => void
}) {
  const [value, setValue] = useState(node.text ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const metrics = textMetrics(node)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        // Échap ou Ctrl/Cmd+Entrée valident ; Entrée seule insère un retour à la ligne.
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) onCommit(value)
      }}
      style={{
        left: box.x * zoom,
        // Le bloc de lignes est centré dans la boîte au rendu : l'éditeur se
        // cale dessus, sinon le texte sauterait en entrant en édition.
        top: (box.y + metrics.blockOffset) * zoom,
        width: box.width * zoom,
        minHeight: metrics.blockHeight * zoom,
        fontSize: metrics.fontSize * zoom,
        lineHeight: `${metrics.lineStep * zoom}px`,
        fontFamily: node.fontFamily,
        fontWeight: node.fontWeight,
        fontStyle: node.fontStyle,
        textAlign: node.textAlign,
        color: node.color,
      }}
    />
  )
}

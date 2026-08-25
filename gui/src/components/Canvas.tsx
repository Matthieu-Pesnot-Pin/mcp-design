import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { groupTransform, nodeToSvg, normalizedBox, textMetrics } from '@shared/render'
import { boundsOf, childrenByParent, computeLayout, spaceOriginOf, unionBoundsOf, type Box, type Layout } from '@shared/tree'
import { clickTarget, useDesignStore } from '../store/useDesignStore'
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
  | { kind: 'move'; origin: Point; startNodes: DesignNode[] }
  | { kind: 'resize'; handle: HandleId; origin: Point; startNode: DesignNode }
  | { kind: 'marquee'; origin: Point; point: Point }
  | { kind: 'pan'; clientX: number; clientY: number; panX: number; panY: number }

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

  const viewportRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture>({ kind: 'none' })
  // Incrémenté à chaque début de geste : c'est ce qui (re)monte les écouteurs globaux.
  const [gestureTick, setGestureTick] = useState(0)
  const [rubberBand, setRubberBand] = useState<{ kind: 'create' | 'marquee'; box: Box } | null>(null)

  const nodes = useMemo(() => design?.nodes ?? [], [design])
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
      } else if (gesture.kind === 'move') {
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
        } else if (isClick) {
          // Simple clic : forme à la taille par défaut, ancrée au point cliqué.
          store.addNode(gesture.type, { x: round(gesture.origin.x), y: round(gesture.origin.y) })
        } else {
          const box = boxFromPoints(gesture.origin, gesture.point)
          store.addNode(gesture.type, {
            x: round(box.x),
            y: round(box.y),
            width: round(box.width),
            height: round(box.height),
          })
        }
      } else if (gesture.kind === 'marquee') {
        const box = boxFromPoints(gesture.origin, gesture.point)
        // Le rectangle de sélection attrape les éléments de premier niveau :
        // un groupe est pris en entier, pas éclaté en ses membres.
        const hits = (store.design?.nodes ?? [])
          .filter((node) => node.parentId === null)
          .filter((node) => rectsIntersect(boundsOf(layout, node.id), box))
        store.setSelection(hits.map((node) => node.id))
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
  }, [gestureTick, toDesignPoint, layout])

  if (!design) return null

  const selectionBox = unionBoundsOf(layout, selectedIds)
  const singleSelection = selectedIds.length === 1 ? nodes.find((node) => node.id === selectedIds[0]) : undefined
  const resizable = singleSelection && singleSelection.type !== 'group' ? singleSelection : undefined
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
    if (tool === 'select') {
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
    if (event.button !== 0 || tool !== 'select') return
    event.stopPropagation()

    const store = useDesignStore.getState()
    // Alt+clic vise l'élément exact ; sinon on sélectionne son groupe le plus haut.
    const targetId = clickTarget(nodes, node.id, event.altKey)

    if (event.shiftKey) {
      store.toggleSelection(targetId)
      return
    }

    const alreadySelected = store.selectedIds.includes(targetId)
    if (!alreadySelected) store.setSelection([targetId])

    const ids = alreadySelected ? store.selectedIds : [targetId]
    const startNodes = nodes.filter((candidate) => ids.includes(candidate.id))

    store.beginHistory()
    beginGesture({ kind: 'move', origin: toDesignPoint(event), startNodes: structuredClone(startNodes) })
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
          data-hidden={node.id === editingTextId || undefined}
          onPointerDown={(event) => startNodeGesture(event, node)}
          onDoubleClick={(event) => {
            if (node.type !== 'text') return
            event.stopPropagation()
            useDesignStore.getState().setSelection([node.id])
            useDesignStore.getState().setEditingText(node.id)
          }}
          dangerouslySetInnerHTML={{ __html: nodeToSvg(node) }}
        />
      )
    })

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      data-pan={panMode || undefined}
      onPointerDown={(event) => {
        // Clic dans le vide autour de la planche : désélectionne, ou déplace la
        // vue quand la barre espace est maintenue.
        if (panMode || event.button === 1) beginPan(event)
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
          style={{
            width: design.width,
            height: design.height,
            background: design.background,
            transform: `scale(${zoom})`,
          }}
          onPointerDown={startSurfaceGesture}
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

            {rubberBand && (
              <rect
                className={rubberBand.kind === 'marquee' ? 'marquee' : 'creation-preview'}
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

        {editingNode?.type === 'text' && (
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
        top: box.y * zoom,
        width: box.width * zoom,
        minHeight: box.height * zoom,
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { nodeToSvg, normalizedBox, textMetrics } from '@shared/render'
import { useDesignStore } from '../store/useDesignStore'
import { boundingBox, rectsIntersect, round } from '../utils/nodes'
import type { DesignNode, Tool } from '../types'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

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
  const selectedIds = useDesignStore((state) => state.selectedIds)
  const editingTextId = useDesignStore((state) => state.editingTextId)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture>({ kind: 'none' })
  // Incrémenté à chaque début de geste : c'est ce qui (re)monte les écouteurs globaux.
  const [gestureTick, setGestureTick] = useState(0)
  const [rubberBand, setRubberBand] = useState<{ kind: 'create' | 'marquee'; box: Box } | null>(null)

  /** Coordonnées document à partir d'un évènement pointeur, quel que soit le zoom. */
  const toDesignPoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
    },
    [zoom]
  )

  useEffect(() => {
    if (gestureRef.current.kind === 'none') return

    const handleMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      const point = toDesignPoint(event)
      const store = useDesignStore.getState()

      if (gesture.kind === 'create') {
        gesture.point = point
        setRubberBand({ kind: 'create', box: boxFromPoints(gesture.origin, point) })
      } else if (gesture.kind === 'marquee') {
        gesture.point = point
        setRubberBand({ kind: 'marquee', box: boxFromPoints(gesture.origin, point) })
      } else if (gesture.kind === 'move') {
        const dx = point.x - gesture.origin.x
        const dy = point.y - gesture.origin.y
        const moved = new Map(
          gesture.startNodes.map((node) => [node.id, { x: round(node.x + dx), y: round(node.y + dy) }])
        )
        const current = store.design
        if (!current) return
        store.replaceNodes(
          current.nodes.map((node) => {
            const position = moved.get(node.id)
            return position ? { ...node, ...position } : node
          }),
          { history: false }
        )
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
        const hits = (store.design?.nodes ?? []).filter((node) => rectsIntersect(normalizedBox(node), box))
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
  }, [gestureTick, toDesignPoint])

  if (!design) return null

  const selected = design.nodes.filter((node) => selectedIds.includes(node.id))
  const selectionBox = boundingBox(selected)
  const singleSelection = selected.length === 1 ? selected[0] : null
  const editingNode = editingTextId ? design.nodes.find((node) => node.id === editingTextId) : undefined

  const beginGesture = (gesture: Gesture) => {
    gestureRef.current = gesture
    setGestureTick((tick) => tick + 1)
  }

  const startSurfaceGesture = (event: React.PointerEvent) => {
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
    if (event.button !== 0 || tool !== 'select') return
    event.stopPropagation()

    const store = useDesignStore.getState()
    if (event.shiftKey) {
      store.toggleSelection(node.id)
      return
    }

    const alreadySelected = store.selectedIds.includes(node.id)
    if (!alreadySelected) store.setSelection([node.id])

    const ids = alreadySelected ? store.selectedIds : [node.id]
    const startNodes = (store.design?.nodes ?? []).filter((candidate) => ids.includes(candidate.id))

    store.beginHistory()
    beginGesture({ kind: 'move', origin: toDesignPoint(event), startNodes: structuredClone(startNodes) })
  }

  const startResize = (event: React.PointerEvent, handle: HandleId) => {
    if (event.button !== 0 || !singleSelection) return
    event.stopPropagation()

    useDesignStore.getState().beginHistory()
    beginGesture({
      kind: 'resize',
      handle,
      origin: toDesignPoint(event),
      startNode: structuredClone(singleSelection),
    })
  }

  const commitText = (value: string) => {
    const store = useDesignStore.getState()
    if (editingNode) store.patchNodes([editingNode.id], { text: value })
    store.setEditingText(null)
  }

  return (
    <div className="canvas-scroll">
      <div className="canvas-stage" style={{ width: design.width * zoom, height: design.height * zoom }}>
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
            {design.nodes.map((node) => (
              <g
                key={node.id}
                className="canvas-node"
                data-hidden={node.id === editingTextId || undefined}
                onPointerDown={(event) => startNodeGesture(event, node)}
                onDoubleClick={(event) => {
                  if (node.type !== 'text') return
                  event.stopPropagation()
                  useDesignStore.getState().setEditingText(node.id)
                }}
                dangerouslySetInnerHTML={{ __html: nodeToSvg(node) }}
              />
            ))}

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
        {singleSelection?.type === 'line' && (
            <>
              <ResizeHandle
                cursor="move"
                left={singleSelection.x * zoom}
                top={singleSelection.y * zoom}
                onPointerDown={(event) => startResize(event, 'start')}
              />
              <ResizeHandle
                cursor="move"
                left={(singleSelection.x + singleSelection.width) * zoom}
                top={(singleSelection.y + singleSelection.height) * zoom}
                onPointerDown={(event) => startResize(event, 'end')}
              />
            </>
          )}

          {singleSelection &&
            singleSelection.type !== 'line' &&
            HANDLES.map((handle) => {
              const box = normalizedBox(singleSelection)
              return (
                <ResizeHandle
                  key={handle.id}
                  cursor={handle.cursor}
                  left={(box.x + box.width * handle.fx) * zoom}
                  top={(box.y + box.height * handle.fy) * zoom}
                  onPointerDown={(event) => startResize(event, handle.id)}
                />
              )
            })}

        {editingNode?.type === 'text' && <TextEditor node={editingNode} zoom={zoom} onCommit={commitText} />}
      </div>
    </div>
  )
}

function ResizeHandle({
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
function TextEditor({ node, zoom, onCommit }: { node: DesignNode; zoom: number; onCommit: (value: string) => void }) {
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
        left: node.x * zoom,
        top: node.y * zoom,
        width: node.width * zoom,
        minHeight: node.height * zoom,
        fontSize: (metrics.fontSize ?? 24) * zoom,
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

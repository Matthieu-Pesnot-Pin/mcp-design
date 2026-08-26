import { useCallback, useRef } from 'react'

export const PANEL_LIMITS = { min: 180, max: 520 }

/**
 * Poignée de redimensionnement d'un panneau latéral.
 *
 * La largeur vit chez l'appelant (App), pas ici : le geste doit rester capable
 * de repartir de la largeur réelle au moment du pointerdown, sinon un second
 * glissement recommencerait depuis la valeur initiale.
 */
export function PanelResizer({
  side,
  width,
  onResize,
  onCommit,
}: {
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
  onCommit?: (width: number) => void
}) {
  const startRef = useRef({ x: 0, width: 0 })
  const latestRef = useRef(width)

  const clamp = (value: number) => Math.min(PANEL_LIMITS.max, Math.max(PANEL_LIMITS.min, Math.round(value)))

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const handle = event.currentTarget
      startRef.current = { x: event.clientX, width }
      latestRef.current = width
      handle.setPointerCapture(event.pointerId)

      const move = (moveEvent: PointerEvent) => {
        // Le panneau de droite grandit quand le curseur va vers la gauche.
        const delta = moveEvent.clientX - startRef.current.x
        const next = clamp(startRef.current.width + (side === 'left' ? delta : -delta))
        latestRef.current = next
        onResize(next)
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        onCommit?.(latestRef.current)
      }

      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
      event.preventDefault()
    },
    [onCommit, onResize, side, width]
  )

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Redimensionner la liste des pages' : 'Redimensionner le panneau de propriétés'}
      onPointerDown={onPointerDown}
      // Double-clic : retour à la largeur par défaut, comme dans un éditeur de code.
      onDoubleClick={() => {
        const reset = side === 'left' ? 232 : 268
        onResize(reset)
        onCommit?.(reset)
      }}
    />
  )
}

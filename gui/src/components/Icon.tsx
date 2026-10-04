import { iconElements } from '@shared/icons/index'
import { iconElementToSvg } from '@shared/render'

/** Icône Lucide de la bibliothèque embarquée, dessinée dans la couleur du texte. */
export function Icon({ name, size = 14, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const elements = iconElements(name)
  if (!elements) throw new Error(`Unknown icon "${name}".`)
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: elements.map(iconElementToSvg).join('') }}
    />
  )
}

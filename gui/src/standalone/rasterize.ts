import { regionToSvg, subtreeToSvg, type RenderDocument, type RenderNode } from '@shared/render'
import type { Box } from '@shared/tree'
import type { Design } from '@shared/schemas/design.schema'
import { INTER_FONT_CSS } from './fonts'

/** Côté maximal d'un PNG produit, comme `screenshot_design`. */
const MAX_DIMENSION = 1568

export function documentOf(design: Design): RenderDocument {
  return {
    name: design.name,
    width: design.width,
    height: design.height,
    background: design.background,
    nodes: design.nodes as RenderNode[],
  }
}

function svgSize(svg: string): { width: number; height: number } {
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  return { width, height }
}

/** Ajoute la police embarquée juste après la balise ouvrante du SVG. */
function withFont(svg: string): string {
  const end = svg.indexOf('>')
  return `${svg.slice(0, end + 1)}<style>${INTER_FONT_CSS}</style>${svg.slice(end + 1)}`
}

/** Rasterise un SVG en PNG (data URI), réduit pour tenir dans MAX_DIMENSION. */
export async function svgToPng(svg: string, scale = 1): Promise<string> {
  const source = svgSize(svg)
  if (!(source.width > 0) || !(source.height > 0)) throw new Error('Nothing to capture: the requested area has no size.')
  const factor = Math.min(scale, MAX_DIMENSION / Math.max(source.width, source.height))

  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withFont(svg))}`
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * factor))
  canvas.height = Math.max(1, Math.round(source.height * factor))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/** Capture d'un élément et de son contenu, avec une marge. */
export function captureNode(design: Design, nodeId: string, padding: number): Promise<string> {
  return svgToPng(subtreeToSvg(documentOf(design), nodeId, padding))
}

/** Capture d'une zone de la planche, en coordonnées document. */
export function captureRegion(design: Design, region: Box): Promise<string> {
  return svgToPng(regionToSvg(documentOf(design), region))
}

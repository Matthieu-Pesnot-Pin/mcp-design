import { regionToSvg } from '@shared/render'
import type { Box } from '@shared/tree'
import type { Design } from '@shared/schemas/design.schema'
import { syncedDesign } from '@core/design-model'
import { recapText } from '@core/exchange'
import type { FeedbackRound } from '../types'
import { currentProject, updateProject } from './project'
import { documentOf, svgToPng } from './rasterize'

const OUTLINE = '#7c3aed'

const PIN_RADIUS = 15

/**
 * Contour et pastille numérotée de chaque remarque du retour posée sur la page.
 * La pastille marque le coin haut gauche de la cible, ramenée dans la planche.
 */
function remarkOverlay(round: FeedbackRound, design: Design): string {
  const inside = (value: number, max: number) => Math.min(Math.max(value, PIN_RADIUS + 2), max - PIN_RADIUS - 2)
  return round.remarks
    .filter((remark) => remark.designId === design.id && remark.target.kind !== 'page')
    .map((remark) => {
      const box = (remark.target as { box: Box }).box
      const label = String(remark.number ?? '')
      const cx = inside(box.x, design.width)
      const cy = inside(box.y, design.height)
      return (
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" ` +
        `stroke="${OUTLINE}" stroke-width="3" stroke-dasharray="8 5" />` +
        `<circle cx="${cx}" cy="${cy}" r="${PIN_RADIUS}" fill="${OUTLINE}" stroke="#ffffff" stroke-width="2" />` +
        `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" ` +
        `font-weight="700" fill="#ffffff">${label}</text>`
      )
    })
    .join('')
}

function pageOverview(design: Design, round: FeedbackRound): Promise<string> {
  const svg = regionToSvg(documentOf(design), { x: 0, y: 0, width: design.width, height: design.height })
  return svgToPng(svg.replace(/<\/svg>$/, `${remarkOverlay(round, design)}</svg>`))
}

export interface Recap {
  text: string
  /** Images jointes, nom de fichier et data URI PNG. */
  images: { name: string; href: string }[]
  /** Nom du fichier texte. */
  textName: string
  /** Nom de l'archive qui réunit le texte et les images. */
  zipName: string
}

/** Texte et images du récap d'un retour, d'après l'état courant du projet. */
export async function buildRecap(round: FeedbackRound): Promise<Recap> {
  const project = currentProject()
  const base = `recap-retour-${round.number}`
  const images: Recap['images'] = []

  const pages = new Map<string, string>()
  for (const designId of new Set(round.remarks.map((remark) => remark.designId))) {
    const design = project.designs.find((candidate) => candidate.id === designId)
    if (!design) continue
    const name = `${base}-page-${design.id}.png`
    pages.set(design.id, name)
    images.push({ name, href: await pageOverview(design, round) })
  }

  const captures: string[] = []
  for (const remark of round.remarks) {
    if (!remark.capture) continue
    const href = project.captures[remark.capture]
    if (href === undefined) throw new Error(`La capture de la remarque ${remark.id} manque au projet.`)
    const name = `${base}-image-${captures.length + 1}.png`
    captures.push(name)
    images.push({ name, href })
  }

  return { text: recapText(round, project.designs, { pages, captures }), images, textName: `${base}.md`, zipName: `${base}.zip` }
}

/**
 * Le récap transmet l'état courant des pages : il devient leur référence, et
 * le filtre « À synchroniser » ne retient plus que ce qui a changé depuis.
 */
export function markRecapSent(round: FeedbackRound) {
  const ids = new Set(round.remarks.map((remark) => remark.designId))
  const now = new Date().toISOString()
  updateProject((project) => {
    project.designs = project.designs.map((design) => (ids.has(design.id) ? syncedDesign(design, now) : design))
  })
}

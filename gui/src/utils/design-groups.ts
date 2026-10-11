import type { DesignSummary } from '../types'

export const GROUP_SEPARATOR = '/'

/**
 * Un groupe de pages n'est pas une entité stockée : c'est le chemin porté par
 * chaque page. L'arbre est donc reconstruit à l'affichage, ce qui évite d'avoir
 * à créer, renommer ou nettoyer des groupes vides.
 */
export interface GroupBranch {
  /** Dernier segment du chemin — ce qui s'affiche. */
  name: string
  /** Chemin complet, "Parent/Enfant". Vide à la racine. */
  path: string
  children: GroupBranch[]
  designs: DesignSummary[]
  /** Nombre de pages du groupe, sous-groupes compris. */
  total: number
}

function emptyBranch(name: string, path: string): GroupBranch {
  return { name, path, children: [], designs: [], total: 0 }
}

export function buildGroupTree(designs: DesignSummary[]): GroupBranch {
  const root = emptyBranch('', '')

  for (const design of designs) {
    const segments = (design.group ?? '').split(GROUP_SEPARATOR).filter((segment) => segment.trim() !== '')

    let branch = root
    for (const segment of segments) {
      const path = branch.path === '' ? segment : `${branch.path}${GROUP_SEPARATOR}${segment}`
      let child = branch.children.find((candidate) => candidate.path === path)
      if (!child) {
        child = emptyBranch(segment, path)
        branch.children.push(child)
      }
      branch = child
    }
    branch.designs.push(design)
  }

  const countUp = (branch: GroupBranch): number => {
    branch.children.sort((a, b) => compareNames(a.name, b.name))
    branch.designs.sort((a, b) => compareNames(a.name, b.name))
    branch.total = branch.designs.length + branch.children.reduce((sum, child) => sum + countUp(child), 0)
    return branch.total
  }
  countUp(root)
  return root
}

/** Ordre alphabétique, insensible à la casse et aux accents, « Page 2 » avant « Page 10 ». */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/** Première page dans l'ordre d'affichage de l'arbre : les pages d'un niveau, puis ses sous-groupes. */
export function firstDesignOf(branch: GroupBranch): DesignSummary | null {
  if (branch.designs.length > 0) return branch.designs[0]
  for (const child of branch.children) {
    const first = firstDesignOf(child)
    if (first) return first
  }
  return null
}

/** Tous les chemins de groupe existants, pour l'autocomplétion à la création. */
export function groupPaths(designs: DesignSummary[]): string[] {
  const paths = new Set<string>()
  for (const design of designs) {
    const segments = (design.group ?? '').split(GROUP_SEPARATOR).filter((segment) => segment.trim() !== '')
    for (let i = 1; i <= segments.length; i++) paths.add(segments.slice(0, i).join(GROUP_SEPARATOR))
  }
  return [...paths].sort()
}

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

/** Branche d'un chemin de groupe, ou null si aucun groupe ne porte ce chemin. */
export function findBranch(root: GroupBranch, path: string): GroupBranch | null {
  if (root.path === path) return root
  for (const child of root.children) {
    if (path === child.path || path.startsWith(`${child.path}${GROUP_SEPARATOR}`)) return findBranch(child, path)
  }
  return null
}

/**
 * Copie de l'arbre réduite aux pages qui passent le filtre. Un groupe sans
 * page retenue, sous-groupes compris, disparaît ; les compteurs suivent.
 */
export function filterTree(branch: GroupBranch, keep: (design: DesignSummary) => boolean): GroupBranch {
  const children = branch.children.map((child) => filterTree(child, keep)).filter((child) => child.total > 0)
  const designs = branch.designs.filter(keep)
  return {
    ...branch,
    children,
    designs,
    total: designs.length + children.reduce((sum, child) => sum + child.total, 0),
  }
}

/**
 * Copie de l'arbre réduite à ce qui correspond à une recherche. Un groupe dont
 * le nom correspond est gardé en entier ; sinon, seuls ses sous-groupes et ses
 * pages qui correspondent restent.
 */
export function searchTree(branch: GroupBranch, matches: (text: string) => boolean): GroupBranch {
  const children = branch.children
    .map((child) => (matches(child.name) ? child : searchTree(child, matches)))
    .filter((child) => child.total > 0)
  const designs = branch.designs.filter((design) => matches(design.name))
  return {
    ...branch,
    children,
    designs,
    total: designs.length + children.reduce((sum, child) => sum + child.total, 0),
  }
}

/** Chemins de tous les groupes contenus dans une branche, à toute profondeur. */
export function branchPaths(branch: GroupBranch): string[] {
  return branch.children.flatMap((child) => [child.path, ...branchPaths(child)])
}

/** Toutes les pages d'une branche, sous-groupes compris. */
export function designsOf(branch: GroupBranch): DesignSummary[] {
  return [...branch.designs, ...branch.children.flatMap(designsOf)]
}

/** Deux lettres pour l'avatar d'un groupe : initiales des deux premiers mots, ou deux premières lettres. */
export function groupInitials(name: string): string {
  const words = name.split(/[\s_-]+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
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

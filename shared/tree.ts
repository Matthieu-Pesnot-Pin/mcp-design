import type { RenderNode } from "./render.js";

/**
 * Hiérarchie des éléments.
 *
 * Le stockage reste une liste plate — c'est ce qui garde le diff lisible et le
 * fichier JSON diffable — mais chaque élément porte un `parentId`. Les
 * coordonnées d'un élément sont exprimées **dans l'espace de son parent** :
 * déplacer un groupe ne change donc qu'un seul champ, et l'export HTML devient
 * une simple imbrication de div positionnées.
 *
 * Ce module ne dépend d'aucune librairie : il est importé aussi bien par le
 * serveur MCP que par le canvas dans le navigateur.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Boîte englobante normalisée (largeur/hauteur toujours positives). */
export function normalizedBox(node: { x: number; y: number; width: number; height: number }): Box {
  const x = node.width < 0 ? node.x + node.width : node.x;
  const y = node.height < 0 ? node.y + node.height : node.y;
  return { x, y, width: Math.abs(node.width), height: Math.abs(node.height) };
}

export interface HierarchyNode {
  id: string;
  parentId: string | null;
}

/** Enfants directs de chaque parent, dans l'ordre du tableau (donc l'ordre d'empilement). */
export function childrenByParent<T extends HierarchyNode>(nodes: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const node of nodes) {
    const siblings = map.get(node.parentId);
    if (siblings) siblings.push(node);
    else map.set(node.parentId, [node]);
  }
  return map;
}

export function rootNodes<T extends HierarchyNode>(nodes: T[]): T[] {
  return nodes.filter((node) => node.parentId === null);
}

/** Chaîne des ancêtres, du parent direct jusqu'à la racine. */
export function ancestorsOf<T extends HierarchyNode>(nodes: T[], id: string): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: T[] = [];
  let current = byId.get(id)?.parentId ?? null;

  // La borne empêche une boucle infinie si un cycle a échappé à la validation.
  while (current !== null && chain.length <= nodes.length) {
    const parent = byId.get(current);
    if (!parent) break;
    chain.push(parent);
    current = parent.parentId;
  }
  return chain;
}

/** Ancêtre le plus haut d'un élément, ou l'élément lui-même s'il est à la racine. */
export function outermostAncestor<T extends HierarchyNode>(nodes: T[], id: string): T | undefined {
  const chain = ancestorsOf(nodes, id);
  return chain.length > 0 ? chain[chain.length - 1] : nodes.find((node) => node.id === id);
}

/** Identifiants de tous les descendants d'un élément (lui-même exclu). */
export function descendantIds<T extends HierarchyNode>(nodes: T[], id: string): Set<string> {
  const children = childrenByParent(nodes);
  const found = new Set<string>();
  const queue = [id];

  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      queue.push(child.id);
    }
  }
  return found;
}

/**
 * Réécrit la liste à plat en parcours préfixe : chaque parent est suivi de son
 * sous-arbre. L'ordre relatif entre frères — donc l'empilement — est préservé.
 *
 * Le stockage garde ainsi une forme unique pour un même arbre, ce qui évite au
 * diff de signaler un réordonnancement là où rien n'a bougé visuellement.
 */
export function flattenPreOrder<T extends HierarchyNode>(nodes: T[]): T[] {
  const children = childrenByParent(nodes);
  const emitted = new Set<string>();
  const result: T[] = [];

  const visit = (node: T) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    result.push(node);
    for (const child of children.get(node.id) ?? []) visit(child);
  };

  for (const node of children.get(null) ?? []) visit(node);
  // Filet : un noeud dont le parent a disparu reste dans la liste plutôt que d'être perdu.
  for (const node of nodes) visit(node);
  return result;
}

export interface Layout {
  /** Position, en coordonnées document, de l'origine de l'espace d'un groupe. */
  origin: Map<string, Point>;
  /** Boîte englobante, en coordonnées document, de chaque élément. */
  bounds: Map<string, Box>;
}

const ORIGIN: Point = { x: 0, y: 0 };

function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Résout toute la hiérarchie en coordonnées document, en une passe.
 *
 * La rotation n'entre pas dans le calcul des boîtes : comme pour un rectangle
 * pivoté, la boîte d'un groupe pivoté reste sa boîte non pivotée. C'est ce que
 * le cadre de sélection affiche déjà, et le rendu, lui, applique bien la rotation.
 */
export function computeLayout(nodes: RenderNode[]): Layout {
  const children = childrenByParent(nodes);
  const origin = new Map<string, Point>();
  const bounds = new Map<string, Box>();

  const visit = (node: RenderNode, spaceOrigin: Point): Box => {
    if (node.type !== "group") {
      const local = normalizedBox(node);
      const box = { x: spaceOrigin.x + local.x, y: spaceOrigin.y + local.y, width: local.width, height: local.height };
      bounds.set(node.id, box);
      return box;
    }

    const groupOrigin = { x: spaceOrigin.x + node.x, y: spaceOrigin.y + node.y };
    origin.set(node.id, groupOrigin);

    const childBoxes = (children.get(node.id) ?? []).map((child) => visit(child, groupOrigin));
    // Un groupe vide n'a pas de contenu à englober : il reste un point, ce qui
    // le laisse sélectionnable dans la liste des calques sans polluer le canvas.
    const box = unionBox(childBoxes) ?? { x: groupOrigin.x, y: groupOrigin.y, width: 0, height: 0 };
    bounds.set(node.id, box);
    return box;
  };

  for (const node of children.get(null) ?? []) visit(node, ORIGIN);

  // Les éléments dont le parent a disparu sont rendus à la racine plutôt que
  // d'être silencieusement invisibles.
  for (const node of nodes) {
    if (!bounds.has(node.id)) visit(node, ORIGIN);
  }

  return { origin, bounds };
}

/** Origine de l'espace de coordonnées dans lequel vit un élément. */
export function spaceOriginOf(layout: Layout, parentId: string | null): Point {
  return (parentId === null ? undefined : layout.origin.get(parentId)) ?? ORIGIN;
}

export function boundsOf(layout: Layout, id: string): Box {
  return layout.bounds.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Vrai si les deux boîtes ont une surface commune ; un simple contact ne compte pas. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Boîte englobante commune à plusieurs éléments, en coordonnées document. */
export function unionBoundsOf(layout: Layout, ids: string[]): Box | null {
  return unionBox(ids.map((id) => layout.bounds.get(id)).filter((box): box is Box => box !== undefined));
}

// --- Ordre d'empilement -----------------------------------------------------

export const REORDER_DIRECTIONS = ["front", "back", "forward", "backward"] as const;
export type ReorderDirection = (typeof REORDER_DIRECTIONS)[number];

/**
 * Retire d'une sélection les éléments dont un ancêtre est déjà sélectionné.
 *
 * Déplacer un enfant en même temps que son groupe n'a pas de sens : le groupe
 * emporte déjà son contenu, et les deux gestes s'appliqueraient dans des
 * fratries différentes.
 */
export function withoutRedundantDescendants<T extends HierarchyNode>(nodes: T[], ids: string[]): string[] {
  const selected = new Set(ids);
  return ids.filter((id) => !ancestorsOf(nodes, id).some((ancestor) => selected.has(ancestor.id)));
}

/**
 * Change l'ordre d'empilement d'un ou plusieurs éléments.
 *
 * L'empilement est **relatif à la fratrie** : un élément ne peut passer devant
 * que ses frères, jamais devant le contenu d'un autre groupe — c'est le groupe
 * lui-même qu'il faut alors déplacer. Chaque fratrie concernée est réordonnée
 * indépendamment, puis la liste plate est reconstruite en parcours préfixe.
 *
 * `forward`/`backward` décalent d'un cran ; `front`/`back` vont au bout. Un
 * élément déjà au bout de sa fratrie ne bouge pas, et un lot d'éléments garde
 * son ordre relatif d'origine.
 */
export function reorderNodes<T extends HierarchyNode>(
  nodes: T[],
  ids: string[],
  direction: ReorderDirection
): T[] {
  const targets = new Set(withoutRedundantDescendants(nodes, ids));
  if (targets.size === 0) return nodes;

  const children = childrenByParent(nodes);
  for (const [parentId, siblings] of children) {
    const moving = siblings.filter((node) => targets.has(node.id));
    if (moving.length === 0) continue;

    let next = [...siblings];
    if (direction === "front") {
      next = [...next.filter((node) => !targets.has(node.id)), ...moving];
    } else if (direction === "back") {
      next = [...moving, ...next.filter((node) => !targets.has(node.id))];
    } else {
      const step = direction === "forward" ? 1 : -1;
      const indexes = next.map((node, index) => (targets.has(node.id) ? index : -1)).filter((index) => index >= 0);
      // On part du bord vers lequel on pousse, sinon deux éléments adjacents se
      // marchent dessus et le lot se désagrège.
      for (const index of step === 1 ? indexes.reverse() : indexes) {
        const swap = index + step;
        if (swap < 0 || swap >= next.length || targets.has(next[swap].id)) continue;
        [next[index], next[swap]] = [next[swap], next[index]];
      }
    }
    children.set(parentId, next);
  }

  const emitted = new Set<string>();
  const flat: T[] = [];
  const visit = (parentId: string | null) => {
    for (const node of children.get(parentId) ?? []) {
      if (emitted.has(node.id)) continue;
      emitted.add(node.id);
      flat.push(node);
      visit(node.id);
    }
  };
  visit(null);
  // Filet identique à flattenPreOrder : un noeud dont le parent a disparu reste
  // dans la liste plutôt que d'être perdu.
  for (const node of nodes) {
    if (!emitted.has(node.id)) {
      emitted.add(node.id);
      flat.push(node);
    }
  }
  return flat;
}

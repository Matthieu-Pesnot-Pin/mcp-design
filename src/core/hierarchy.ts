import type { DesignNode } from "../../shared/schemas/design.schema.js";
import type { RenderNode } from "../../shared/render.js";
import { boundsOf, computeLayout, descendantIds, flattenPreOrder } from "../../shared/tree.js";
import { DesignError } from "./node-factory.js";

/**
 * Invariants de la hiérarchie, appliqués à chaque mutation.
 *
 * Une planche dont un `parentId` pend dans le vide ou boucle sur elle-même est
 * irréparable côté GUI : on refuse l'écriture plutôt que de rendre un design
 * partiellement invisible.
 */
export function validateHierarchy(nodes: DesignNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const duplicates = nodes.filter((node, index) => nodes.findIndex((other) => other.id === node.id) !== index);
  if (duplicates.length > 0) {
    throw new DesignError(`Duplicate node id(s): ${[...new Set(duplicates.map((n) => n.id))].join(", ")}.`);
  }

  for (const node of nodes) {
    if (node.parentId === null) continue;

    const parent = byId.get(node.parentId);
    if (!parent) {
      throw new DesignError(`Node "${node.id}" references a parent "${node.parentId}" that does not exist.`);
    }
    if (parent.type !== "group") {
      throw new DesignError(
        `Node "${node.id}" cannot be parented to "${parent.id}" because it is a "${parent.type}", not a group.`
      );
    }

    // Un cycle rendrait le calcul de disposition infini.
    let cursor: DesignNode | undefined = parent;
    const seen = new Set<string>([node.id]);
    while (cursor) {
      if (seen.has(cursor.id)) {
        throw new DesignError(`Node "${node.id}" would create a cycle through group "${parent.id}".`);
      }
      seen.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }
}

/**
 * Recalcule la taille de chaque groupe à partir de son contenu. Ces champs sont
 * dérivés : ils existent pour que l'agent puisse lire l'encombrement d'un
 * groupe sans refaire le calcul, jamais pour être écrits.
 */
export function recomputeGroupSizes(nodes: DesignNode[]): DesignNode[] {
  if (!nodes.some((node) => node.type === "group")) return nodes;

  const layout = computeLayout(nodes as RenderNode[]);
  return nodes.map((node) => {
    if (node.type !== "group") return node;
    const box = boundsOf(layout, node.id);
    if (node.width === box.width && node.height === box.height) return node;
    return { ...node, width: box.width, height: box.height };
  });
}

export function normalizeHierarchy(nodes: DesignNode[]): DesignNode[] {
  validateHierarchy(nodes);
  return recomputeGroupSizes(flattenPreOrder(nodes));
}

/** Un élément et tous ses descendants — ce qu'une suppression de groupe emporte. */
export function withDescendants(nodes: DesignNode[], ids: string[]): Set<string> {
  const all = new Set<string>(ids);
  for (const id of ids) {
    for (const descendant of descendantIds(nodes, id)) all.add(descendant);
  }
  return all;
}

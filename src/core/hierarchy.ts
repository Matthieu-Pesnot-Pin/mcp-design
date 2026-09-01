import type { DesignNode } from "../../shared/schemas/design.schema.js";
import type { RenderNode } from "../../shared/render.js";
import { boundsOf, childrenByParent, computeLayout, descendantIds, flattenPreOrder } from "../../shared/tree.js";
import { expandInstances } from "../../shared/instances.js";
import { SIZE_DERIVED_KINDS } from "../../shared/node-defaults.js";
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
      // Le contenu d'une instance appartient a son composant : rien ne s'y
      // ajoute, ne s'y deplace ni ne s'y reordonne — c'est la meme regle que
      // dans Figma, et elle tombe toute seule d'un stockage sans sous-arbre.
      const hint =
        parent.type === "instance"
          ? ` The content of an instance belongs to its component: edit the group "${parent.componentId}" instead, or run detach_instances on "${parent.id}" to turn this copy into ordinary nodes.`
          : "";
      throw new DesignError(
        `Node "${node.id}" cannot be parented to "${parent.id}" because it is a "${parent.type}", not a group.${hint}`
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
 * Invariants propres aux instances : un lien valide, et aucun cycle.
 *
 * Un cycle (un composant qui contient, meme indirectement, une instance de
 * lui-meme) rendrait l'expansion infinie. Le rendu s'en protege par un plafond
 * de profondeur ; ici on refuse simplement de l'ecrire.
 */
function validateInstances(nodes: DesignNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const instances = nodes.filter((node) => node.type === "instance");

  for (const node of nodes) {
    if (node.type !== "instance" && node.componentId !== undefined) {
      throw new DesignError(`"componentId" only applies to an "instance" node, but "${node.id}" is a "${node.type}".`);
    }
  }
  if (instances.length === 0) return;

  const childrenOf = childrenByParent(nodes);

  for (const instance of instances) {
    const source = instance.componentId === undefined ? undefined : byId.get(instance.componentId);
    if (!source) {
      throw new DesignError(
        `Instance "${instance.id}" points at a component "${instance.componentId}" that does not exist in this design. ` +
          `componentId must be the id of a group of the same design.`
      );
    }
    if (source.type !== "group") {
      throw new DesignError(
        `Instance "${instance.id}" points at "${source.id}", which is a "${source.type}". Only a group can be instantiated — ` +
          `group the block first with group_nodes.`
      );
    }

    // Parcours du contenu du composant : s'il ramene a un composant deja
    // traverse, l'expansion boucle.
    const seen = new Set<string>([source.id]);
    const queue = [source.id];
    while (queue.length > 0) {
      for (const child of childrenOf.get(queue.pop()!) ?? []) {
        const target = child.type === "instance" ? (child.componentId ?? "") : child.id;
        if (child.type === "instance" && seen.has(target)) {
          throw new DesignError(
            `Instance "${instance.id}" would make component "${source.id}" contain itself (through "${child.id}"). ` +
              `A component cannot be nested inside itself.`
          );
        }
        if (seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
  }
}

/**
 * Recalcule la taille de chaque groupe à partir de son contenu. Ces champs sont
 * dérivés : ils existent pour que l'agent puisse lire l'encombrement d'un
 * groupe sans refaire le calcul, jamais pour être écrits.
 */
export function recomputeGroupSizes(nodes: DesignNode[]): DesignNode[] {
  if (!nodes.some((node) => SIZE_DERIVED_KINDS.includes(node.type))) return nodes;

  // Sur les noeuds expanses : la taille d'une instance — et celle du groupe qui
  // la contient — vient du contenu de son composant.
  const layout = computeLayout(expandInstances(nodes as RenderNode[]));
  return nodes.map((node) => {
    if (!SIZE_DERIVED_KINDS.includes(node.type)) return node;
    const box = boundsOf(layout, node.id);
    if (node.width === box.width && node.height === box.height) return node;
    return { ...node, width: box.width, height: box.height };
  });
}

export function normalizeHierarchy(nodes: DesignNode[]): DesignNode[] {
  validateHierarchy(nodes);
  validateInstances(nodes);
  return recomputeGroupSizes(flattenPreOrder(nodes));
}

/**
 * Instances qui reproduisent l'un de ces groupes et qui SURVIVRAIENT a leur
 * disparition. Supprimer ou dissoudre un composant encore instancie laisserait
 * des instances pendantes : les outils s'en servent pour refuser tot, avec un
 * message qui dit quoi faire.
 */
export function survivingInstancesOf(nodes: DesignNode[], removedIds: Set<string>): DesignNode[] {
  return nodes.filter(
    (node) =>
      node.type === "instance" &&
      node.componentId !== undefined &&
      removedIds.has(node.componentId) &&
      !removedIds.has(node.id)
  );
}

/** Un élément et tous ses descendants — ce qu'une suppression de groupe emporte. */
export function withDescendants(nodes: DesignNode[], ids: string[]): Set<string> {
  const all = new Set<string>(ids);
  for (const id of ids) {
    for (const descendant of descendantIds(nodes, id)) all.add(descendant);
  }
  return all;
}

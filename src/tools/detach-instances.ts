import type { DesignStore } from "../core/design-store.js";
import type { DesignNode } from "../../shared/schemas/design.schema.js";
import { childrenByParent } from "../../shared/tree.js";
import { cloneSubtrees } from "../core/clone.js";
import { DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/**
 * Rompt le lien d'une instance avec son composant : le contenu devient des
 * noeuds ordinaires, editables un par un, et cesse de suivre le composant.
 *
 * C'est la soupape du modele : rien ne se surcharge dans une instance, donc une
 * copie qui doit diverger se detache. Le noeud garde son id, son nom et sa
 * position — il devient simplement un groupe, a la meme place dans la pile.
 *
 * Une instance imbriquee dans le composant reste, elle, une instance : detacher
 * une carte ne detache pas les boutons qu'elle contient.
 */
export function detachInstances(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of instance ids.`);
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  const instances = nodeIds.map((raw) => {
    const node = byId.get(String(raw));
    if (!node) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
    if (node.type !== "instance") {
      throw new DesignError(`Node "${node.id}" is a "${node.type}", not an instance — nothing to detach.`);
    }
    return node;
  });

  const children = childrenByParent(current.nodes);
  let materialized = 0;

  const design = store.mutate(id, "agent", (draft) => {
    const result: DesignNode[] = [];
    for (const node of draft.nodes) {
      const instance = instances.find((candidate) => candidate.id === node.id);
      if (!instance) {
        result.push(node);
        continue;
      }

      // L'instance prend la place du groupe qu'elle reproduisait, au meme rang
      // dans la pile ; le contenu du composant est copie juste derriere.
      result.push({ ...node, type: "group", componentId: undefined });

      const sourceChildren = (children.get(instance.componentId ?? "") ?? []).map((child) => child.id);
      const clone = cloneSubtrees(current.nodes, sourceChildren);
      const rootSet = new Set(clone.rootIds);
      for (const copy of clone.copies) {
        result.push(rootSet.has(copy.id) ? { ...copy, parentId: node.id } : copy);
      }
      materialized += clone.copies.length;
    }
    draft.nodes = result;
  });

  return {
    ...textResult(
      `Detached ${instances.length} instance(s) in "${design.name}": ${materialized} node(s) are now ordinary nodes ` +
        `and no longer follow their component.`
    ),
    design,
  };
}

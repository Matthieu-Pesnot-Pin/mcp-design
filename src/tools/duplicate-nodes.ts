import type { DesignStore } from "../core/design-store.js";
import type { DesignNode } from "../../shared/schemas/design.schema.js";
import { withoutRedundantDescendants } from "../../shared/tree.js";
import { cloneSubtrees } from "../core/clone.js";
import { DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/** Décalage par défaut d'une copie, en pixels : assez pour la voir, assez peu pour la retrouver. */
const DEFAULT_OFFSET = 20;
export const MAX_DUPLICATE_COPIES = 50;

function readNumber(args: Record<string, unknown> | undefined, field: string, fallback: number): number {
  if (args?.[field] === undefined) return fallback;
  const value = Number(args[field]);
  if (!Number.isFinite(value)) throw new DesignError(`"${field}" must be a number.`);
  return value;
}

/**
 * Copie des éléments — un groupe emporte tout son contenu.
 *
 * Les identifiants sont réattribués et les liens parent/enfant recâblés sur les
 * copies : sans cela, deux noeuds partageraient un id, ce qui casserait aussi
 * bien le rendu que le diff relu par l'agent.
 */
export function duplicateNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of node ids.`);
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  for (const raw of nodeIds) {
    if (!byId.has(String(raw))) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
  }

  // Un élément dont le groupe est aussi listé serait copié deux fois : une fois
  // pour lui-même, une fois avec son groupe.
  const roots = withoutRedundantDescendants(
    current.nodes,
    nodeIds.map((raw) => String(raw))
  );

  const offsetX = readNumber(args, "offset_x", DEFAULT_OFFSET);
  const offsetY = readNumber(args, "offset_y", DEFAULT_OFFSET);
  const count = readNumber(args, "count", 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DUPLICATE_COPIES) {
    throw new DesignError(`"count" must be an integer between 1 and ${MAX_DUPLICATE_COPIES}.`);
  }

  let parentId: string | null | undefined;
  if (args?.parent_id !== undefined) {
    if (args.parent_id === null) {
      parentId = null;
    } else {
      const parent = byId.get(String(args.parent_id));
      if (!parent) throw new DesignError(`Group "${String(args.parent_id)}" not found in design "${id}".`);
      if (parent.type !== "group") {
        throw new DesignError(`"parent_id" must reference a group, but "${parent.id}" is a "${parent.type}".`);
      }
      parentId = parent.id;
    }
  }

  const copies: DesignNode[] = [];
  const createdRootIds: string[] = [];

  for (let copyIndex = 1; copyIndex <= count; copyIndex++) {
    // Un sous-arbre complet par copie : les ids sont neufs et les liens
    // parent/enfant recables (cf. src/core/clone.ts).
    const clone = cloneSubtrees(current.nodes, roots);
    const rootSet = new Set(clone.rootIds);

    for (const copy of clone.copies) {
      // Seules les racines sont decalees et reparentees : les descendants sont
      // exprimes dans l'espace de leur parent et suivent donc tout seuls.
      if (!rootSet.has(copy.id)) {
        copies.push(copy);
        continue;
      }
      copies.push({
        ...copy,
        parentId: parentId === undefined ? copy.parentId : parentId,
        x: copy.x + offsetX * copyIndex,
        y: copy.y + offsetY * copyIndex,
      });
    }
    createdRootIds.push(...clone.rootIds);
  }

  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes.push(...copies);
  });

  const lines = copies
    .filter((node) => createdRootIds.includes(node.id))
    .map((node) => `- ${node.id} — "${node.name}" (${node.type}) at ${Math.round(node.x)},${Math.round(node.y)}`);

  return {
    ...textResult(
      [
        `Copied ${roots.length} node(s)${count > 1 ? ` ${count} times` : ""} in "${design.name}" ` +
          `(${copies.length} node(s) created, content included). New top-level copies:`,
        ...lines,
      ].join("\n")
    ),
    design,
  };
}

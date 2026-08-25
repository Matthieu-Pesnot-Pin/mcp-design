import type { DesignStore } from "../core/design-store.js";
import { DesignError } from "../core/node-factory.js";
import { withDescendants } from "../core/hierarchy.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

export function deleteNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of node ids.`);
  }

  const current = store.get(id);
  const known = new Set(current.nodes.map((n) => n.id));
  const missing = nodeIds.filter((nodeId) => !known.has(String(nodeId)));
  if (missing.length > 0) {
    throw new DesignError(`Node(s) not found in design "${id}": ${missing.join(", ")}.`);
  }

  // Supprimer un groupe emporte son contenu : le laisser derrière lui produirait
  // des noeuds orphelins pointant vers un parent disparu.
  const toRemove = withDescendants(current.nodes, nodeIds.map((nodeId) => String(nodeId)));
  const nested = toRemove.size - nodeIds.length;

  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes = draft.nodes.filter((n) => !toRemove.has(n.id));
  });

  return {
    ...textResult(
      `Deleted ${toRemove.size} node(s) from "${design.name}"` +
        `${nested > 0 ? ` (${nested} of them nested inside a deleted group)` : ""}. ` +
        `${design.nodes.length} node(s) remaining.`
    ),
    design,
  };
}

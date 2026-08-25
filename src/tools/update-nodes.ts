import type { DesignStore } from "../core/design-store.js";
import { applyPatch, DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

export function updateNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const updates = args?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error(`"updates" is required and must be a non-empty array of { id, ...fields }.`);
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((n) => [n.id, n]));

  // Validation complète d'abord : un patch partiellement appliqué laisserait le
  // design dans un état que l'agent n'a pas demandé.
  const patched = updates.map((raw) => {
    const patch = raw as Record<string, unknown>;
    const nodeId = typeof patch.id === "string" ? patch.id : "";
    const node = byId.get(nodeId);
    if (!node) {
      throw new DesignError(
        `Node "${nodeId}" not found in design "${id}". Known ids: ${current.nodes.map((n) => n.id).join(", ") || "(none)"}.`
      );
    }
    const { id: _ignored, ...fields } = patch;
    if (Object.keys(fields).length === 0) {
      throw new DesignError(`Update for node "${nodeId}" contains no field to change.`);
    }
    return applyPatch(node, fields);
  });

  const patchedById = new Map(patched.map((n) => [n.id, n]));
  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes = draft.nodes.map((n) => patchedById.get(n.id) ?? n);
  });

  const lines = patched.map((n) => `- ${n.id} — "${n.name}" (${n.type})`);
  return {
    ...textResult([`Updated ${patched.length} node(s) in "${design.name}":`, ...lines].join("\n")),
    design,
  };
}

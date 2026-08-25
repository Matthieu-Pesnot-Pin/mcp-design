import type { DesignStore } from "../core/design-store.js";
import type { Design, DesignNode } from "../../shared/schemas/design.schema.js";
import { buildNode, type CreateNodeInput } from "../core/node-factory.js";
import { requireString, textResult, type ToolResult } from "./types.js";

export interface MutationResult extends ToolResult {
  design?: Design;
}

export function addNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const input = args?.nodes;
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`"nodes" is required and must be a non-empty array.`);
  }

  const current = store.get(id);
  const existingIds = new Set(current.nodes.map((n) => n.id));
  const created: DesignNode[] = [];

  // Tout est construit avant d'écrire : une entrée invalide n'ajoute rien du tout.
  input.forEach((raw, index) => {
    const node = buildNode(raw as CreateNodeInput, existingIds, current.nodes.length + index + 1);
    existingIds.add(node.id);
    created.push(node);
  });

  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes.push(...created);
  });

  const lines = created.map(
    (n) => `- ${n.id} — "${n.name}" (${n.type}) at ${Math.round(n.x)},${Math.round(n.y)} size ${Math.round(n.width)}x${Math.round(n.height)}`
  );
  return {
    ...textResult([`Added ${created.length} node(s) to "${design.name}":`, ...lines].join("\n")),
    design,
  };
}

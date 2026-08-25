import type { DesignStore } from "../core/design-store.js";
import type { DesignNode } from "../../shared/schemas/design.schema.js";
import { DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/**
 * Dissout un ou plusieurs groupes : leur contenu remonte d'un niveau, à la place
 * qu'occupait le groupe dans l'ordre d'empilement, sans bouger à l'écran.
 */
export function ungroupNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const groupIds = args?.group_ids;
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    throw new Error(`"group_ids" is required and must be a non-empty array of group ids.`);
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  const groups = groupIds.map((raw) => {
    const node = byId.get(String(raw));
    if (!node) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
    if (node.type !== "group") {
      throw new DesignError(`Node "${node.id}" is a "${node.type}", not a group — nothing to ungroup.`);
    }
    return node;
  });

  const dissolved = new Set(groups.map((group) => group.id));
  let promoted = 0;

  const design = store.mutate(id, "agent", (draft) => {
    const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));

    /**
     * Remonte la chaîne d'ancêtres jusqu'au premier groupe conservé, en
     * accumulant les offsets traversés. Gère du même coup le cas où plusieurs
     * groupes imbriqués sont dissous en un seul appel.
     */
    const surviving = (parentId: string | null) => {
      let dx = 0;
      let dy = 0;
      let cursor = parentId;
      while (cursor !== null && dissolved.has(cursor)) {
        const group = nodesById.get(cursor)!;
        dx += group.x;
        dy += group.y;
        cursor = group.parentId;
      }
      return { parentId: cursor, dx, dy };
    };

    const result: DesignNode[] = [];
    for (const node of draft.nodes) {
      if (dissolved.has(node.id)) continue;

      const target = surviving(node.parentId);
      if (target.parentId === node.parentId) {
        result.push(node);
        continue;
      }
      // Le contenu absorbe l'offset des groupes traversés : rien ne bouge à l'écran.
      promoted++;
      result.push({ ...node, parentId: target.parentId, x: node.x + target.dx, y: node.y + target.dy });
    }

    draft.nodes = result;
  });

  return {
    ...textResult(
      `Ungrouped ${groups.length} group(s); ${promoted} node(s) moved up one level. Nothing moved on screen.`
    ),
    design,
  };
}

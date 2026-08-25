import type { DesignStore } from "../core/design-store.js";
import {
  REORDER_DIRECTIONS,
  childrenByParent,
  reorderNodes as reorder,
  type ReorderDirection,
} from "../../shared/tree.js";
import { DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/**
 * Change l'ordre d'empilement d'éléments — l'équivalent agent du panneau de
 * calques de la GUI, dont il partage la logique (`reorderNodes` dans shared/tree).
 */
export function reorderNodesTool(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of node ids.`);
  }

  const direction = args?.position as ReorderDirection;
  if (!REORDER_DIRECTIONS.includes(direction)) {
    throw new Error(
      `"position" is required and must be one of: ${REORDER_DIRECTIONS.join(", ")} ` +
        `(received: ${JSON.stringify(args?.position)}).`
    );
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  const targets = nodeIds.map((raw) => {
    const node = byId.get(String(raw));
    if (!node) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
    return node;
  });

  const moved = new Set(targets.map((node) => node.id));
  const before = current.nodes.map((node) => node.id).join(" ");
  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes = reorder(draft.nodes, [...moved], direction);
  });

  if (design.nodes.map((node) => node.id).join(" ") === before) {
    // Le cas est fréquent, et silencieux autrement : un élément déjà au sommet
    // de sa fratrie ne bougera jamais, quel que soit le nombre d'appels.
    const edge = direction === "back" || direction === "backward" ? "bottom" : "top";
    const subject = targets.length === 1 ? `"${targets[0].name}" (${targets[0].id}) is` : "those nodes are";
    return {
      ...textResult(
        `Nothing moved: ${subject} already at the ${edge} of their sibling order. ` +
          `Stacking is relative to siblings only — to move an element past the content of another group, ` +
          `reorder that group itself, or reparent the element with update_nodes.`
      ),
      design,
    };
  }

  // L'ordre final, fratrie par fratrie : évite à l'agent un get_design de contrôle.
  const siblings = childrenByParent(design.nodes);
  const parents = new Set(design.nodes.filter((node) => moved.has(node.id)).map((node) => node.parentId));
  const lines = [...parents].map((parentId) => {
    const order = (siblings.get(parentId) ?? [])
      .map((node) => (moved.has(node.id) ? `[${node.name}]` : node.name))
      .join(" then ");
    return `- ${parentId === null ? "root level" : `inside group ${parentId}`}, bottom to top: ${order}`;
  });

  return {
    ...textResult(
      [
        `Moved ${targets.length} node(s) ${direction} in "${design.name}" (moved nodes in brackets):`,
        ...lines,
      ].join("\n")
    ),
    design,
  };
}

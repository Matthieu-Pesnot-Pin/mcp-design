import type { DesignStore } from "../core/design-store.js";
import type { DesignNode } from "../../shared/schemas/design.schema.js";
import type { RenderNode } from "../../shared/render.js";
import { boundsOf, computeLayout, descendantIds, spaceOriginOf } from "../../shared/tree.js";
import { DesignError } from "../core/node-factory.js";
import { shortId } from "../core/ids.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/**
 * Regroupe des éléments sous un nouveau groupe.
 *
 * Les éléments doivent partager le même parent : regrouper des éléments situés
 * dans des groupes différents changerait leur ordre d'empilement de façon
 * imprévisible, mieux vaut le refuser que le deviner.
 */
export function groupNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of node ids.`);
  }

  const current = store.get(id);
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  const targets = nodeIds.map((raw) => {
    const node = byId.get(String(raw));
    if (!node) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
    return node;
  });

  const parents = new Set(targets.map((node) => node.parentId));
  if (parents.size > 1) {
    throw new DesignError(
      `Cannot group nodes that live in different groups. Move them under the same parent first (update_nodes with parentId).`
    );
  }
  const parentId = targets[0].parentId;

  // Regrouper un groupe et l'un de ses propres descendants n'a pas de sens.
  for (const node of targets) {
    const inside = descendantIds(current.nodes, node.id);
    const nested = targets.find((other) => other.id !== node.id && inside.has(other.id));
    if (nested) {
      throw new DesignError(`Cannot group "${nested.id}" together with its own ancestor "${node.id}".`);
    }
  }

  const layout = computeLayout(current.nodes as unknown as RenderNode[]);
  const spaceOrigin = spaceOriginOf(layout, parentId);
  const boxes = targets.map((node) => boundsOf(layout, node.id));
  const groupX = Math.min(...boxes.map((box) => box.x)) - spaceOrigin.x;
  const groupY = Math.min(...boxes.map((box) => box.y)) - spaceOrigin.y;

  const groupId = typeof args?.group_id === "string" && args.group_id.trim() !== "" ? args.group_id.trim() : shortId("g");
  if (byId.has(groupId)) throw new DesignError(`Node id "${groupId}" already exists in this design.`);

  const group: DesignNode = {
    id: groupId,
    type: "group",
    name: typeof args?.name === "string" && args.name.trim() !== "" ? args.name.trim() : "Groupe",
    parentId,
    x: groupX,
    y: groupY,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
  };

  const moved = new Set(targets.map((node) => node.id));
  const design = store.mutate(id, "agent", (draft) => {
    // Les coordonnées deviennent relatives au groupe : le contenu ne bouge pas à l'écran.
    const rebased = draft.nodes.map((node) =>
      moved.has(node.id) ? { ...node, parentId: groupId, x: node.x - groupX, y: node.y - groupY } : node
    );

    // Le groupe prend la place du plus haut de ses membres dans l'ordre
    // d'empilement, et ses membres le suivent dans leur ordre relatif d'origine.
    const members = rebased.filter((node) => moved.has(node.id));
    const lastMemberId = members[members.length - 1].id;

    const reordered: DesignNode[] = [];
    for (const node of rebased) {
      if (!moved.has(node.id)) {
        reordered.push(node);
      } else if (node.id === lastMemberId) {
        reordered.push(group, ...members);
      }
    }
    draft.nodes = reordered;
  });

  return {
    ...textResult(
      `Grouped ${targets.length} node(s) into "${group.name}" (${groupId})` +
        `${parentId ? ` inside group ${parentId}` : ""}. The content did not move on screen.`
    ),
    design,
  };
}

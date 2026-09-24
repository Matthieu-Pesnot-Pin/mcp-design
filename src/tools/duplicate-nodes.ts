import type { DesignStore } from "../core/design-store.js";
import type { DesignNode } from "../../shared/schemas/design.schema.js";
import type { RenderNode } from "../../shared/render.js";
import { computeLayout, spaceOriginOf, withoutRedundantDescendants } from "../../shared/tree.js";
import { expandInstances } from "../../shared/instances.js";
import { cloneSubtrees, subtreeNodes } from "../core/clone.js";
import { DesignError } from "../core/node-factory.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/** Décalage par défaut d'une copie dans le même design, en pixels : assez pour la voir, assez peu pour la retrouver. */
const DEFAULT_OFFSET = 20;
export const MAX_DUPLICATE_COPIES = 50;

function readNumber(args: Record<string, unknown> | undefined, field: string, fallback: number): number {
  if (args?.[field] === undefined) return fallback;
  const value = Number(args[field]);
  if (!Number.isFinite(value)) throw new DesignError(`"${field}" must be a number.`);
  return value;
}

/**
 * Composants à copier en plus des sous-arbres demandés : ceux que reproduit une
 * instance copiée alors qu'ils n'ont pas de copie à portée, y compris ceux dont
 * dépendent les composants ainsi ajoutés. Les instances des sous-arbres demandés
 * voient les composants copiés avec elles ; celles d'un composant ajouté ne
 * voient que les autres composants ajoutés.
 */
function missingComponents(nodes: DesignNode[], roots: string[]): string[] {
  const inRoots = new Set(subtreeNodes(nodes, roots).map((node) => node.id));
  const referenced = (scope: string[], reachable: Set<string>) =>
    subtreeNodes(nodes, scope)
      .filter((node) => node.type === "instance" && node.componentId !== undefined && !reachable.has(node.componentId))
      .map((node) => node.componentId!);

  const missing = [...new Set(referenced(roots, inRoots))];
  for (;;) {
    const inMissing = new Set(subtreeNodes(nodes, missing).map((node) => node.id));
    const fresh = [...new Set(referenced(missing, inMissing))].filter((id) => !missing.includes(id));
    if (fresh.length === 0) return missing;
    missing.push(...fresh);
  }
}

/** Pointe chaque instance copiée vers la copie de son composant quand elle existe. */
function remapComponents(copies: DesignNode[], ...idMaps: Map<string, string>[]): DesignNode[] {
  return copies.map((node) => {
    if (node.type !== "instance" || node.componentId === undefined) return node;
    const target = idMaps.map((map) => map.get(node.componentId!)).find((id) => id !== undefined);
    return target === undefined ? node : { ...node, componentId: target };
  });
}

/**
 * Copie des éléments — un groupe emporte tout son contenu — dans le même design
 * ou dans un autre.
 *
 * Les identifiants sont réattribués et les liens parent/enfant recâblés sur les
 * copies. Vers un autre design, les copies arrivent à la racine à leur position
 * absolue d'origine (ou dans `parent_id`), et les composants reproduits par les
 * instances copiées sont copiés avec elles, une seule fois, à la racine.
 */
export function duplicateNodes(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const nodeIds = args?.node_ids;
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error(`"node_ids" is required and must be a non-empty array of node ids.`);
  }

  const targetId = args?.target_design_id === undefined ? id : requireString(args, "target_design_id");
  const crossDesign = targetId !== id;

  const source = store.get(id);
  const target = crossDesign ? store.get(targetId) : source;
  const byId = new Map(source.nodes.map((node) => [node.id, node]));
  for (const raw of nodeIds) {
    if (!byId.has(String(raw))) throw new DesignError(`Node "${String(raw)}" not found in design "${id}".`);
  }

  // Un élément dont le groupe est aussi listé serait copié deux fois : une fois
  // pour lui-même, une fois avec son groupe.
  const roots = withoutRedundantDescendants(
    source.nodes,
    nodeIds.map((raw) => String(raw))
  );

  const defaultOffset = crossDesign ? 0 : DEFAULT_OFFSET;
  const offsetX = readNumber(args, "offset_x", defaultOffset);
  const offsetY = readNumber(args, "offset_y", defaultOffset);
  const count = readNumber(args, "count", 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DUPLICATE_COPIES) {
    throw new DesignError(`"count" must be an integer between 1 and ${MAX_DUPLICATE_COPIES}.`);
  }

  let parentId: string | null | undefined;
  if (args?.parent_id !== undefined) {
    if (args.parent_id === null) {
      parentId = null;
    } else {
      const parent = target.nodes.find((node) => node.id === String(args.parent_id));
      if (!parent) throw new DesignError(`Group "${String(args.parent_id)}" not found in design "${targetId}".`);
      if (parent.type !== "group") {
        throw new DesignError(`"parent_id" must reference a group, but "${parent.id}" is a "${parent.type}".`);
      }
      parentId = parent.id;
    }
  }

  // Vers un autre design, un noeud posé à la racine garde sa position à l'écran :
  // ses coordonnées locales sont ramenées dans l'espace de la planche.
  const layout = crossDesign ? computeLayout(expandInstances(source.nodes as RenderNode[])) : undefined;
  const placeAtRoot = (node: DesignNode): DesignNode => {
    const origin = spaceOriginOf(layout!, node.parentId);
    return { ...node, parentId: null, x: node.x + origin.x, y: node.y + origin.y };
  };

  const copies: DesignNode[] = [];
  const createdRootIds: string[] = [];

  const components = crossDesign ? withoutRedundantDescendants(source.nodes, missingComponents(source.nodes, roots)) : [];
  const componentClone = cloneSubtrees(source.nodes, components);
  const componentRoots = new Set(componentClone.rootIds);
  copies.push(
    ...remapComponents(componentClone.copies, componentClone.idMap).map((copy) =>
      componentRoots.has(copy.id) ? placeAtRoot(copy) : copy
    )
  );

  for (let copyIndex = 1; copyIndex <= count; copyIndex++) {
    // Un sous-arbre complet par copie : les ids sont neufs et les liens
    // parent/enfant recables (cf. src/core/clone.ts).
    const clone = cloneSubtrees(source.nodes, roots);
    const rootSet = new Set(clone.rootIds);
    const cloned = crossDesign ? remapComponents(clone.copies, clone.idMap, componentClone.idMap) : clone.copies;

    for (const copy of cloned) {
      // Seules les racines sont decalees et reparentees : les descendants sont
      // exprimes dans l'espace de leur parent et suivent donc tout seuls.
      if (!rootSet.has(copy.id)) {
        copies.push(copy);
        continue;
      }
      const placed = crossDesign && (parentId === undefined || parentId === null) ? placeAtRoot(copy) : copy;
      copies.push({
        ...placed,
        parentId: parentId === undefined ? placed.parentId : parentId,
        x: placed.x + offsetX * copyIndex,
        y: placed.y + offsetY * copyIndex,
      });
    }
    createdRootIds.push(...clone.rootIds);
  }

  const design = store.mutate(targetId, "agent", (draft) => {
    draft.nodes.push(...copies);
  });

  const describe = (node: DesignNode) =>
    `- ${node.id} — "${node.name}" (${node.type}) at ${Math.round(node.x)},${Math.round(node.y)}`;
  const lines = copies.filter((node) => createdRootIds.includes(node.id)).map(describe);
  const componentLines = copies.filter((node) => componentRoots.has(node.id)).map(describe);

  const from = crossDesign ? ` from "${source.name}" into "${design.name}"` : ` in "${design.name}"`;
  return {
    ...textResult(
      [
        `Copied ${roots.length} node(s)${count > 1 ? ` ${count} times` : ""}${from} ` +
          `(${copies.length} node(s) created, content included). New top-level copies:`,
        ...lines,
        ...(componentLines.length > 0
          ? [
              `Also copied ${componentLines.length} component(s) the copied instances mirror, now pointed at by those instances:`,
              ...componentLines,
            ]
          : []),
      ].join("\n")
    ),
    design,
  };
}

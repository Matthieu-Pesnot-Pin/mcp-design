import type { DesignNode } from "../../shared/schemas/design.schema.js";
import { descendantIds } from "../../shared/tree.js";
import { shortId } from "./ids.js";

/**
 * Copie de sous-arbres avec reattribution des identifiants.
 *
 * Deux outils en ont besoin — `duplicate_nodes` pour une copie independante,
 * `detach_instances` pour materialiser le contenu d'une instance : sans ce
 * module partage, la meme reecriture des liens parent/enfant existerait en
 * double, et deux noeuds finiraient tot ou tard par partager un id.
 */

/** Les racines et tous leurs descendants, dans l'ordre du document. */
export function subtreeNodes(nodes: DesignNode[], rootIds: string[]): DesignNode[] {
  const included = new Set(rootIds);
  for (const rootId of rootIds) for (const descendant of descendantIds(nodes, rootId)) included.add(descendant);
  return nodes.filter((node) => included.has(node.id));
}

export interface CloneResult {
  /** Les copies, dans l'ordre du document. Les racines gardent leur `parentId` d'origine. */
  copies: DesignNode[];
  /** Ids des copies correspondant aux racines demandees. */
  rootIds: string[];
}

/**
 * Copie les sous-arbres donnes. Les liens parent/enfant sont recables sur les
 * copies ; la geometrie, elle, est laissee intacte — le decalage eventuel
 * appartient a l'appelant.
 */
export function cloneSubtrees(nodes: DesignNode[], rootIds: string[]): CloneResult {
  const source = subtreeNodes(nodes, rootIds);
  const idMap = new Map(source.map((node) => [node.id, shortId(node.type === "group" ? "g" : "n")]));
  const roots = new Set(rootIds);

  const copies = source.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    parentId: roots.has(node.id) ? node.parentId : (idMap.get(node.parentId ?? "") ?? node.parentId),
  }));

  return { copies, rootIds: rootIds.map((id) => idMap.get(id)!) };
}

import type { RenderNode } from "./render.js";
import { childrenByParent } from "./tree.js";

/**
 * Groupes reutilisables : composants et instances.
 *
 * Un noeud `instance` est une FEUILLE en stockage : il ne porte qu'une
 * reference (`componentId`) vers le groupe qu'il reproduit. Son contenu n'est
 * jamais persiste — il est reconstruit ici, a la volee, par `expandInstances`.
 *
 * C'est ce qui donne la propagation : editer le groupe source met a jour toutes
 * ses instances d'un coup, et `get_changes` ne signale qu'un seul changement au
 * lieu de N copies. En contrepartie, rien ne se surcharge dans une instance —
 * une copie qui doit diverger se detache (`detach_instances`).
 *
 * Comme `render.ts` et `tree.ts`, ce module ne depend d'aucune librairie : il
 * est importe aussi bien par le serveur MCP que par le canvas du navigateur.
 */

/** Separe l'id de l'instance de celui du noeud du composant : "n_ab12~n_title". */
export const INSTANCE_ID_SEPARATOR = "~";

/**
 * Profondeur maximale d'imbrication d'instances. La garde anti-recursion de
 * `validateHierarchy` rend le cas impossible en stockage ; ce plafond protege
 * le rendu d'un fichier ecrit a la main.
 */
const MAX_INSTANCE_DEPTH = 8;

/** Vrai si l'id designe un noeud issu d'une expansion : il n'existe pas en stockage. */
export function isExpandedId(id: string): boolean {
  return id.includes(INSTANCE_ID_SEPARATOR);
}

/**
 * Id du noeud reellement stocke derriere un id rendu : l'instance elle-meme
 * pour un noeud expanse, l'id inchange sinon. C'est par la que passe toute
 * selection venue du canvas — cliquer dans une instance selectionne l'instance.
 */
export function instanceRootOf(id: string): string {
  const separator = id.indexOf(INSTANCE_ID_SEPARATOR);
  return separator === -1 ? id : id.slice(0, separator);
}

function derivedId(prefix: string, id: string): string {
  return prefix === "" ? id : `${prefix}${INSTANCE_ID_SEPARATOR}${id}`;
}

/**
 * Remplace chaque noeud `instance` par un `group` equivalent suivi d'une copie
 * du sous-arbre de son composant, les ids des copies etant prefixes par celui de
 * l'instance.
 *
 * Le resultat ne contient plus aucun noeud `instance` : tous les consommateurs
 * en aval (calcul de disposition, rendu SVG, export HTML/JSX, canvas) travaillent
 * sur des groupes ordinaires, sans une seule branche supplementaire.
 *
 * Le groupe source, lui, reste dans la liste : il est visible sur la planche,
 * comme un composant principal dans Figma.
 */
export function expandInstances<T extends RenderNode>(nodes: T[]): T[] {
  if (!nodes.some((node) => node.type === "instance")) return nodes;

  const children = childrenByParent(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: T[] = [];
  /** Ids d'origine deja emis a leur place normale, pour le filet de fin. */
  const emitted = new Set<string>();

  const visit = (node: T, prefix: string, parentId: string | null, chain: readonly string[]) => {
    const id = derivedId(prefix, node.id);
    if (prefix === "") emitted.add(node.id);

    if (node.type !== "instance") {
      result.push({ ...node, id, parentId } as T);
      for (const child of children.get(node.id) ?? []) visit(child as T, prefix, id, chain);
      return;
    }

    // L'instance devient le groupe qu'elle represente : sa position, sa
    // rotation et son opacite s'appliquent au contenu du composant.
    result.push({ ...node, id, parentId, type: "group", componentId: undefined } as T);

    const source = node.componentId === undefined ? undefined : byId.get(node.componentId);
    // Reference invalide, recursive ou trop profonde : l'instance se rend vide
    // plutot que de boucler. La validation, elle, refuse d'ecrire ces cas.
    if (!source || source.type !== "group") return;
    if (chain.includes(source.id) || chain.length >= MAX_INSTANCE_DEPTH) return;

    const nested = [...chain, source.id];
    for (const child of children.get(source.id) ?? []) visit(child as T, id, id, nested);
  };

  for (const node of children.get(null) ?? []) visit(node, "", null, []);
  // Meme filet que `flattenPreOrder` : un noeud dont le parent a disparu est
  // rendu a la racine plutot que de devenir invisible.
  for (const node of nodes) {
    if (!emitted.has(node.id)) visit(node, "", null, []);
  }
  return result;
}

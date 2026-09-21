import { defaultLineHeight, type RenderNode } from "./render.js";
import { DEFAULT_ICON_STROKE_WIDTH, ICON_GRID } from "./icons/index.js";

/**
 * Valeurs par défaut et champs autorisés par type de noeud.
 *
 * Partagé entre le serveur (validation des appels d'outils) et la GUI (création
 * à la souris) : une forme créée par l'agent et une forme dessinée par
 * l'utilisateur partent exactement du même état.
 *
 * Comme `render.ts`, ce module ne dépend d'aucune librairie.
 */

export type NodeKind = RenderNode["type"];

export const NODE_KINDS: readonly NodeKind[] = ["rect", "ellipse", "line", "text", "icon", "group", "instance"];

/** Types que l'utilisateur peut dessiner directement ; un groupe se cree a partir d'une selection. */
export const DRAWABLE_KINDS: readonly NodeKind[] = ["rect", "ellipse", "line", "text", "icon"];

export const NODE_DEFAULTS: Record<NodeKind, Partial<RenderNode>> = {
  rect: { width: 200, height: 120, fill: "#e8e8e6", stroke: "#1a1a18", strokeWidth: 1, radius: 8 },
  ellipse: { width: 160, height: 160, fill: "#e8e8e6", stroke: "#1a1a18", strokeWidth: 1 },
  line: { width: 200, height: 0, stroke: "#1a1a18", strokeWidth: 2 },
  text: {
    width: 260,
    // Une ligne : la boîte par défaut épouse le texte par défaut. Toute autre
    // hauteur ferait descendre la première ligne sous le point posé, puisque le
    // bloc de lignes est centré dans sa boîte. Un texte créé sans hauteur la
    // recalcule de toute façon sur son propre contenu.
    height: defaultLineHeight(24),
    text: "Texte",
    color: "#1a1a18",
    fontSize: 24,
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: 400,
    fontStyle: "normal",
    textAlign: "left",
    // `lineHeight` n'a volontairement pas de valeur par défaut : figée, elle
    // rendrait un texte de 64px sur un interligne de 32. Absente, elle suit la
    // taille de police (fontSize x 1.35), comme l'annonce sa documentation.
  },
  // Taille de la grille de Lucide : une icone posee sans consigne rend au
  // format pour lequel son trace a ete dessine.
  icon: {
    width: ICON_GRID,
    height: ICON_GRID,
    fill: "none",
    stroke: "#1a1a18",
    strokeWidth: DEFAULT_ICON_STROKE_WIDTH,
  },
  // Un groupe n'a pas de taille propre : elle est deduite de son contenu.
  group: { width: 0, height: 0 },
  // Une instance non plus : sa taille est celle du composant qu'elle reproduit.
  instance: { width: 0, height: 0 },
};

/** Champs stylistiques acceptés par type — tout le reste est refusé à la création comme au patch. */
export const NODE_STYLE_FIELDS: Record<NodeKind, ReadonlyArray<keyof RenderNode>> = {
  rect: ["fill", "stroke", "strokeWidth", "radius"],
  ellipse: ["fill", "stroke", "strokeWidth"],
  line: ["stroke", "strokeWidth"],
  text: ["text", "color", "fontSize", "fontFamily", "fontWeight", "fontStyle", "textAlign", "lineHeight"],
  icon: ["icon", "fill", "stroke", "strokeWidth"],
  group: [],
  // Rien ne se surcharge dans une instance : son apparence est celle de son
  // composant. Seul le lien lui-meme se change, ce qui l'echange de composant.
  instance: ["componentId"],
};

/**
 * Champs deduits du contenu d'un groupe. Ils sont recalcules a chaque mutation
 * et ne peuvent pas etre ecrits directement — ni par l'agent, ni par la GUI.
 */
export const GROUP_DERIVED_FIELDS: ReadonlyArray<keyof RenderNode> = ["width", "height"];

/** Types dont la taille est deduite du contenu, donc jamais ecrite directement. */
export const SIZE_DERIVED_KINDS: readonly NodeKind[] = ["group", "instance"];

export const NODE_GEOMETRY_FIELDS: ReadonlyArray<keyof RenderNode> = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
];

const LABELS: Record<NodeKind, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Ligne",
  text: "Texte",
  icon: "Icône",
  group: "Groupe",
  instance: "Instance",
};

export function defaultNodeName(type: NodeKind, index: number): string {
  return `${LABELS[type]} ${index}`;
}

export function nodeKindLabel(type: NodeKind): string {
  return LABELS[type];
}

/** Taille minimale garantissant qu'un noeud reste sélectionnable à la souris. */
export function clampNodeSize(type: NodeKind, width: number, height: number): { width: number; height: number } {
  // Groupe et instance : taille deduite du contenu.
  if (SIZE_DERIVED_KINDS.includes(type)) return { width, height };
  if (type === "line") return { width, height }; // les deltas négatifs encodent la direction
  // Une icone est carree : son trace l'est, et une boite rectangulaire ne
  // ferait que laisser du vide sur les cotes. Le cote suit la plus petite
  // dimension demandee, ce qui rend un cadrage a la souris previsible.
  if (type === "icon") {
    const side = Math.max(1, Math.min(Math.abs(width), Math.abs(height)));
    return { width: side, height: side };
  }
  if (type === "text") return { width: Math.max(20, Math.abs(width)), height: Math.max(16, Math.abs(height)) };
  return { width: Math.max(1, Math.abs(width)), height: Math.max(1, Math.abs(height)) };
}

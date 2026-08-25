import type { RenderNode } from "./render.js";

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

export const NODE_KINDS: readonly NodeKind[] = ["rect", "ellipse", "line", "text", "group"];

/** Types que l'utilisateur peut dessiner directement ; un groupe se cree a partir d'une selection. */
export const DRAWABLE_KINDS: readonly NodeKind[] = ["rect", "ellipse", "line", "text"];

export const NODE_DEFAULTS: Record<NodeKind, Partial<RenderNode>> = {
  rect: { width: 200, height: 120, fill: "#e8e8e6", stroke: "#1a1a18", strokeWidth: 1, radius: 8 },
  ellipse: { width: 160, height: 160, fill: "#e8e8e6", stroke: "#1a1a18", strokeWidth: 1 },
  line: { width: 200, height: 0, stroke: "#1a1a18", strokeWidth: 2 },
  text: {
    width: 260,
    height: 40,
    text: "Texte",
    color: "#1a1a18",
    fontSize: 24,
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: 400,
    fontStyle: "normal",
    textAlign: "left",
    // En pixels, comme x/y/fontSize — jamais un multiplicateur.
    lineHeight: 32,
  },
  // Un groupe n'a pas de taille propre : elle est deduite de son contenu.
  group: { width: 0, height: 0 },
};

/** Champs stylistiques acceptés par type — tout le reste est refusé à la création comme au patch. */
export const NODE_STYLE_FIELDS: Record<NodeKind, ReadonlyArray<keyof RenderNode>> = {
  rect: ["fill", "stroke", "strokeWidth", "radius"],
  ellipse: ["fill", "stroke", "strokeWidth"],
  line: ["stroke", "strokeWidth"],
  text: ["text", "color", "fontSize", "fontFamily", "fontWeight", "fontStyle", "textAlign", "lineHeight"],
  group: [],
};

/**
 * Champs deduits du contenu d'un groupe. Ils sont recalcules a chaque mutation
 * et ne peuvent pas etre ecrits directement — ni par l'agent, ni par la GUI.
 */
export const GROUP_DERIVED_FIELDS: ReadonlyArray<keyof RenderNode> = ["width", "height"];

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
  group: "Groupe",
};

export function defaultNodeName(type: NodeKind, index: number): string {
  return `${LABELS[type]} ${index}`;
}

export function nodeKindLabel(type: NodeKind): string {
  return LABELS[type];
}

/** Taille minimale garantissant qu'un noeud reste sélectionnable à la souris. */
export function clampNodeSize(type: NodeKind, width: number, height: number): { width: number; height: number } {
  if (type === "group") return { width, height }; // taille deduite du contenu
  if (type === "line") return { width, height }; // les deltas négatifs encodent la direction
  if (type === "text") return { width: Math.max(20, Math.abs(width)), height: Math.max(16, Math.abs(height)) };
  return { width: Math.max(1, Math.abs(width)), height: Math.max(1, Math.abs(height)) };
}

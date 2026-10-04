/**
 * Rendu SVG d'un noeud, partagé entre l'exporteur (côté serveur) et le canvas
 * de la GUI (côté navigateur). Une seule implémentation : ce que l'utilisateur
 * voit à l'écran est exactement ce que `export_design` produit.
 *
 * Ce module ne dépend volontairement d'aucune librairie (pas de zod) pour rester
 * importable depuis le bundle GUI.
 */

import {
  boundsOf,
  boxesIntersect,
  childrenByParent,
  computeLayout,
  normalizedBox,
  spaceOriginOf,
  type Box,
  type Layout,
} from "./tree.js";
import { expandInstances } from "./instances.js";
import {
  DEFAULT_ICON_STROKE_WIDTH,
  ICON_GRID,
  UNKNOWN_ICON_ELEMENTS,
  iconElements,
  type IconElement,
} from "./icons/index.js";

// La géométrie de base vit dans tree.ts (module bas-niveau, sans dépendance vers
// celui-ci) ; elle reste exposée ici pour tous les appelants existants.
export { normalizedBox };
export type { Box, Point } from "./tree.js";

export interface RenderNode {
  id: string;
  type: "rect" | "ellipse" | "line" | "text" | "icon" | "group" | "instance";
  name: string;
  /** Groupe conteneur, ou null a la racine. Les coordonnees sont relatives a ce parent. */
  parentId: string | null;
  /** Instance : id du groupe reproduit. Resolu par `expandInstances` avant tout rendu. */
  componentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  /** Nom de l'icone dans la bibliotheque embarquee, p.ex. "shopping-cart". Type `icon` uniquement. */
  icon?: string;
  text?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function nodeCenter(node: RenderNode): { cx: number; cy: number } {
  const box = normalizedBox(node);
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Transform SVG de rotation autour du centre de la boîte, ou "" si pas de rotation. */
export function rotationTransform(node: RenderNode): string {
  if (!node.rotation) return "";
  const { cx, cy } = nodeCenter(node);
  return `rotate(${round(node.rotation)} ${round(cx)} ${round(cy)})`;
}

/**
 * Le texte n'est pas re-wrappé automatiquement : seuls les retours à la ligne
 * explicites créent une nouvelle ligne. Comportement prévisible pour l'agent
 * comme pour l'utilisateur, et identique à l'export.
 */
export function textLines(node: RenderNode): string[] {
  return (node.text ?? "").split("\n");
}

export const DEFAULT_FONT_FAMILY = "Inter, system-ui, sans-serif";
export const DEFAULT_FONT_SIZE = 24;

/**
 * Interligne appliqué quand `lineHeight` est absent, exprimé en multiple de la
 * taille de police. C'est le seul endroit où un ratio subsiste : le champ
 * stocké, lui, est toujours en pixels.
 */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.35;

/**
 * En dessous de ce seuil, une valeur d'interligne ne peut pas être des pixels :
 * 4px d'interligne écraserait n'importe quel texte lisible. C'est donc un ratio
 * — refusé à l'écriture, converti à la lecture des anciens fichiers.
 */
export const MIN_LINE_HEIGHT_PX = 4;

/** Interligne par défaut, en pixels, pour une taille de police donnée. */
export function defaultLineHeight(fontSize: number): number {
  return Math.round(fontSize * DEFAULT_LINE_HEIGHT_RATIO * 100) / 100;
}

export function textMetrics(node: RenderNode) {
  const fontSize = node.fontSize ?? DEFAULT_FONT_SIZE;
  // `lineHeight` est une distance en pixels entre deux lignes de base, pas un
  // multiplicateur : c'est l'unité que l'agent emploie spontanément, et la
  // seule qui se lise directement dans la même échelle que x, y et fontSize.
  const lineStep = node.lineHeight ?? defaultLineHeight(fontSize);
  const blockHeight = Math.max(1, textLines(node).length) * lineStep;
  /**
   * Décalage du bloc de lignes pour le centrer dans la boîte.
   *
   * Sans lui, la position verticale du texte dépendrait de l'interligne et non
   * de la boîte : un lineHeight de 32 sur une ligne de 11px dans une boîte de
   * 16px poussait la ligne de base à 20px du haut, donc le texte entier sous sa
   * propre boîte. L'interligne n'espace que les lignes entre elles ; c'est la
   * boîte qui dit où le texte se pose.
   */
  const blockOffset = (Math.abs(node.height) - blockHeight) / 2;
  return {
    fontSize,
    lineStep,
    /** Hauteur occupée par les lignes, interligne compris. */
    blockHeight,
    blockOffset,
    /** Ligne de base de la première ligne, mesurée depuis le haut de la boîte. */
    firstBaseline: blockOffset + lineStep * 0.5 + fontSize * 0.36,
    anchor: node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start",
    anchorX:
      node.textAlign === "center"
        ? node.x + node.width / 2
        : node.textAlign === "right"
          ? node.x + node.width
          : node.x,
  };
}

/** Hauteur minimale nécessaire pour afficher tout le texte du noeud. */
export function measuredTextHeight(node: RenderNode): number {
  const { lineStep } = textMetrics(node);
  return Math.max(lineStep, textLines(node).length * lineStep);
}

/**
 * Vrai quand la boîte épouse déjà exactement son texte.
 *
 * C'est le signe qu'aucune hauteur n'a été voulue pour elle-même : la boîte
 * suit son contenu, et doit continuer à le suivre quand le texte change. Une
 * hauteur choisie (un libellé calé sur la hauteur de son bouton) ne vérifie pas
 * cette égalité et n'est donc jamais réajustée.
 */
export function hugsText(node: RenderNode): boolean {
  return Math.abs(Math.abs(node.height) - measuredTextHeight(node)) < 0.5;
}

/**
 * Le noeud, avec la hauteur qui épouse son texte.
 *
 * Une boîte à la taille de son texte le place de fait en haut à gauche : le
 * centrage vertical n'a plus rien à décaler. C'est ce qu'attend qui pose un
 * texte sans penser à sa boîte ; un conteneur qui veut centrer son libellé,
 * lui, donne une hauteur explicite.
 */
export function withFittedTextHeight<T extends RenderNode>(node: T): T {
  return { ...node, height: measuredTextHeight(node) };
}

function shapeAttributes(node: RenderNode): string {
  const parts: string[] = [];
  if (node.type !== "line" && node.type !== "text") {
    parts.push(`fill="${escapeXml(node.fill ?? "none")}"`);
  }
  if (node.stroke && (node.strokeWidth ?? 0) > 0) {
    parts.push(`stroke="${escapeXml(node.stroke)}"`, `stroke-width="${round(node.strokeWidth ?? 1)}"`);
  }
  return parts.join(" ");
}

/**
 * Transform SVG d'un groupe : translation vers son origine, puis rotation
 * autour du centre de son contenu (exprime dans l'espace local du groupe).
 */
export function groupTransform(node: RenderNode, localCenter: { cx: number; cy: number }): string {
  const parts = [`translate(${round(node.x)} ${round(node.y)})`];
  if (node.rotation) parts.push(`rotate(${round(node.rotation)} ${round(localCenter.cx)} ${round(localCenter.cy)})`);
  return parts.join(" ");
}

/**
 * Placement du trace d'une icone dans sa boite.
 *
 * L'icone est dessinee dans une grille carree : elle est mise a l'echelle
 * uniformement pour tenir dans la boite, puis centree. Jamais deformee — une
 * icone etiree se lit immediatement comme un defaut, alors qu'une icone centree
 * dans une boite trop large reste correcte.
 */
export function iconPlacement(node: RenderNode): { x: number; y: number; scale: number; size: number } {
  const box = normalizedBox(node);
  const scale = Math.min(box.width, box.height) / ICON_GRID;
  const size = ICON_GRID * scale;
  return { x: box.x + (box.width - size) / 2, y: box.y + (box.height - size) / 2, scale, size };
}

/** Trace du noeud, ou le carre en pointilles si le nom d'icone est inconnu. */
export function iconElementsOf(node: RenderNode): IconElement[] {
  return iconElements(node.icon ?? "") ?? UNKNOWN_ICON_ELEMENTS;
}

/**
 * Attributs de trait d'une icone, exprimes dans la grille de 24.
 *
 * `color` fait resoudre les rares `fill="currentColor"` de la bibliotheque vers
 * la couleur du trait : sans lui, le point d'un graphique en nuage ressortirait
 * en noir sur une icone blanche.
 */
export function iconStyle(node: RenderNode): Record<string, string> {
  return {
    fill: node.fill ?? "none",
    stroke: node.stroke ?? "#000000",
    color: node.stroke ?? "#000000",
    "stroke-width": String(round(node.strokeWidth ?? DEFAULT_ICON_STROKE_WIDTH)),
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
}

function attributesToSvg(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
}

export function iconElementToSvg([tag, attributes]: IconElement): string {
  return `<${tag} ${attributesToSvg(attributes)} />`;
}

/**
 * Markup SVG d'un seul noeud, sans wrapper — utilisé par l'export et par le canvas.
 * Un groupe ne produit rien par lui-meme : c'est un conteneur, rendu par
 * `documentToSvg` (serveur) ou par le canvas (navigateur).
 */
export function nodeToSvg(node: RenderNode): string {
  // Un groupe est un conteneur ; une instance n'atteint jamais le rendu, elle
  // est remplacee par un groupe en amont par `expandInstances`.
  if (node.type === "group" || node.type === "instance") return "";

  const transform = rotationTransform(node);
  const transformAttr = transform ? ` transform="${transform}"` : "";
  const opacityAttr = node.opacity >= 1 ? "" : ` opacity="${round(node.opacity)}"`;
  const box = normalizedBox(node);

  switch (node.type) {
    case "rect": {
      const radius = Math.max(0, Math.min(node.radius ?? 0, Math.min(box.width, box.height) / 2));
      return (
        `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"` +
        (radius > 0 ? ` rx="${round(radius)}" ry="${round(radius)}"` : "") +
        ` ${shapeAttributes(node)}${opacityAttr}${transformAttr} />`
      );
    }
    case "ellipse": {
      return (
        `<ellipse cx="${round(box.x + box.width / 2)}" cy="${round(box.y + box.height / 2)}"` +
        ` rx="${round(box.width / 2)}" ry="${round(box.height / 2)}"` +
        ` ${shapeAttributes(node)}${opacityAttr}${transformAttr} />`
      );
    }
    case "line": {
      return (
        `<line x1="${round(node.x)}" y1="${round(node.y)}" x2="${round(node.x + node.width)}" y2="${round(node.y + node.height)}"` +
        ` ${shapeAttributes(node)} stroke-linecap="round"${opacityAttr}${transformAttr} />`
      );
    }
    case "icon": {
      // La rotation s'exprime dans l'espace du parent, donc AVANT le placement
      // du trace : elle fait tourner l'icone posee, pas la grille de 24.
      const place = iconPlacement(node);
      const placement = `${transform ? `${transform} ` : ""}translate(${round(place.x)} ${round(place.y)}) scale(${round(place.scale)})`;
      const body = iconElementsOf(node).map(iconElementToSvg).join("");
      return `<g transform="${placement}" ${attributesToSvg(iconStyle(node))}${opacityAttr}>${body}</g>`;
    }
    case "text": {
      const m = textMetrics(node);
      const lines = textLines(node);
      const tspans = lines
        .map(
          (line, index) =>
            `<tspan x="${round(m.anchorX)}" y="${round(node.y + m.firstBaseline + index * m.lineStep)}">` +
            `${escapeXml(line === "" ? " " : line)}</tspan>`
        )
        .join("");
      return (
        `<text font-family="${escapeXml(node.fontFamily ?? DEFAULT_FONT_FAMILY)}" font-size="${round(m.fontSize)}"` +
        ` font-weight="${node.fontWeight ?? 400}" font-style="${node.fontStyle ?? "normal"}"` +
        ` fill="${escapeXml(node.color ?? "#000000")}" text-anchor="${m.anchor}"` +
        ` xml:space="preserve"${opacityAttr}${transformAttr}>${tspans}</text>`
      );
    }
  }
}

export interface RenderDocument {
  name: string;
  width: number;
  height: number;
  background: string;
  nodes: RenderNode[];
}

/**
 * Rend une liste de noeuds frères, en descendant récursivement dans les groupes.
 * Partagé par le rendu plein document et le rendu cadré sur un seul élément.
 *
 * Avec `frame`, un élément semi-transparent qui ne recoupe pas le cadre est
 * omis : il n'y serait pas visible, et resvg panique — en emportant le
 * processus — sur un élément semi-transparent dessiné entièrement hors du cadre.
 */
function renderSiblings(
  nodes: RenderNode[],
  children: Map<string | null, RenderNode[]>,
  layout: Layout,
  depth: number,
  frame?: Box
): string[] {
  const pad = "  ".repeat(depth + 1);
  return nodes.flatMap((node) => {
    const bounds = boundsOf(layout, node.id);
    if (frame && node.opacity < 1 && !boxesIntersect(bounds, frame)) return [];
    if (node.type !== "group") return [`${pad}${nodeToSvg(node)}`];

    const origin = layout.origin.get(node.id) ?? { x: 0, y: 0 };
    const center = { cx: bounds.x + bounds.width / 2 - origin.x, cy: bounds.y + bounds.height / 2 - origin.y };
    const opacity = node.opacity >= 1 ? "" : ` opacity="${round(node.opacity)}"`;

    return [
      `${pad}<g transform="${groupTransform(node, center)}"${opacity}>`,
      ...renderSiblings(children.get(node.id) ?? [], children, layout, depth + 1, frame),
      `${pad}</g>`,
    ];
  });
}

/** Contenu SVG de la planche, en coordonnées document, limité à `frame` s'il est donné. */
function documentBody(doc: RenderDocument, frame?: Box): string {
  // Les instances sont resolues ici, une fois pour toutes : en dessous, il n'y
  // a plus que des groupes ordinaires.
  const nodes = expandInstances(doc.nodes);
  const layout = computeLayout(nodes);
  const children = childrenByParent(nodes);

  // Un groupe devient un <g> : ses enfants gardent leurs coordonnées locales,
  // c'est la transformation du conteneur qui les place.
  return renderSiblings(children.get(null) ?? [], children, layout, 0, frame).join("\n");
}

export function documentToSvg(doc: RenderDocument): string {
  const body = documentBody(doc);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" ` +
    `viewBox="0 0 ${doc.width} ${doc.height}">\n` +
    `  <rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="${escapeXml(doc.background)}" />\n` +
    (body ? `${body}\n` : "") +
    `</svg>`
  );
}

/**
 * SVG cadré sur une zone rectangulaire de la planche, en coordonnées document.
 * Tout ce qui recoupe la zone y figure, coupé à ses bords ; les éléments
 * semi-transparents qui ne la recoupent pas sont omis.
 */
export function regionToSvg(doc: RenderDocument, region: Box): string {
  const body = documentBody(doc, region);
  const width = round(Math.max(1, region.width));
  const height = round(Math.max(1, region.height));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${round(region.x)} ${round(region.y)} ${width} ${height}">\n` +
    `  <rect x="${round(region.x)}" y="${round(region.y)}" width="${width}" height="${height}" ` +
    `fill="${escapeXml(doc.background)}" />\n` +
    (body ? `${body}\n` : "") +
    `</svg>`
  );
}

/**
 * SVG cadré sur un seul élément — l'élément et son contenu, rien d'autre.
 *
 * Le sous-arbre est rendu dans ses coordonnées locales, puis translaté vers sa
 * position document : le viewBox peut alors être exprimé dans le même repère
 * que `computeLayout`, donc directement sur la boîte englobante de l'élément.
 */
export function subtreeToSvg(doc: RenderDocument, nodeId: string, padding = 0): string {
  const nodes = expandInstances(doc.nodes);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found in design "${doc.name}".`);

  const layout = computeLayout(nodes);
  const children = childrenByParent(nodes);
  const bounds = boundsOf(layout, nodeId);

  const region: Box = {
    x: bounds.x - padding,
    y: bounds.y - padding,
    // Un groupe vide (ou un trait purement horizontal) a une dimension nulle :
    // on garde au moins 1px pour que le PNG produit reste valide.
    width: Math.max(1, bounds.width + padding * 2),
    height: Math.max(1, bounds.height + padding * 2),
  };

  // Un groupe est rendu par son contenu, dans le repère du groupe ; tout autre
  // noeud est rendu tel quel, dans le repère de son parent.
  const origin =
    node.type === "group" ? (layout.origin.get(nodeId) ?? { x: 0, y: 0 }) : spaceOriginOf(layout, node.parentId);
  const inner =
    node.type === "group"
      ? renderSiblings([{ ...node, x: 0, y: 0 }], children, layout, 1).join("\n")
      : `    ${nodeToSvg(node)}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(region.width)}" height="${round(region.height)}" ` +
    `viewBox="${round(region.x)} ${round(region.y)} ${round(region.width)} ${round(region.height)}">\n` +
    `  <rect x="${round(region.x)}" y="${round(region.y)}" width="${round(region.width)}" ` +
    `height="${round(region.height)}" fill="${escapeXml(doc.background)}" />\n` +
    `  <g transform="translate(${round(origin.x)} ${round(origin.y)})">\n` +
    (inner ? `${inner}\n` : "") +
    `  </g>\n` +
    `</svg>`
  );
}

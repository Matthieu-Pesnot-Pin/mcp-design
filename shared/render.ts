/**
 * Rendu SVG d'un noeud, partagé entre l'exporteur (côté serveur) et le canvas
 * de la GUI (côté navigateur). Une seule implémentation : ce que l'utilisateur
 * voit à l'écran est exactement ce que `export_design` produit.
 *
 * Ce module ne dépend volontairement d'aucune librairie (pas de zod) pour rester
 * importable depuis le bundle GUI.
 */

export interface RenderNode {
  id: string;
  type: "rect" | "ellipse" | "line" | "text";
  name: string;
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

/** Boîte englobante normalisée (largeur/hauteur toujours positives). */
export function normalizedBox(node: RenderNode) {
  const x = node.width < 0 ? node.x + node.width : node.x;
  const y = node.height < 0 ? node.y + node.height : node.y;
  return { x, y, width: Math.abs(node.width), height: Math.abs(node.height) };
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

export function textMetrics(node: RenderNode) {
  const fontSize = node.fontSize ?? 24;
  const lineHeight = node.lineHeight ?? 1.35;
  return {
    fontSize,
    lineHeight,
    lineStep: fontSize * lineHeight,
    /** Ligne de base de la première ligne, mesurée depuis le haut de la boîte. */
    firstBaseline: fontSize * lineHeight * 0.5 + fontSize * 0.36,
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

/** Markup SVG d'un seul noeud, sans wrapper — utilisé par l'export et par le canvas. */
export function nodeToSvg(node: RenderNode): string {
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

export function documentToSvg(doc: RenderDocument): string {
  const body = doc.nodes.map((node) => `  ${nodeToSvg(node)}`).join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" ` +
    `viewBox="0 0 ${doc.width} ${doc.height}">\n` +
    `  <rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="${escapeXml(doc.background)}" />\n` +
    (body ? `${body}\n` : "") +
    `</svg>`
  );
}

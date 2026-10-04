import { Resvg } from "@resvg/resvg-js";
import type { Design } from "../../shared/schemas/design.schema.js";
import { regionToSvg, subtreeToSvg, type RenderDocument, type RenderNode } from "../../shared/render.js";
import type { Box } from "../../shared/tree.js";

/**
 * Capture d'écran d'un design.
 *
 * Le rendu passe par le même SVG que `export_design` — donc par la même
 * géométrie que le canvas de la GUI — puis est rasterisé par resvg. Pas de
 * navigateur headless : l'outil doit rester utilisable depuis un serveur MCP
 * lancé en stdio, sans dépendance système.
 */

/** Côté maximal du PNG produit : au-delà, l'image coûte du contexte sans rien apporter. */
export const DEFAULT_MAX_DIMENSION = 1568;

export interface ScreenshotOptions {
  /** Cadre la capture sur ce noeud (typiquement un groupe) au lieu de tout l'artboard. */
  nodeId?: string;
  /** Cadre la capture sur cette zone, en coordonnées document. Exclusif de `nodeId`. */
  region?: Box;
  /** Facteur de zoom appliqué avant l'écrêtage par maxDimension (défaut 1). */
  scale?: number;
  /** Marge, en pixels du design, ajoutée autour du noeud capturé. */
  padding?: number;
  maxDimension?: number;
}

export interface Screenshot {
  png: Buffer;
  /** Dimensions du PNG produit. */
  width: number;
  height: number;
  /** Dimensions de la zone capturée, en pixels du design. */
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
}

function toDocument(design: Design): RenderDocument {
  return {
    name: design.name,
    width: design.width,
    height: design.height,
    background: design.background,
    nodes: design.nodes as unknown as RenderNode[],
  };
}

/** Lit width/height du SVG produit, seule source fiable de la taille de la zone capturée. */
function svgSize(svg: string): { width: number; height: number } {
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0);
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0);
  return { width, height };
}

/**
 * Rasterisation d'un SVG quelconque, avec la police de secours du systeme.
 *
 * Partagee par la capture d'un design et par la planche de vignettes de
 * `search_icons` : une seule configuration de resvg, donc un seul endroit ou le
 * rendu du texte peut diverger.
 */
export function rasterize(svg: string, scale: number): { png: Buffer; width: number; height: number } {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI", sansSerifFamily: "Segoe UI" },
  });
  const rendered = resvg.render();
  return { png: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
}

function artboardOf(doc: RenderDocument): Box {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

/**
 * Rendu d'une zone de la planche, découpé dans le rendu de la planche entière.
 *
 * resvg panique, en emportant le processus, sur un élément semi-transparent
 * dont le dessin tombe entièrement hors du cadre — et la boîte d'un élément ne
 * dit pas où tombe son dessin : un texte occupe rarement toute la largeur de sa
 * boîte. Dans la planche entière, tout ce qui est visible est dans le cadre ; la
 * zone en est ensuite extraite par une image, qui ne porte aucune opacité.
 */
function rasterizeRegion(doc: RenderDocument, region: Box, scale: number): { png: Buffer; width: number; height: number } {
  const artboard = rasterize(regionToSvg(doc, artboardOf(doc)), scale);
  const crop =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${region.width}" height="${region.height}" ` +
    `viewBox="${region.x} ${region.y} ${region.width} ${region.height}">` +
    `<image x="0" y="0" width="${doc.width}" height="${doc.height}" preserveAspectRatio="none" ` +
    `xlink:href="data:image/png;base64,${artboard.png.toString("base64")}" />` +
    `</svg>`;
  return rasterize(crop, scale);
}

export function screenshotDesign(design: Design, options: ScreenshotOptions = {}): Screenshot {
  const doc = toDocument(design);
  const padding = Math.max(0, options.padding ?? 0);
  const region = options.region;
  // La planche entière est rendue comme une zone : un élément semi-transparent
  // posé hors de l'artboard en est omis.
  const svg = options.nodeId ? subtreeToSvg(doc, options.nodeId, padding) : regionToSvg(doc, region ?? artboardOf(doc));

  const source = svgSize(svg);
  if (!(source.width > 0) || !(source.height > 0)) {
    throw new Error("Nothing to capture: the requested area has no size.");
  }

  const maxDimension = Math.max(1, options.maxDimension ?? DEFAULT_MAX_DIMENSION);
  const requested = Math.max(0.05, Math.min(8, options.scale ?? 1));
  // L'écrêtage ne peut que réduire : un zoom demandé plus petit reste respecté.
  const scale = Math.min(requested, maxDimension / Math.max(source.width, source.height));

  const rendered = region ? rasterizeRegion(doc, region, scale) : rasterize(svg, scale);

  return {
    png: rendered.png,
    width: rendered.width,
    height: rendered.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    scale,
  };
}

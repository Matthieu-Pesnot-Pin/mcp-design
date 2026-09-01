import { escapeXml, iconElementToSvg, iconElementsOf, iconStyle, type RenderNode } from "../../shared/render.js";
import { CORE_ICONS, ICON_GRID, iconCount } from "../../shared/icons/index.js";
import { searchIcons } from "../../shared/icons/search.js";
import { rasterize } from "../core/screenshot.js";
import { requireString, type ImageToolResult } from "./types.js";

/** Au-dela, la planche coute plus de contexte qu'elle n'aide a choisir. */
export const MAX_ICON_RESULTS = 48;
export const DEFAULT_ICON_RESULTS = 24;

const SHEET_COLUMNS = 6;
const CELL_WIDTH = 120;
const CELL_HEIGHT = 96;
const GLYPH_SIZE = 40;

/**
 * Planche de vignettes : le nom seul ne suffit pas toujours a distinguer
 * "shopping-cart" de "shopping-basket". L'agent lit les noms dans le texte et
 * verifie la forme sur l'image — les deux canaux disent la meme chose.
 */
function contactSheet(names: string[]): string {
  const rows = Math.ceil(names.length / SHEET_COLUMNS);
  const width = SHEET_COLUMNS * CELL_WIDTH;
  const height = rows * CELL_HEIGHT;

  const cells = names.map((name, index) => {
    const column = index % SHEET_COLUMNS;
    const row = Math.floor(index / SHEET_COLUMNS);
    const centerX = column * CELL_WIDTH + CELL_WIDTH / 2;
    const top = row * CELL_HEIGHT;

    const node = { icon: name, stroke: "#1a1a18" } as RenderNode;
    const scale = GLYPH_SIZE / ICON_GRID;
    const glyph =
      `<g transform="translate(${centerX - GLYPH_SIZE / 2} ${top + 18}) scale(${scale})" ` +
      Object.entries(iconStyle(node))
        .map(([key, value]) => `${key}="${escapeXml(value)}"`)
        .join(" ") +
      `>${iconElementsOf(node).map(iconElementToSvg).join("")}</g>`;

    // Le nom est tronque plutot que rogne : un libelle coupe au milieu d'un mot
    // reste identifiable, un libelle qui deborde sur la vignette voisine non.
    const label = name.length > 18 ? `${name.slice(0, 17)}…` : name;
    return (
      glyph +
      `<text x="${centerX}" y="${top + 78}" text-anchor="middle" font-family="Segoe UI, sans-serif" ` +
      `font-size="11" fill="#4a4a48">${escapeXml(label)}</text>`
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />` +
    cells.join("") +
    `</svg>`
  );
}

/**
 * Recherche d'une icone par description.
 *
 * C'est la traine longue de la bibliotheque : les icones les plus courantes
 * sont deja listees dans la description de `add_nodes`, donc un agent qui
 * habille une interface ordinaire n'a pas besoin de passer par ici.
 */
export function searchIconsTool(args: Record<string, unknown> | undefined): ImageToolResult {
  const query = requireString(args, "query");
  const requested = args?.limit === undefined ? DEFAULT_ICON_RESULTS : Number(args.limit);
  const limit = Math.max(1, Math.min(MAX_ICON_RESULTS, Number.isFinite(requested) ? requested : DEFAULT_ICON_RESULTS));
  const withPreview = args?.preview !== false;

  const matches = searchIcons(query, limit);
  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `No icon matches "${query}" among the ${iconCount()} available. ` +
            `Search in English and with a single concept ("cart", "user", "warning"). ` +
            `Common icons: ${CORE_ICONS.slice(0, 30).join(", ")}.`,
        },
      ],
    };
  }

  const lines = matches.map((match) => {
    const synonyms = match.keywords.filter((word) => !match.name.includes(word)).slice(0, 6);
    return `- ${match.name}${synonyms.length > 0 ? ` — ${synonyms.join(", ")}` : ""}`;
  });

  const header =
    `${matches.length} icon(s) matching "${query}", best first (of ${iconCount()} available). ` +
    `Use the name as the "icon" field of an "icon" node — never redraw it out of shapes.`;
  const text = [header, "", ...lines].join("\n");

  if (!withPreview) return { content: [{ type: "text", text }] };

  const sheet = rasterize(contactSheet(matches.map((match) => match.name)), 2);
  return {
    content: [
      { type: "text", text: `${text}\n\nThe image below shows them in the same order, left to right.` },
      { type: "image", data: sheet.png.toString("base64"), mimeType: "image/png" },
    ],
  };
}

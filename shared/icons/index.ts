/**
 * Bibliotheque d'icones embarquee (Lucide, licence ISC).
 *
 * Un noeud `icon` stocke un NOM, jamais un trace : le JSON du design reste
 * lisible — "shopping-cart" dit a l'agent qui le relit ce que la forme
 * represente, ce qu'une grappe d'ellipses dessinees a la main ne dit plus — et
 * une icone se restyle sans se redessiner.
 *
 * Le trace n'existe qu'au moment du rendu, resolu ici. Comme `render.ts`, ce
 * module ne depend d'aucune librairie : il est charge par le serveur MCP comme
 * par le bundle de la GUI.
 */

import { ICON_DATA_JSON, LUCIDE_VERSION } from "./icon-data.js";

export { LUCIDE_VERSION };

/**
 * Cote de la grille dans laquelle chaque icone est dessinee.
 *
 * C'est le repere de `strokeWidth` : une icone posee dans une boite de 96px
 * avec strokeWidth 2 rend un trait de 8px a l'ecran, parce que l'ensemble du
 * trace est mis a l'echelle. L'unite est celle de la grille, pas celle du
 * document — c'est la seule qui donne le meme rendu a toutes les tailles.
 */
export const ICON_GRID = 24;

/** Epaisseur de trait de reference de Lucide, dans la grille de 24. */
export const DEFAULT_ICON_STROKE_WIDTH = 2;

/** Un element SVG du trace : son nom de balise et ses attributs de geometrie. */
export type IconElement = [string, Record<string, string>];

let cache: Record<string, IconElement[]> | null = null;

function library(): Record<string, IconElement[]> {
  // Analyse au premier acces : un serveur stdio qui ne dessine aucune icone ne
  // paie pas le cout des 1800 traces.
  if (cache === null) cache = JSON.parse(ICON_DATA_JSON) as Record<string, IconElement[]>;
  return cache;
}

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(library(), name);
}

/** Trace de l'icone dans la grille de 24, ou `null` si le nom est inconnu. */
export function iconElements(name: string): IconElement[] | null {
  return library()[name] ?? null;
}

export function iconNames(): string[] {
  return Object.keys(library());
}

export function iconCount(): number {
  return iconNames().length;
}

/**
 * Trace affiche a la place d'une icone dont le nom n'existe pas.
 *
 * Un carre en pointilles et un point d'interrogation : le meme SVG sert au
 * canvas, a l'export et a la capture, donc une exception y serait fatale
 * partout a la fois. Un design ouvert apres un renommage de la bibliotheque
 * doit rester ouvrable, et montrer OU le probleme se situe.
 */
export const UNKNOWN_ICON_ELEMENTS: IconElement[] = [
  ["rect", { x: "2", y: "2", width: "20", height: "20", rx: "4", "stroke-dasharray": "3 3" }],
  ["path", { d: "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3V14" }],
  ["circle", { cx: "12", cy: "17.5", r: ".5", fill: "currentColor" }],
];

/**
 * Selection couverte par la description de `add_nodes` : de quoi composer une
 * interface complete sans aucun aller-retour. Le reste de la bibliotheque
 * s'atteint par `search_icons`.
 */
export const CORE_ICONS: readonly string[] = [
  // Navigation et mise en page
  "house", "search", "menu", "x", "chevron-left", "chevron-right", "chevron-up", "chevron-down",
  "arrow-left", "arrow-right", "arrow-up", "arrow-down", "arrow-up-right", "arrow-down-right",
  "external-link", "ellipsis", "ellipsis-vertical", "funnel", "sliders-horizontal", "settings",
  "layout-dashboard", "layout-grid", "panel-left", "panel-right", "list", "list-checks", "table",
  "columns-3", "rows-3", "maximize", "minimize", "expand", "shrink", "move", "grip-vertical", "grip-horizontal",
  // Actions
  "plus", "minus", "check", "circle-check", "circle-x", "circle-alert", "circle-question-mark",
  "triangle-alert", "info", "ban", "trash-2", "pencil", "pen-line", "copy", "clipboard", "clipboard-check",
  "scissors", "save", "download", "upload", "share-2", "send", "link", "unlink", "refresh-cw", "rotate-cw",
  "undo", "redo", "lock", "lock-open", "eye", "eye-off", "star", "heart", "bookmark", "flag",
  "bell", "bell-off", "thumbs-up", "thumbs-down",
  // Personnes et communication
  "user", "users", "user-plus", "user-check", "circle-user", "contact", "mail", "mail-open",
  "message-circle", "message-square", "messages-square", "phone", "phone-call", "video", "video-off",
  "mic", "mic-off", "headphones", "at-sign",
  // Documents et medias
  "file", "file-text", "file-plus", "files", "folder", "folder-open", "folder-plus", "archive",
  "book", "book-open", "newspaper", "notebook-pen", "sticky-note", "paperclip", "printer",
  "image", "images", "camera", "film", "music", "play", "circle-play", "pause", "volume-2", "volume-x",
  // Temps et lieux
  "calendar", "calendar-days", "clock", "timer", "hourglass", "alarm-clock", "map-pin", "map",
  "navigation", "compass", "globe", "plane", "car", "truck", "bike", "train-front", "ship",
  // Commerce
  "shopping-cart", "shopping-bag", "shopping-basket", "credit-card", "wallet", "banknote", "coins",
  "dollar-sign", "euro", "percent", "receipt", "tag", "tags", "gift", "package", "package-check",
  // Donnees et statuts
  "chart-line", "chart-bar", "chart-pie", "chart-column", "trending-up", "trending-down", "activity",
  "gauge", "target", "award", "trophy", "zap", "flame", "sparkles", "wand-sparkles", "lightbulb", "rocket",
  // Technique
  "database", "server", "cloud", "cloud-upload", "cloud-download", "hard-drive", "cpu", "monitor",
  "smartphone", "tablet", "laptop", "keyboard", "mouse-pointer", "wifi", "wifi-off", "bluetooth",
  "battery", "plug", "power", "terminal", "code", "code-xml", "braces", "bug", "git-branch",
  "git-commit-horizontal", "shield", "shield-check", "key", "key-round", "fingerprint-pattern",
  "scan", "qr-code", "barcode",
  // Nature et divers
  "sun", "moon", "cloud-rain", "snowflake", "wind", "droplet", "leaf", "tree-pine", "mountain",
  "loader-circle", "circle-dot", "dot", "text-align-start", "text-align-center", "text-align-end",
  "bold", "italic", "underline", "type", "palette", "brush", "pipette", "ruler", "crop", "layers",
  "box", "shapes", "circle", "square", "triangle", "hexagon", "face-slightly-smiling",
  "face-slightly-frowning", "face-neutral", "handshake", "hand", "languages", "accessibility",
];

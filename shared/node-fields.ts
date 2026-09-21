import type { RenderNode } from "./render.js";

/**
 * Description de chaque champ d'un noeud, **avec son unité**.
 *
 * Source unique : le schéma zod l'attache via `.describe()`, et le serveur MCP
 * en construit l'`inputSchema` exposé à l'agent. Une unité n'a donc qu'un seul
 * endroit où être écrite — c'est précisément l'ambiguïté qui a fait interpréter
 * `lineHeight` comme un multiplicateur d'un côté et des pixels de l'autre.
 */
export const NODE_FIELD_DOCS = {
  id: "Explicit id. Generated when omitted; must be unique within the design.",
  type: "Kind of node: rect, ellipse, line, text, icon, group or instance.",
  name: "Layer name shown in the GUI. Purely descriptive.",
  parentId:
    "Id of the containing group, or null for the root level of the artboard. " +
    "Changing it reparents the node — its x/y are then read in the new parent's space, so it moves on screen. " +
    "This is the field that builds the structure: nest sections, then blocks, then the nodes of a block, rather than dropping " +
    "everything into one group. Only a handful of top-level sections should sit at the root.",

  x:
    "Horizontal position of the bounding box's left edge, in pixels, in the PARENT's coordinate space " +
    "(the artboard's top-left corner when parentId is null, the group's origin otherwise). " +
    "On a line, this is the start point.",
  y:
    "Vertical position of the bounding box's top edge, in pixels, in the PARENT's coordinate space, " +
    "measured downwards. On a line, this is the start point.",
  width:
    "Width of the bounding box, in pixels. On a line, the horizontal delta from start to end — it may be negative. " +
    "On a group, derived from the content and read-only.",
  height:
    "Height of the bounding box, in pixels. On a line, the vertical delta from start to end — it may be negative. " +
    "On a group, derived from the content and read-only. " +
    "On a TEXT node, leave it out: the box then takes the exact height of the text (lines x lineHeight), " +
    "so the first line starts at y. Set it only to centre a label inside a container — give the text node " +
    "the container's y and height, and the block of lines is centred in it.",
  rotation: "Rotation in degrees, clockwise, around the centre of the bounding box. 0 = upright.",
  opacity: "Opacity, from 0 (fully transparent) to 1 (fully opaque).",

  fill: 'CSS colour filling the interior, e.g. "#ffffff" or "rgba(0,0,0,0.4)". rect, ellipse and icon. On an icon it is "none" by default — the shape is drawn by its stroke.',
  stroke: "CSS colour of the outline — of the stroke itself on a line node, of the whole drawing on an icon.",
  strokeWidth:
    "Thickness of the outline, in pixels. 0 or omitted means no outline. " +
    "On an ICON this is the only exception to the pixel rule: it is expressed in the icon's own 24x24 grid " +
    "(2 = the library's regular weight, 1.5 = light, 2.5 = bold), so it scales with the icon. " +
    "An icon 96px wide with strokeWidth 2 draws an 8px line on screen — never raise it to compensate for a large size.",
  radius: "Corner radius, in pixels. rect only; clamped to half of the shortest side.",

  icon:
    "Name of the icon to draw, from the bundled Lucide library, e.g. \"shopping-cart\", \"circle-check\", \"user\". " +
    "Required on an icon node. NEVER approximate an icon out of rects, ellipses and lines: name it here instead — " +
    "the result is sharp at any size, restyles in one field, and stays readable to whoever reads the design later. " +
    "Call search_icons to find a name from a description (it also understands synonyms, so \"basket\" finds \"shopping-cart\"). " +
    "The node's box is square: the drawing is scaled uniformly to fit it and centred, never stretched.",

  componentId:
    "Instance nodes only: id of the GROUP this instance mirrors. The group's content is NOT copied — it is resolved " +
    "at render time, so editing the group updates every instance of it at once, and a repeated block stays a single " +
    "node to read and to change. Whenever the same block appears more than once (cards, list rows, menu items, " +
    "buttons), build it once as a group and add instances of it instead of duplicating it. " +
    "Change this field to swap an instance over to another group; use detach_instances when one copy must diverge.",

  text:
    "Text content. It is NEVER auto-wrapped: only explicit \\n characters start a new line. " +
    "A box that hugs its text keeps hugging it: adding a line grows the box instead of overflowing it.",
  color: "CSS colour of the text.",
  fontSize: "Font size, in pixels (same meaning as the CSS font-size property).",
  fontFamily: 'CSS font stack, e.g. "Inter, system-ui, sans-serif".',
  fontWeight: "CSS numeric font weight, from 100 to 900. 400 = regular, 700 = bold.",
  fontStyle: "normal or italic.",
  textAlign: "Horizontal alignment of each line within the node's width.",
  lineHeight:
    "Distance between two consecutive baselines, IN PIXELS — NOT a multiplier of fontSize. " +
    "With fontSize 64, a comfortable value is 76, not 1.2. " +
    "Defaults to fontSize x 1.35 when omitted, which is usually what you want.",
} satisfies Partial<Record<keyof RenderNode | "type", string>>;

export type NodeFieldName = keyof typeof NODE_FIELD_DOCS;

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
  type: "Kind of node: rect, ellipse, line, text or group.",
  name: "Layer name shown in the GUI. Purely descriptive.",
  parentId:
    "Id of the containing group, or null for the root level of the artboard. " +
    "Changing it reparents the node — its x/y are then read in the new parent's space, so it moves on screen.",

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
    "On a group, derived from the content and read-only.",
  rotation: "Rotation in degrees, clockwise, around the centre of the bounding box. 0 = upright.",
  opacity: "Opacity, from 0 (fully transparent) to 1 (fully opaque).",

  fill: 'CSS colour filling the interior, e.g. "#ffffff" or "rgba(0,0,0,0.4)". rect and ellipse only.',
  stroke: "CSS colour of the outline — of the stroke itself on a line node.",
  strokeWidth: "Thickness of the outline, in pixels. 0 or omitted means no outline.",
  radius: "Corner radius, in pixels. rect only; clamped to half of the shortest side.",

  text: "Text content. It is NEVER auto-wrapped: only explicit \\n characters start a new line.",
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

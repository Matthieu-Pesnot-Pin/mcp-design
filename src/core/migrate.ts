import { DEFAULT_FONT_SIZE, MIN_LINE_HEIGHT_PX } from "../../shared/render.js";

/**
 * Mises à niveau appliquées à la lecture d'un fichier de design.
 *
 * Elles tournent avant la validation de schéma et sont idempotentes : un design
 * déjà à jour ressort inchangé, et le fichier n'est réécrit que si quelque chose
 * a bougé.
 */

/**
 * `lineHeight` a d'abord été stocké comme un multiplicateur de `fontSize`
 * (1.35), puis est passé en pixels — la seule unité que les agents emploient
 * spontanément, et la seule cohérente avec x, y et fontSize.
 *
 * Une valeur sous MIN_LINE_HEIGHT_PX est donc forcément un ancien ratio : on la
 * reconvertit en la multipliant par la taille de police du noeud.
 */

export function migrateNode(node: Record<string, unknown>): Record<string, unknown> {
  const lineHeight = node.lineHeight;
  if (typeof lineHeight !== "number" || !(lineHeight > 0) || lineHeight >= MIN_LINE_HEIGHT_PX) return node;

  const fontSize = typeof node.fontSize === "number" && node.fontSize > 0 ? node.fontSize : DEFAULT_FONT_SIZE;
  return { ...node, lineHeight: Math.round(lineHeight * fontSize * 100) / 100 };
}

/** Applique la migration à un design brut. Retourne `null` si rien n'a changé. */
export function migrateDesign(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const design = raw as Record<string, unknown>;
  let changed = false;

  const migrateList = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const next = migrateNode(entry as Record<string, unknown>);
      if (next !== entry) changed = true;
      return next;
    });
  };

  const nodes = migrateList(design.nodes);
  // La baseline sert de référence au diff : la laisser dans l'ancienne unité
  // ferait apparaître un faux changement sur chaque texte.
  const baseline = design.baseline as Record<string, unknown> | undefined;
  const baselineNodes = baseline && typeof baseline === "object" ? migrateList(baseline.nodes) : undefined;

  if (!changed) return null;
  return {
    ...design,
    nodes,
    ...(baselineNodes === undefined ? {} : { baseline: { ...baseline, nodes: baselineNodes } }),
  };
}

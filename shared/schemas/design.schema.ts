import { z } from "zod";
import { MIN_LINE_HEIGHT_PX } from "../render.js";
import { NODE_FIELD_DOCS } from "../node-fields.js";

/**
 * Modèle de données du canvas.
 *
 * Un `Design` est une planche (artboard) unique contenant une liste plate de
 * noeuds. La liste est ordonnée : l'index = l'ordre d'empilement parmi les
 * noeuds de meme parent (le dernier est au-dessus). C'est `reorder_nodes` — et
 * le panneau de calques de la GUI — qui manipule cet ordre.
 *
 * **Toutes les longueurs sont en pixels** (x, y, width, height, strokeWidth,
 * radius, fontSize, lineHeight), les angles en degres et l'opacite entre 0 et 1.
 *
 * La hierarchie est portee par `parentId` plutot que par de l'imbrication : le
 * stockage reste plat, donc diffable et lisible, tandis que les coordonnees
 * d'un noeud sont exprimees dans l'espace de son parent.
 */

export const NODE_TYPES = ["rect", "ellipse", "line", "text", "group"] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const TextAlignSchema = z.enum(TEXT_ALIGNS);

/**
 * Un seul schéma pour tous les types de noeuds : les champs non pertinents pour
 * un type donné sont simplement absents. Un schéma discriminé obligerait l'agent
 * à connaître quatre formes différentes pour un gain nul côté rendu.
 */
export const DesignNodeSchema = z.object({
  id: z.string().describe(NODE_FIELD_DOCS.id),
  type: NodeTypeSchema.describe(NODE_FIELD_DOCS.type),
  name: z.string().describe(NODE_FIELD_DOCS.name),
  /** Groupe conteneur, ou null a la racine de la planche. */
  parentId: z.string().nullable().default(null).describe(NODE_FIELD_DOCS.parentId),

  // Boîte englobante, en PIXELS, exprimée dans l'espace du parent. Pour `line`, le trait va de (x, y) à
  // (x + width, y + height), ce qui autorise des largeurs/hauteurs négatives sur ce type uniquement.
  x: z.number().describe(NODE_FIELD_DOCS.x),
  y: z.number().describe(NODE_FIELD_DOCS.y),
  width: z.number().describe(NODE_FIELD_DOCS.width),
  height: z.number().describe(NODE_FIELD_DOCS.height),
  /** Degrés, sens horaire, autour du centre de la boîte. */
  rotation: z.number().default(0).describe(NODE_FIELD_DOCS.rotation),
  opacity: z.number().min(0).max(1).default(1).describe(NODE_FIELD_DOCS.opacity),

  // Formes — couleurs CSS, épaisseurs et rayons en pixels.
  fill: z.string().describe(NODE_FIELD_DOCS.fill).optional(),
  stroke: z.string().describe(NODE_FIELD_DOCS.stroke).optional(),
  strokeWidth: z.number().min(0).describe(NODE_FIELD_DOCS.strokeWidth).optional(),
  radius: z.number().min(0).describe(NODE_FIELD_DOCS.radius).optional(),

  // Texte — fontSize et lineHeight sont tous deux en PIXELS.
  text: z.string().describe(NODE_FIELD_DOCS.text).optional(),
  color: z.string().describe(NODE_FIELD_DOCS.color).optional(),
  fontSize: z.number().positive().describe(NODE_FIELD_DOCS.fontSize).optional(),
  fontFamily: z.string().describe(NODE_FIELD_DOCS.fontFamily).optional(),
  fontWeight: z.number().int().min(100).max(900).describe(NODE_FIELD_DOCS.fontWeight).optional(),
  fontStyle: z.enum(["normal", "italic"]).describe(NODE_FIELD_DOCS.fontStyle).optional(),
  textAlign: TextAlignSchema.describe(NODE_FIELD_DOCS.textAlign).optional(),
  /**
   * Distance entre deux lignes de base, **en pixels** — jamais un multiplicateur.
   * Le plancher rejette a l'ecriture les valeurs en ratio (1.2, 1.35...) plutot
   * que de rendre un paragraphe ecrase ; les anciens fichiers, eux, sont
   * convertis a la lecture par src/core/migrate.ts.
   */
  lineHeight: z
    .number()
    .min(
      MIN_LINE_HEIGHT_PX,
      `lineHeight is a distance in PIXELS between baselines, not a multiplier of fontSize. ` +
        `A value under ${MIN_LINE_HEIGHT_PX} is almost certainly a ratio: with fontSize 24 use about 32, ` +
        `with fontSize 64 use about 86. Omit the field to get fontSize x 1.35 automatically.`
    )
    .describe(NODE_FIELD_DOCS.lineHeight)
    .optional(),
});

export type DesignNode = z.infer<typeof DesignNodeSchema>;

/** Snapshot servant de référence au calcul de `get_changes`. */
export const BaselineSchema = z.object({
  revision: z.number().int().nonnegative(),
  at: z.string(),
  nodes: z.array(DesignNodeSchema),
});

export type Baseline = z.infer<typeof BaselineSchema>;

export const DesignSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string(),
  nodes: z.array(DesignNodeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Incrémentée à chaque mutation, quelle qu'en soit l'origine. */
  revision: z.number().int().nonnegative(),
  /** Qui a produit la dernière mutation — sert à expliquer un diff. */
  lastEditor: z.enum(["agent", "user"]),
  baseline: BaselineSchema,
});

export type Design = z.infer<typeof DesignSchema>;

export interface DesignSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  nodeCount: number;
  updatedAt: string;
  revision: number;
  lastEditor: "agent" | "user";
  /** Nombre de noeuds ajoutés/modifiés/supprimés depuis le dernier mark_synced. */
  pendingChanges: number;
}

/** Enveloppe IPC commune Master <-> GUI Worker (même contrat que les autres MCPs). */
export const IPCMessageSchema = z.object({
  type: z.string(),
  correlationId: z.string().optional(),
  data: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.string(),
});

export type IPCMessage = z.infer<typeof IPCMessageSchema>;

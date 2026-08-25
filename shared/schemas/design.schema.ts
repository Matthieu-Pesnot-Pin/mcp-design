import { z } from "zod";

/**
 * Modèle de données du canvas.
 *
 * Un `Design` est une planche (artboard) unique contenant une liste plate de
 * noeuds. La liste est ordonnée : l'index = l'ordre d'empilement (le dernier
 * élément est au-dessus). Volontairement plat et sans groupes : l'agent et la
 * GUI manipulent la même structure sans traduction.
 */

export const NODE_TYPES = ["rect", "ellipse", "line", "text"] as const;
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
  id: z.string(),
  type: NodeTypeSchema,
  name: z.string(),

  // Boîte englobante. Pour `line`, le trait va de (x, y) à (x + width, y + height),
  // ce qui autorise des largeurs/hauteurs négatives sur ce type uniquement.
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),

  // Formes
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  radius: z.number().min(0).optional(),

  // Texte
  text: z.string().optional(),
  color: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.number().int().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  textAlign: TextAlignSchema.optional(),
  lineHeight: z.number().positive().optional(),
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

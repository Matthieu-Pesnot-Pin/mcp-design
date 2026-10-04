import { z } from "zod";
import { NODE_TYPES } from "./design.schema.js";

/**
 * Fichier des remarques : `<dataDir>/feedback/remarks.json`.
 *
 * Il tient les remarques en cours (brouillons et transmises) et la liste des
 * retours transmis, chacun figé au moment de l'envoi, hormis le suivi de son
 * traitement. Les types TypeScript vivent dans `shared/feedback.ts`,
 * importable par la GUI sans zod.
 */

const BoxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

const RemarkElementSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(NODE_TYPES) });

export const RemarkTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page") }),
  z.object({ kind: z.literal("node"), element: RemarkElementSchema, path: z.array(z.string()), box: BoxSchema }),
  z.object({ kind: z.literal("area"), box: BoxSchema, elements: z.array(RemarkElementSchema) }),
]);

const RemarkSchema = z.object({
  id: z.string(),
  designId: z.string(),
  number: z.number().int().positive().nullable(),
  target: RemarkTargetSchema,
  text: z.string().min(1),
  capture: z.string().nullable(),
  status: z.enum(["draft", "sent"]),
  round: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RemarkProcessingSchema = z.object({
  at: z.string(),
  by: z.enum(["agent", "user"]),
  note: z.string().nullable(),
});

const RoundRemarkSchema = z.object({
  id: z.string(),
  designId: z.string(),
  designName: z.string(),
  number: z.number().int().positive().nullable(),
  target: RemarkTargetSchema,
  text: z.string().min(1),
  capture: z.string().nullable(),
  processed: RemarkProcessingSchema.nullable(),
});

const FeedbackRoundSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  submittedAt: z.string(),
  remarks: z.array(RoundRemarkSchema),
});

export const FeedbackFileSchema = z.object({
  version: z.literal(2),
  remarks: z.array(RemarkSchema),
  rounds: z.array(FeedbackRoundSchema),
  /** Dernier numéro de pastille attribué par design : un numéro supprimé n'est jamais réutilisé. */
  lastNumbers: z.record(z.string(), z.number().int().nonnegative()),
});

export type FeedbackFile = z.infer<typeof FeedbackFileSchema>;

/** Version 1 : des retours sans nom, et des remarques sans suivi de traitement. */
const FeedbackFileV1Schema = z.object({
  version: z.literal(1),
  remarks: z.array(RemarkSchema),
  rounds: z.array(
    z.object({
      number: z.number().int().positive(),
      submittedAt: z.string(),
      remarks: z.array(RoundRemarkSchema.omit({ processed: true })),
    })
  ),
  lastNumbers: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * Met un fichier de version 1 au format courant : chaque retour reçoit le nom
 * proposé par défaut, et aucune remarque n'est encore traitée. Renvoie null
 * pour un fichier qui n'est pas en version 1.
 */
export function migrateFeedbackFile(raw: unknown, defaultTitle: (number: number) => string): unknown | null {
  const v1 = FeedbackFileV1Schema.safeParse(raw);
  if (!v1.success) return null;
  return {
    ...v1.data,
    version: 2,
    rounds: v1.data.rounds.map((round) => ({
      ...round,
      title: defaultTitle(round.number),
      remarks: round.remarks.map((remark) => ({ ...remark, processed: null })),
    })),
  };
}

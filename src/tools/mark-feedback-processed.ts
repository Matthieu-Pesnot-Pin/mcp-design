import { roundProgress } from "../../shared/feedback.js";
import type { FeedbackStore } from "../core/feedback-store.js";
import { textResult, type ToolResult } from "./types.js";

/**
 * L'agent déclare traitées des remarques d'un retour. C'est ce que l'utilisateur
 * suit dans la page des retours : lire un retour avec `get_feedback` ne marque
 * rien, seul cet outil le fait.
 */
export function markFeedbackProcessed(feedback: FeedbackStore, args: Record<string, unknown> | undefined): ToolResult {
  const number = Number(args?.round);
  if (!Number.isInteger(number) || number < 1) throw new Error(`"round" is required and must be a feedback round number.`);

  const rawIds = args?.remark_ids;
  if (rawIds !== undefined && (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== "string"))) {
    throw new Error(`"remark_ids" must be an array of remark ids, as listed by get_feedback.`);
  }
  const note = typeof args?.note === "string" ? args.note : null;

  const round = feedback.setProcessed({
    round: number,
    remarkIds: rawIds as string[] | undefined,
    processed: true,
    by: "agent",
    note,
  });
  const progress = roundProgress(round);
  const marked = rawIds === undefined ? "Every remark" : `${(rawIds as string[]).length} remark(s)`;
  return textResult(
    `${marked} of feedback round ${round.number} "${round.title}" marked as processed. ` +
      `${progress.done} of ${progress.total} remark(s) of this round are now processed` +
      (progress.status === "done" ? " — the round is complete." : ".")
  );
}

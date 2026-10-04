import { formatFeedbackRound, roundProgress, type FeedbackRound } from "../../shared/feedback.js";
import type { FeedbackStore } from "../core/feedback-store.js";
import type { ImageToolResult } from "./types.js";

/**
 * Retour de l'utilisateur : les remarques qu'il a transmises depuis la GUI avec
 * « Terminer les retours », figées dans un retour numéroté et nommé.
 *
 * Sans numéro demandé, c'est le plus ancien retour encore à traiter, ou le
 * dernier quand tout est traité. Lire un retour ne change rien : seul
 * `mark_feedback_processed` déclare des remarques traitées.
 */

const STATUS_LABELS = { pending: "to process", in_progress: "in progress", done: "processed" } as const;

function roundLine(round: FeedbackRound): string {
  const progress = roundProgress(round);
  return `  - round ${round.number} "${round.title}" (${round.submittedAt}): ${progress.done}/${progress.total} processed — ${STATUS_LABELS[progress.status]}`;
}

export function getFeedback(feedback: FeedbackStore, args: Record<string, unknown> | undefined): ImageToolResult {
  const rounds = feedback.rounds();
  const drafts = feedback.remarks().filter((remark) => remark.status === "draft").length;
  const draftNote =
    drafts > 0
      ? `${drafts} remark(s) are still drafts in the GUI and are not part of any round yet.`
      : "No draft remark is waiting in the GUI.";

  if (rounds.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `No feedback round has been submitted yet. ${draftNote} ` +
            `Ask the user to switch the GUI to "Remarques" mode and click "Terminer les retours" once their remarks are written.`,
        },
      ],
    };
  }

  const firstOpen = rounds.find((candidate) => roundProgress(candidate).status !== "done");
  const requested = args?.round === undefined ? (firstOpen ?? rounds[rounds.length - 1]).number : Number(args.round);
  const round = rounds.find((candidate) => candidate.number === requested);
  if (!round) {
    throw new Error(`Feedback round ${args?.round} not found. Rounds 1 to ${rounds.length} exist.`);
  }

  const withCaptures = args?.captures !== false;
  const footer = [
    `Feedback rounds (${rounds.length}):`,
    ...rounds.map(roundLine),
    draftNote,
    withCaptures ? "" : "Captures were left out (captures=false).",
    "Apply the remarks, then call mark_feedback_processed with the round and the ids of the remarks you handled, " +
      "with a short note of what you changed: the user follows that progress in the GUI.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const content: ImageToolResult["content"] = [{ type: "text", text: `${formatFeedbackRound(round)}\n\n${footer}` }];
  if (withCaptures) {
    let image = 0;
    for (const remark of round.remarks) {
      if (!remark.capture) continue;
      image += 1;
      const label = remark.number === null ? "whole page" : `#${remark.number}`;
      content.push({ type: "text", text: `Image ${image} — remark ${label} on "${remark.designName}" (${remark.designId}).` });
      content.push({ type: "image", data: feedback.readCapture(remark.capture).toString("base64"), mimeType: "image/png" });
    }
  }
  return { content };
}

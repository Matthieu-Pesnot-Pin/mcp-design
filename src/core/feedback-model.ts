import {
  defaultRoundTitle,
  elementsInArea,
  nodeTarget,
  orderRemarks,
  roundBox,
  type FeedbackRound,
  type Remark,
  type RemarkTarget,
} from "../../shared/feedback.js";
import { FeedbackFileSchema, migrateFeedbackFile, type FeedbackFile } from "../../shared/schemas/feedback.schema.js";
import type { Design } from "../../shared/schemas/design.schema.js";
import type { Box } from "../../shared/tree.js";
import { DesignError } from "./node-factory.js";

/**
 * Règles des remarques et des retours, indépendantes de leur stockage. Chaque
 * opération modifie un brouillon du fichier des remarques ; l'appelant le
 * valide puis l'enregistre — dans `remarks.json` pour le serveur, dans le
 * projet en mémoire pour la version autonome de la GUI.
 */

/** Marge autour d'un élément capturé, comme `screenshot_design`. */
export const NODE_CAPTURE_PADDING = 16;

/** Cible demandée par la GUI, complétée d'après le design. */
export type RemarkTargetInput =
  | { kind: "page" }
  | { kind: "node"; nodeId: string }
  | { kind: "area"; box: Box; elementIds: string[] };

export interface SetProcessedInput {
  round: number;
  /** Remarques visées ; toutes celles du retour quand omis. */
  remarkIds?: string[];
  processed: boolean;
  by: "agent" | "user";
  note?: string | null;
}

export function emptyFeedbackFile(): FeedbackFile {
  return { version: 2, remarks: [], rounds: [], lastNumbers: {} };
}

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.message}`).join("; ");
}

/** Lit un fichier des remarques brut, après mise à niveau de son format. */
export function parseFeedbackFile(raw: unknown, label: string): FeedbackFile {
  const parsed = FeedbackFileSchema.safeParse(migrateFeedbackFile(raw, defaultRoundTitle) ?? raw);
  if (!parsed.success) throw new DesignError(`${label} does not match the expected schema: ${issuesOf(parsed.error)}`);
  return parsed.data;
}

/** Valide un brouillon modifié avant son enregistrement. */
export function validatedFeedbackFile(draft: FeedbackFile): FeedbackFile {
  const parsed = FeedbackFileSchema.safeParse(draft);
  if (!parsed.success) throw new DesignError(`Resulting remarks file is invalid: ${issuesOf(parsed.error)}`);
  return parsed.data;
}

export function requireRemarkText(text: unknown): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (value === "") throw new DesignError("A remark needs some text.");
  return value;
}

function requireTitle(title: unknown): string {
  const value = typeof title === "string" ? title.trim() : "";
  if (value === "") throw new DesignError("A feedback round needs a name.");
  return value;
}

/** Complète la cible d'après l'état courant du design. */
export function resolveRemarkTarget(design: Design, input: RemarkTargetInput): RemarkTarget {
  if (input.kind === "page") return { kind: "page" };

  if (input.kind === "node") {
    if (!design.nodes.some((node) => node.id === input.nodeId)) {
      throw new DesignError(`Node "${input.nodeId}" not found in design "${design.name}" (${design.id}).`);
    }
    return nodeTarget(design.nodes, input.nodeId);
  }

  const box = roundBox(input.box);
  if (!(box.width >= 1 && box.height >= 1)) throw new DesignError("A remark area must be at least 1 px wide and high.");
  if (box.x < 0 || box.y < 0 || box.x + box.width > design.width || box.y + box.height > design.height) {
    throw new DesignError(`A remark area must lie within the ${design.width}x${design.height} artboard.`);
  }
  const hits = new Map(elementsInArea(design.nodes, box).map((hit) => [hit.id, hit]));
  const elements = input.elementIds.map((id) => {
    const hit = hits.get(id);
    if (!hit) throw new DesignError(`Node "${id}" is not inside the remark area.`);
    return { id: hit.id, name: hit.name, type: hit.type };
  });
  return { kind: "area", box, elements };
}

/** Ajoute un brouillon ; `capture` est le nom du fichier de capture, ou null. */
export function addRemark(
  draft: FeedbackFile,
  input: { id: string; designId: string; target: RemarkTarget; text: string; capture: string | null }
): Remark {
  if (
    input.target.kind === "page" &&
    draft.remarks.some(
      (remark) => remark.designId === input.designId && remark.status === "draft" && remark.target.kind === "page"
    )
  ) {
    throw new DesignError("This page already has a remark on the whole page: edit it instead of adding another one.");
  }

  let number: number | null = null;
  if (input.target.kind !== "page") {
    number = (draft.lastNumbers[input.designId] ?? 0) + 1;
    draft.lastNumbers[input.designId] = number;
  }

  const now = new Date().toISOString();
  const remark: Remark = {
    id: input.id,
    designId: input.designId,
    number,
    target: input.target,
    text: requireRemarkText(input.text),
    capture: input.capture,
    status: "draft",
    round: null,
    createdAt: now,
    updatedAt: now,
  };
  draft.remarks.push(remark);
  return remark;
}

function draftOf(file: FeedbackFile, id: string): Remark {
  const remark = file.remarks.find((candidate) => candidate.id === id);
  if (!remark) throw new DesignError(`Remark "${id}" not found.`);
  if (remark.status !== "draft") {
    throw new DesignError(`Remark "${id}" was sent with feedback round ${remark.round}: it can no longer be edited.`);
  }
  return remark;
}

export function updateRemarkText(draft: FeedbackFile, id: string, text: string): Remark {
  const value = requireRemarkText(text);
  const remark = draftOf(draft, id);
  remark.text = value;
  remark.updatedAt = new Date().toISOString();
  return remark;
}

/** Retire une remarque de la liste et la renvoie. */
export function deleteRemark(draft: FeedbackFile, id: string): Remark {
  const remark = draft.remarks.find((candidate) => candidate.id === id);
  if (!remark) throw new DesignError(`Remark "${id}" not found.`);
  draft.remarks = draft.remarks.filter((candidate) => candidate.id !== id);
  return remark;
}

/** Retire les remarques d'un design supprimé et les renvoie. */
export function deleteDesignRemarks(draft: FeedbackFile, designId: string): Remark[] {
  const gone = draft.remarks.filter((remark) => remark.designId === designId);
  draft.remarks = draft.remarks.filter((remark) => remark.designId !== designId);
  delete draft.lastNumbers[designId];
  return gone;
}

/**
 * Fige les brouillons choisis dans un nouveau retour nommé, et les marque
 * transmis. `names` donne le nom de chaque design existant.
 */
export function submitRound(
  draft: FeedbackFile,
  remarkIds: string[],
  title: string,
  names: Map<string, string>
): FeedbackRound {
  if (remarkIds.length === 0) throw new DesignError("Select at least one remark to send.");
  const name = requireTitle(title);

  const number = draft.rounds.length + 1;
  const submittedAt = new Date().toISOString();
  const selected = new Set(remarkIds);
  const remarks = orderRemarks(draft.remarks.filter((remark) => selected.has(remark.id)));
  for (const id of selected) draftOf(draft, id);

  const round: FeedbackRound = {
    number,
    title: name,
    submittedAt,
    remarks: remarks.map((remark) => {
      const designName = names.get(remark.designId);
      if (designName === undefined) throw new DesignError(`Design "${remark.designId}" of remark "${remark.id}" no longer exists.`);
      return {
        id: remark.id,
        designId: remark.designId,
        designName,
        number: remark.number,
        target: remark.target,
        text: remark.text,
        capture: remark.capture,
        processed: null,
      };
    }),
  };
  for (const remark of remarks) {
    remark.status = "sent";
    remark.round = number;
    remark.updatedAt = submittedAt;
  }
  draft.rounds.push(round);
  return round;
}

function roundOf(file: FeedbackFile, number: number): FeedbackRound {
  const round = file.rounds.find((candidate) => candidate.number === number);
  if (!round) throw new DesignError(`Feedback round ${number} not found. Rounds 1 to ${file.rounds.length} exist.`);
  return round;
}

export function renameRound(draft: FeedbackFile, number: number, title: string): FeedbackRound {
  const name = requireTitle(title);
  const round = roundOf(draft, number);
  round.title = name;
  return round;
}

/**
 * Déclare des remarques d'un retour traitées, ou les rouvre. Une remarque
 * déjà traitée reste inchangée ; une nouvelle note remplace l'ancienne et
 * son auteur, en gardant la date d'origine.
 */
export function setRemarksProcessed(draft: FeedbackFile, input: SetProcessedInput): FeedbackRound {
  const note = typeof input.note === "string" && input.note.trim() !== "" ? input.note.trim() : null;
  const round = roundOf(draft, input.round);
  const ids = input.remarkIds ?? round.remarks.map((remark) => remark.id);
  if (ids.length === 0) throw new DesignError("Name at least one remark of the round.");
  const targets = ids.map((id) => {
    const remark = round.remarks.find((candidate) => candidate.id === id);
    if (!remark) throw new DesignError(`Remark "${id}" is not part of feedback round ${round.number}.`);
    return remark;
  });
  const at = new Date().toISOString();
  for (const remark of targets) {
    if (!input.processed) {
      remark.processed = null;
      continue;
    }
    // Une remarque déjà traitée le reste telle quelle, sauf nouvelle note :
    // tout marquer d'un coup ne réattribue pas le travail de l'agent.
    if (remark.processed && note === null) continue;
    remark.processed = { at: remark.processed?.at ?? at, by: input.by, note };
  }
  return round;
}

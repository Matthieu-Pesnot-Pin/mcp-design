import fs from "fs";
import path from "path";
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
import type { Box } from "../../shared/tree.js";
import type { DesignStore } from "./design-store.js";
import { withFileLock } from "./file-lock.js";
import { shortId } from "./ids.js";
import { DesignError } from "./node-factory.js";
import { screenshotDesign } from "./screenshot.js";

/** Marge autour d'un élément capturé, comme `screenshot_design`. */
const NODE_CAPTURE_PADDING = 16;

/** Cible demandée par la GUI ; le serveur la complète d'après le design. */
export type RemarkTargetInput =
  | { kind: "page" }
  | { kind: "node"; nodeId: string }
  | { kind: "area"; box: Box; elementIds: string[] };

export interface AddRemarkInput {
  designId: string;
  target: RemarkTargetInput;
  text: string;
  /** Joindre une capture de l'élément ou de la zone. Sans effet sur une remarque de page. */
  capture: boolean;
}

function emptyFile(): FeedbackFile {
  return { version: 2, remarks: [], rounds: [], lastNumbers: {} };
}

function requireText(text: unknown): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (value === "") throw new DesignError("A remark needs some text.");
  return value;
}

function requireTitle(title: unknown): string {
  const value = typeof title === "string" ? title.trim() : "";
  if (value === "") throw new DesignError("A feedback round needs a name.");
  return value;
}

export interface SetProcessedInput {
  round: number;
  /** Remarques visées ; toutes celles du retour quand omis. */
  remarkIds?: string[];
  processed: boolean;
  by: "agent" | "user";
  note?: string | null;
}

/**
 * Remarques de l'utilisateur et retours transmis à l'agent, dans
 * `<dataDir>/feedback/remarks.json`, captures dans `<dataDir>/feedback/captures`.
 *
 * Un seul fichier pour tout le projet : un retour peut couvrir plusieurs pages.
 */
export class FeedbackStore {
  private readonly dir: string;
  private readonly capturesDir: string;
  private readonly file: string;

  constructor(private readonly designs: DesignStore) {
    this.dir = path.join(designs.getDataDir(), "feedback");
    this.capturesDir = path.join(this.dir, "captures");
    this.file = path.join(this.dir, "remarks.json");
    fs.mkdirSync(this.capturesDir, { recursive: true });
  }

  getFilePath(): string {
    return this.file;
  }

  read(): FeedbackFile {
    if (!fs.existsSync(this.file)) return emptyFile();
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
    } catch (err: any) {
      throw new DesignError(`The remarks file ${this.file} is not readable: ${err.message}`);
    }
    // Un fichier d'une version antérieure est lu au format courant ; il n'est
    // réécrit qu'à la prochaine modification.
    const parsed = FeedbackFileSchema.safeParse(migrateFeedbackFile(raw, defaultRoundTitle) ?? raw);
    if (!parsed.success) {
      throw new DesignError(
        `The remarks file ${this.file} does not match the expected schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`
      );
    }
    return parsed.data;
  }

  private mutate<T>(fn: (draft: FeedbackFile) => T): T {
    return withFileLock(`${this.file}.lock`, "The remarks file", () => {
      const draft = structuredClone(this.read());
      const result = fn(draft);
      const parsed = FeedbackFileSchema.safeParse(draft);
      if (!parsed.success) {
        throw new DesignError(
          `Resulting remarks file is invalid: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`
        );
      }
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(parsed.data, null, 2), "utf-8");
      fs.renameSync(tmp, this.file);
      return result;
    });
  }

  remarks(designId?: string): Remark[] {
    const remarks = this.read().remarks;
    return designId === undefined ? remarks : remarks.filter((remark) => remark.designId === designId);
  }

  rounds(): FeedbackRound[] {
    return this.read().rounds;
  }

  capturePath(name: string): string {
    if (name !== path.basename(name)) throw new DesignError(`Invalid capture name "${name}".`);
    return path.join(this.capturesDir, name);
  }

  readCapture(name: string): Buffer {
    const file = this.capturePath(name);
    if (!fs.existsSync(file)) throw new DesignError(`Capture "${name}" not found in ${this.capturesDir}.`);
    return fs.readFileSync(file);
  }

  /** Complète la cible d'après l'état courant du design. */
  private resolveTarget(designId: string, input: RemarkTargetInput): RemarkTarget {
    const design = this.designs.get(designId);
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

  private renderCapture(designId: string, target: RemarkTarget): Buffer {
    const design = this.designs.get(designId);
    if (target.kind === "node") {
      return screenshotDesign(design, { nodeId: target.element.id, padding: NODE_CAPTURE_PADDING, images: this.designs.images }).png;
    }
    if (target.kind === "area") return screenshotDesign(design, { region: target.box, images: this.designs.images }).png;
    throw new DesignError("A page remark has no capture.");
  }

  add(input: AddRemarkInput): Remark {
    const text = requireText(input.text);
    const target = this.resolveTarget(input.designId, input.target);
    const id = shortId("rm");
    const capture = input.capture && target.kind !== "page" ? `${id}.png` : null;
    // Rendue hors verrou : la capture ne dépend que du design, et resvg peut
    // prendre plus de temps qu'un autre écrivain n'en accepte d'attendre.
    const png = capture ? this.renderCapture(input.designId, target) : null;

    return this.mutate((draft) => {
      if (
        target.kind === "page" &&
        draft.remarks.some(
          (remark) => remark.designId === input.designId && remark.status === "draft" && remark.target.kind === "page"
        )
      ) {
        throw new DesignError("This page already has a remark on the whole page: edit it instead of adding another one.");
      }

      let number: number | null = null;
      if (target.kind !== "page") {
        number = (draft.lastNumbers[input.designId] ?? 0) + 1;
        draft.lastNumbers[input.designId] = number;
      }

      if (capture && png) fs.writeFileSync(this.capturePath(capture), png);

      const now = new Date().toISOString();
      const remark: Remark = {
        id,
        designId: input.designId,
        number,
        target,
        text,
        capture,
        status: "draft",
        round: null,
        createdAt: now,
        updatedAt: now,
      };
      draft.remarks.push(remark);
      return remark;
    });
  }

  private draftOf(file: FeedbackFile, id: string): Remark {
    const remark = file.remarks.find((candidate) => candidate.id === id);
    if (!remark) throw new DesignError(`Remark "${id}" not found.`);
    if (remark.status !== "draft") {
      throw new DesignError(`Remark "${id}" was sent with feedback round ${remark.round}: it can no longer be edited.`);
    }
    return remark;
  }

  updateText(id: string, text: string): Remark {
    const value = requireText(text);
    return this.mutate((draft) => {
      const remark = this.draftOf(draft, id);
      remark.text = value;
      remark.updatedAt = new Date().toISOString();
      return remark;
    });
  }

  /**
   * Retire une remarque de la liste. La capture d'un brouillon part avec lui ;
   * celle d'une remarque transmise reste, le retour qui la contient la cite.
   */
  delete(id: string): void {
    const removed = this.mutate((draft) => {
      const remark = draft.remarks.find((candidate) => candidate.id === id);
      if (!remark) throw new DesignError(`Remark "${id}" not found.`);
      draft.remarks = draft.remarks.filter((candidate) => candidate.id !== id);
      return remark;
    });
    if (removed.status === "draft" && removed.capture) fs.rmSync(this.capturePath(removed.capture), { force: true });
  }

  /** Retire les remarques d'un design supprimé, selon la même règle que `delete`. */
  deleteDesign(designId: string): void {
    const removed = this.mutate((draft) => {
      const gone = draft.remarks.filter((remark) => remark.designId === designId);
      draft.remarks = draft.remarks.filter((remark) => remark.designId !== designId);
      delete draft.lastNumbers[designId];
      return gone;
    });
    for (const remark of removed) {
      if (remark.status === "draft" && remark.capture) fs.rmSync(this.capturePath(remark.capture), { force: true });
    }
  }

  /** Fige les brouillons choisis dans un nouveau retour nommé, et les marque transmis. */
  submit(remarkIds: string[], title: string): FeedbackRound {
    if (remarkIds.length === 0) throw new DesignError("Select at least one remark to send.");
    const name = requireTitle(title);
    const names = new Map(this.designs.list().map((design) => [design.id, design.name]));

    return this.mutate((draft) => {
      const number = draft.rounds.length + 1;
      const submittedAt = new Date().toISOString();
      const selected = new Set(remarkIds);
      const remarks = orderRemarks(draft.remarks.filter((remark) => selected.has(remark.id)));
      for (const id of selected) this.draftOf(draft, id);

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
    });
  }

  private roundOf(file: FeedbackFile, number: number): FeedbackRound {
    const round = file.rounds.find((candidate) => candidate.number === number);
    if (!round) throw new DesignError(`Feedback round ${number} not found. Rounds 1 to ${file.rounds.length} exist.`);
    return round;
  }

  rename(number: number, title: string): FeedbackRound {
    const name = requireTitle(title);
    return this.mutate((draft) => {
      const round = this.roundOf(draft, number);
      round.title = name;
      return round;
    });
  }

  /**
   * Déclare des remarques d'un retour traitées, ou les rouvre. Une remarque
   * déjà traitée reste inchangée ; une nouvelle note remplace l'ancienne et
   * son auteur, en gardant la date d'origine.
   */
  setProcessed(input: SetProcessedInput): FeedbackRound {
    const note = typeof input.note === "string" && input.note.trim() !== "" ? input.note.trim() : null;
    return this.mutate((draft) => {
      const round = this.roundOf(draft, input.round);
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
    });
  }
}

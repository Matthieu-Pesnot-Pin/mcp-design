import fs from "fs";
import path from "path";
import type { FeedbackRound, Remark, RemarkTarget } from "../../shared/feedback.js";
import type { FeedbackFile } from "../../shared/schemas/feedback.schema.js";
import type { DesignStore } from "./design-store.js";
import { withFileLock } from "./file-lock.js";
import { shortId } from "./ids.js";
import { DesignError } from "./node-factory.js";
import { screenshotDesign } from "./screenshot.js";
import {
  NODE_CAPTURE_PADDING,
  addRemark,
  deleteDesignRemarks,
  deleteRemark,
  emptyFeedbackFile,
  parseFeedbackFile,
  renameRound,
  requireRemarkText,
  resolveRemarkTarget,
  setRemarksProcessed,
  submitRound,
  updateRemarkText,
  validatedFeedbackFile,
  type RemarkTargetInput,
  type SetProcessedInput,
} from "./feedback-model.js";

export type { RemarkTargetInput, SetProcessedInput };

export interface AddRemarkInput {
  designId: string;
  target: RemarkTargetInput;
  text: string;
  /** Joindre une capture de l'élément ou de la zone. Sans effet sur une remarque de page. */
  capture: boolean;
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
    if (!fs.existsSync(this.file)) return emptyFeedbackFile();
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
    } catch (err: any) {
      throw new DesignError(`The remarks file ${this.file} is not readable: ${err.message}`);
    }
    // Un fichier d'une version antérieure est lu au format courant ; il n'est
    // réécrit qu'à la prochaine modification.
    return parseFeedbackFile(raw, `The remarks file ${this.file}`);
  }

  private mutate<T>(fn: (draft: FeedbackFile) => T): T {
    return withFileLock(`${this.file}.lock`, "The remarks file", () => {
      const draft = structuredClone(this.read());
      const result = fn(draft);
      const validated = validatedFeedbackFile(draft);
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), "utf-8");
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

  private renderCapture(designId: string, target: RemarkTarget): Buffer {
    const design = this.designs.get(designId);
    if (target.kind === "node") {
      return screenshotDesign(design, { nodeId: target.element.id, padding: NODE_CAPTURE_PADDING, images: this.designs.images }).png;
    }
    if (target.kind === "area") return screenshotDesign(design, { region: target.box, images: this.designs.images }).png;
    throw new DesignError("A page remark has no capture.");
  }

  add(input: AddRemarkInput): Remark {
    const text = requireRemarkText(input.text);
    const target = resolveRemarkTarget(this.designs.get(input.designId), input.target);
    const id = shortId("rm");
    const capture = input.capture && target.kind !== "page" ? `${id}.png` : null;
    // Rendue hors verrou : la capture ne dépend que du design, et resvg peut
    // prendre plus de temps qu'un autre écrivain n'en accepte d'attendre.
    const png = capture ? this.renderCapture(input.designId, target) : null;

    return this.mutate((draft) => {
      const remark = addRemark(draft, { id, designId: input.designId, target, text, capture });
      if (capture && png) fs.writeFileSync(this.capturePath(capture), png);
      return remark;
    });
  }

  updateText(id: string, text: string): Remark {
    return this.mutate((draft) => updateRemarkText(draft, id, text));
  }

  /**
   * Retire une remarque de la liste. La capture d'un brouillon part avec lui ;
   * celle d'une remarque transmise reste, le retour qui la contient la cite.
   */
  delete(id: string): void {
    const removed = this.mutate((draft) => deleteRemark(draft, id));
    if (removed.status === "draft" && removed.capture) fs.rmSync(this.capturePath(removed.capture), { force: true });
  }

  /** Retire les remarques d'un design supprimé, selon la même règle que `delete`. */
  deleteDesign(designId: string): void {
    const removed = this.mutate((draft) => deleteDesignRemarks(draft, designId));
    for (const remark of removed) {
      if (remark.status === "draft" && remark.capture) fs.rmSync(this.capturePath(remark.capture), { force: true });
    }
  }

  /** Fige les brouillons choisis dans un nouveau retour nommé, et les marque transmis. */
  submit(remarkIds: string[], title: string): FeedbackRound {
    const names = new Map(this.designs.list().map((design) => [design.id, design.name]));
    return this.mutate((draft) => submitRound(draft, remarkIds, title, names));
  }

  rename(number: number, title: string): FeedbackRound {
    return this.mutate((draft) => renameRound(draft, number, title));
  }

  setProcessed(input: SetProcessedInput): FeedbackRound {
    return this.mutate((draft) => setRemarksProcessed(draft, input));
  }
}

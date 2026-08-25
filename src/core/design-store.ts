import fs from "fs";
import path from "path";
import {
  DesignSchema,
  type Design,
  type DesignNode,
  type DesignSummary,
} from "../../shared/schemas/design.schema.js";
import { DesignError } from "./node-factory.js";
import { normalizeHierarchy } from "./hierarchy.js";
import { shortId, slugify } from "./ids.js";
import { countChanges } from "./diff.js";

export interface CreateDesignInput {
  name: string;
  width?: number;
  height?: number;
  background?: string;
}

/**
 * Persistance des designs : un fichier JSON par design dans <dataDir>/designs.
 * Pas de base de données — un design tient dans quelques dizaines de Ko et le
 * format doit rester lisible/diffable à la main.
 */
export class DesignStore {
  private readonly dataDir: string;
  private readonly designsDir: string;
  /** Cache mémoire : la GUI sauvegarde à chaque geste, relire le disque à chaque fois serait inutile. */
  private cache = new Map<string, Design>();

  constructor(rootDir: string) {
    // MCP_DESIGN_DATA_DIR est prioritaire ; MCP_DATA_DIR reste accepté pour rester
    // aligné sur la convention commune aux autres MCPs de l'écosystème.
    const configured = process.env.MCP_DESIGN_DATA_DIR?.trim() || process.env.MCP_DATA_DIR?.trim();
    this.dataDir = configured ? path.resolve(configured) : path.join(rootDir, ".design-data");
    this.designsDir = path.join(this.dataDir, "designs");
    fs.mkdirSync(this.designsDir, { recursive: true });
  }

  getDataDir(): string {
    return this.dataDir;
  }

  private filePath(id: string): string {
    return path.join(this.designsDir, `${id}.json`);
  }

  private write(design: Design): void {
    // Écriture atomique : un crash pendant l'écriture ne laisse pas un JSON tronqué.
    const target = this.filePath(design.id);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(design, null, 2), "utf-8");
    fs.renameSync(tmp, target);
    this.cache.set(design.id, design);
  }

  /** Identifiant lisible dérivé du nom, suffixé seulement en cas de collision. */
  private allocateId(name: string): string {
    const base = slugify(name);
    if (!fs.existsSync(this.filePath(base))) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`;
      if (!fs.existsSync(this.filePath(candidate))) return candidate;
    }
    return `${base}-${shortId("x", 4)}`;
  }

  list(): DesignSummary[] {
    const files = fs.existsSync(this.designsDir)
      ? fs.readdirSync(this.designsDir).filter((f) => f.endsWith(".json"))
      : [];

    const summaries: DesignSummary[] = [];
    for (const file of files) {
      const id = file.slice(0, -".json".length);
      let design: Design;
      try {
        design = this.get(id);
      } catch {
        continue; // Fichier corrompu ou hors schéma : il ne doit pas casser la liste.
      }
      summaries.push({
        id: design.id,
        name: design.name,
        width: design.width,
        height: design.height,
        nodeCount: design.nodes.length,
        updatedAt: design.updatedAt,
        revision: design.revision,
        lastEditor: design.lastEditor,
        pendingChanges: countChanges(design.baseline.nodes, design.nodes),
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  has(id: string): boolean {
    return fs.existsSync(this.filePath(id));
  }

  get(id: string): Design {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const file = this.filePath(id);
    if (!fs.existsSync(file)) {
      throw new DesignError(`Design "${id}" not found. Use list_designs to see the available designs.`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err: any) {
      throw new DesignError(`Design "${id}" is not readable: ${err.message}`);
    }
    const parsed = DesignSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DesignError(
        `Design "${id}" does not match the expected schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`
      );
    }
    this.cache.set(id, parsed.data);
    return parsed.data;
  }

  create(input: CreateDesignInput): Design {
    const name = input.name?.trim();
    if (!name) throw new DesignError(`"name" is required to create a design.`);

    const width = input.width ?? 1440;
    const height = input.height ?? 900;
    if (!Number.isFinite(width) || width <= 0) throw new DesignError(`"width" must be a positive number.`);
    if (!Number.isFinite(height) || height <= 0) throw new DesignError(`"height" must be a positive number.`);

    const now = new Date().toISOString();
    const design: Design = {
      id: this.allocateId(name),
      name,
      width,
      height,
      background: input.background ?? "#ffffff",
      nodes: [],
      createdAt: now,
      updatedAt: now,
      revision: 0,
      lastEditor: "agent",
      baseline: { revision: 0, at: now, nodes: [] },
    };
    this.write(design);
    return design;
  }

  /**
   * Applique une mutation et incrémente la révision. `editor` distingue une
   * modification de l'agent d'une modification faite à la main dans la GUI —
   * c'est ce qui permet à get_changes de rester lisible.
   */
  mutate(id: string, editor: "agent" | "user", fn: (design: Design) => void): Design {
    const current = this.get(id);
    const draft: Design = structuredClone(current);
    fn(draft);
    // Les invariants de hiérarchie sont vérifiés ici, une seule fois : aucun
    // appelant — outil MCP ou sauvegarde depuis la GUI — ne peut les contourner.
    draft.nodes = normalizeHierarchy(draft.nodes);
    draft.revision = current.revision + 1;
    draft.updatedAt = new Date().toISOString();
    draft.lastEditor = editor;

    const parsed = DesignSchema.safeParse(draft);
    if (!parsed.success) {
      throw new DesignError(
        `Resulting design is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
      );
    }
    this.write(parsed.data);
    return parsed.data;
  }

  /** Fige l'état courant comme nouvelle référence de comparaison. */
  markSynced(id: string): Design {
    const current = this.get(id);
    const now = new Date().toISOString();
    const next: Design = {
      ...structuredClone(current),
      baseline: { revision: current.revision, at: now, nodes: structuredClone(current.nodes) as DesignNode[] },
    };
    this.write(next);
    return next;
  }

  delete(id: string): void {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) {
      throw new DesignError(`Design "${id}" not found.`);
    }
    fs.unlinkSync(file);
    this.cache.delete(id);
  }
}

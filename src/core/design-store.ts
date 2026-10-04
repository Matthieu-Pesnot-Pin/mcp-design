import fs from "fs";
import path from "path";
import {
  DesignSchema,
  normalizeDesignGroup,
  type Design,
  type DesignNode,
  type DesignSummary,
} from "../../shared/schemas/design.schema.js";
import { DesignError } from "./node-factory.js";
import { withFileLock } from "./file-lock.js";
import { normalizeHierarchy } from "./hierarchy.js";
import { migrateDesign } from "./migrate.js";
import { shortId, slugify } from "./ids.js";
import { countChanges } from "./diff.js";

export interface CreateDesignInput {
  name: string;
  width?: number;
  height?: number;
  background?: string;
  /** Groupe de pages, chemin "Parent/Enfant". Null ou omis : a la racine. */
  group?: string | null;
}

export interface MutateOptions {
  /**
   * Révision sur laquelle l'édition est basée. Quand elle est fournie et que le
   * fichier a avancé entre-temps, l'écriture est refusée : sans cette garde, un
   * éditeur parti d'un état périmé réécrit le document entier et efface le
   * travail de l'autre.
   */
  baseRevision?: number;
}

/** Signature de fichier servant à détecter l'écriture d'un autre processus. */
interface FileStamp {
  mtimeMs: number;
  size: number;
}

interface CacheEntry {
  design: Design;
  stamp: FileStamp;
}

/**
 * Persistance des designs : un fichier JSON par design dans <dataDir>/designs.
 * Pas de base de données — un design tient dans quelques dizaines de Ko et le
 * format doit rester lisible/diffable à la main.
 */
export class DesignStore {
  private readonly dataDir: string;
  private readonly designsDir: string;
  /**
   * Cache mémoire : la GUI sauvegarde à chaque geste, relire le disque à chaque
   * fois serait inutile. Chaque entrée retient la signature du fichier au moment
   * de la lecture — plusieurs processus (une seconde GUI, un second agent MCP)
   * partagent le même dataDir, le cache ne peut donc jamais faire autorité seul.
   */
  private cache = new Map<string, CacheEntry>();

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

  /** Signature du fichier, ou null s'il n'existe pas encore. */
  private stampOf(id: string): FileStamp | null {
    try {
      const stat = fs.statSync(this.filePath(id));
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  }

  private remember(design: Design): void {
    const stamp = this.stampOf(design.id);
    // Sans signature lisible, on préfère ne rien cacher : la prochaine lecture
    // repartira du disque plutôt que de servir un état peut-être dépassé.
    if (stamp) this.cache.set(design.id, { design, stamp });
    else this.cache.delete(design.id);
  }

  private write(design: Design): void {
    // Écriture atomique : un crash pendant l'écriture ne laisse pas un JSON tronqué.
    const target = this.filePath(design.id);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(design, null, 2), "utf-8");
    fs.renameSync(tmp, target);
    // La signature est relue après le rename : sans ça, la lecture suivante
    // prendrait notre propre écriture pour une modification externe.
    this.remember(design);
  }

  /** Verrou inter-processus du fichier d'un design. Non réentrant — ne jamais appeler depuis `fn`. */
  private withLock<T>(id: string, fn: () => T): T {
    return withFileLock(`${this.filePath(id)}.lock`, `Design "${id}"`, fn);
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
        group: design.group,
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
    const stamp = this.stampOf(id);
    const cached = this.cache.get(id);
    // Le cache ne vaut que tant que le fichier n'a pas bougé sous nos pieds.
    if (cached && stamp && cached.stamp.mtimeMs === stamp.mtimeMs && cached.stamp.size === stamp.size) {
      return cached.design;
    }
    this.cache.delete(id);

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
    // Mise à niveau du format avant validation : un fichier écrit par une
    // version antérieure reste lisible, et n'est réécrit qu'en cas de changement.
    const migrated = migrateDesign(raw);

    const parsed = DesignSchema.safeParse(migrated ?? raw);
    if (!parsed.success) {
      throw new DesignError(
        `Design "${id}" does not match the expected schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`
      );
    }
    if (migrated) {
      // Best effort : un répertoire de données en lecture seule ne doit pas
      // empêcher de lire le design, la migration reste appliquée en mémoire.
      // Écriture volontairement hors verrou : `get` est appelé depuis l'intérieur
      // de `withLock`, et le verrou n'est pas réentrant. Le contenu écrit est
      // celui qu'on vient de lire, la mise à niveau ne perd donc rien.
      try {
        this.write(parsed.data);
      } catch {
        this.cache.delete(id);
      }
      return parsed.data;
    }
    if (stamp) this.cache.set(id, { design: parsed.data, stamp });
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
      group: normalizeDesignGroup(input.group),
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
   * Nouveau design reprenant la planche et tous les éléments d'un design
   * existant, identifiants compris. La copie part synchronisée : sa référence
   * de comparaison est son propre contenu.
   */
  duplicate(sourceId: string, input: { name?: string; group?: string | null } = {}): Design {
    const source = this.get(sourceId);
    const name = input.name?.trim() || `${source.name} (copy)`;
    const now = new Date().toISOString();
    const design: Design = {
      id: this.allocateId(name),
      name,
      group: input.group === undefined ? source.group : normalizeDesignGroup(input.group),
      width: source.width,
      height: source.height,
      background: source.background,
      nodes: structuredClone(source.nodes),
      createdAt: now,
      updatedAt: now,
      revision: 0,
      lastEditor: "agent",
      baseline: { revision: 0, at: now, nodes: structuredClone(source.nodes) },
    };
    this.write(design);
    return design;
  }

  /**
   * Applique une mutation et incrémente la révision. `editor` distingue une
   * modification de l'agent d'une modification faite à la main dans la GUI —
   * c'est ce qui permet à get_changes de rester lisible.
   */
  mutate(
    id: string,
    editor: "agent" | "user",
    fn: (design: Design) => void,
    options: MutateOptions = {}
  ): Design {
    // Tout le cycle lire-modifier-écrire tient dans le verrou : hors de là, deux
    // processus peuvent lire le même état puis s'écraser l'un l'autre.
    return this.withLock(id, () => this.mutateLocked(id, editor, fn, options));
  }

  private mutateLocked(
    id: string,
    editor: "agent" | "user",
    fn: (design: Design) => void,
    options: MutateOptions
  ): Design {
    const current = this.get(id);

    if (options.baseRevision !== undefined && options.baseRevision !== current.revision) {
      throw new DesignError(
        `Design "${id}" has changed since it was loaded: your edit is based on revision ${options.baseRevision}, ` +
          `the stored design is at revision ${current.revision}. Reload it with get_design and reapply your change — ` +
          `writing now would discard the other editor's work.`
      );
    }

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
    return this.withLock(id, () => {
      const current = this.get(id);
      const now = new Date().toISOString();
      const next: Design = {
        ...structuredClone(current),
        baseline: { revision: current.revision, at: now, nodes: structuredClone(current.nodes) as DesignNode[] },
      };
      this.write(next);
      return next;
    });
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

import {
  DesignSchema,
  normalizeDesignGroup,
  type Design,
  type DesignNode,
  type DesignSummary,
} from "../../shared/schemas/design.schema.js";
import { DesignError } from "./node-factory.js";
import { normalizeHierarchy } from "./hierarchy.js";
import { migrateDesign } from "./migrate.js";
import { shortId, slugify } from "./ids.js";
import { countChanges } from "./diff.js";

/**
 * Règles d'un design indépendantes de son stockage : création, copie,
 * mutation validée, synchronisation. Le `DesignStore` du serveur les applique à
 * des fichiers JSON, la version autonome de la GUI à son projet en mémoire.
 */

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
   * design a avancé entre-temps, l'écriture est refusée : sans cette garde, un
   * éditeur parti d'un état périmé réécrit le document entier et efface le
   * travail de l'autre.
   */
  baseRevision?: number;
}

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.message}`).join("; ");
}

/** Identifiant lisible dérivé du nom, suffixé seulement en cas de collision. */
export function allocateDesignId(name: string, exists: (id: string) => boolean): string {
  const base = slugify(name);
  if (!exists(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base}-${shortId("x", 4)}`;
}

/**
 * Lit un design brut, après mise à niveau de son format. `migrated` indique
 * qu'il diffère de ce qui a été lu et mérite d'être réécrit.
 */
export function parseDesign(raw: unknown, label: string): { design: Design; migrated: boolean } {
  const migrated = migrateDesign(raw);
  const parsed = DesignSchema.safeParse(migrated ?? raw);
  if (!parsed.success) {
    throw new DesignError(`Design ${label} does not match the expected schema: ${issuesOf(parsed.error)}`);
  }
  return { design: parsed.data, migrated: migrated !== null };
}

export function newDesign(id: string, input: CreateDesignInput, now: string): Design {
  const name = input.name?.trim();
  if (!name) throw new DesignError(`"name" is required to create a design.`);

  const width = input.width ?? 1440;
  const height = input.height ?? 900;
  if (!Number.isFinite(width) || width <= 0) throw new DesignError(`"width" must be a positive number.`);
  if (!Number.isFinite(height) || height <= 0) throw new DesignError(`"height" must be a positive number.`);

  return {
    id,
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
}

/**
 * Nouveau design reprenant la planche et tous les éléments d'un design
 * existant, identifiants compris. La copie part synchronisée : sa référence
 * de comparaison est son propre contenu.
 */
export function duplicatedDesign(
  source: Design,
  id: string,
  input: { name?: string; group?: string | null },
  now: string
): Design {
  const name = input.name?.trim() || `${source.name} (copy)`;
  return {
    id,
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
}

/**
 * Applique une mutation à une copie du design et incrémente la révision.
 * `editor` distingue une modification de l'agent d'une modification faite à la
 * main dans la GUI — c'est ce qui permet à get_changes de rester lisible.
 */
export function mutatedDesign(
  current: Design,
  editor: "agent" | "user",
  fn: (design: Design) => void,
  options: MutateOptions = {}
): Design {
  if (options.baseRevision !== undefined && options.baseRevision !== current.revision) {
    throw new DesignError(
      `Design "${current.id}" has changed since it was loaded: your edit is based on revision ${options.baseRevision}, ` +
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
  if (!parsed.success) throw new DesignError(`Resulting design is invalid: ${issuesOf(parsed.error)}`);
  return parsed.data;
}

/** Le design avec son état courant comme nouvelle référence de comparaison. */
export function syncedDesign(current: Design, now: string): Design {
  return {
    ...structuredClone(current),
    baseline: { revision: current.revision, at: now, nodes: structuredClone(current.nodes) as DesignNode[] },
  };
}

export function summaryOf(design: Design): DesignSummary {
  return {
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
  };
}

/** Plus récemment modifiés d'abord, comme la liste des pages de la GUI. */
export function sortSummaries(summaries: DesignSummary[]): DesignSummary[] {
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

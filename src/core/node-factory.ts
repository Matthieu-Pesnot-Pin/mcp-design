import { DesignNodeSchema, type DesignNode, type NodeType } from "../../shared/schemas/design.schema.js";
import {
  NODE_DEFAULTS,
  NODE_GEOMETRY_FIELDS,
  NODE_STYLE_FIELDS,
  clampNodeSize,
  defaultNodeName,
} from "../../shared/node-defaults.js";
import { shortId } from "./ids.js";

export class DesignError extends Error {}

const GEOMETRY = NODE_GEOMETRY_FIELDS as ReadonlyArray<keyof DesignNode>;
const ALLOWED = NODE_STYLE_FIELDS as Record<NodeType, ReadonlyArray<keyof DesignNode>>;

function requireFiniteNumber(value: unknown, field: string): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new DesignError(`"${field}" must be a finite number (received: ${JSON.stringify(value)})`);
  }
  return num;
}

export interface CreateNodeInput {
  [key: string]: unknown;
  type?: unknown;
}

/**
 * Construit un noeud complet et valide à partir d'une entrée partielle d'agent :
 * seul `type` est obligatoire, tout le reste vient des valeurs par défaut, ce qui
 * évite les noeuds invisibles (taille nulle, pas de remplissage).
 *
 * `existingIds` empêche une collision d'identifiants fournis explicitement.
 */
export function buildNode(input: CreateNodeInput, existingIds: Set<string>, index: number): DesignNode {
  const type = input.type as NodeType;
  if (!type || !(type in NODE_DEFAULTS)) {
    throw new DesignError(`Unknown node type "${String(input.type)}". Expected one of: rect, ellipse, line, text.`);
  }

  const id = typeof input.id === "string" && input.id.trim() !== "" ? input.id.trim() : shortId("n");
  if (existingIds.has(id)) throw new DesignError(`Node id "${id}" already exists in this design.`);

  const draft: Record<string, unknown> = {
    id,
    type,
    name: typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : defaultNodeName(type, index),
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    ...NODE_DEFAULTS[type],
  };

  for (const field of GEOMETRY) {
    if (input[field] !== undefined) draft[field] = requireFiniteNumber(input[field], field as string);
  }
  for (const field of ALLOWED[type]) {
    if (input[field] !== undefined) draft[field] = input[field];
  }

  const size = clampNodeSize(type, Number(draft.width), Number(draft.height));
  draft.width = size.width;
  draft.height = size.height;

  const parsed = DesignNodeSchema.safeParse(draft);
  if (!parsed.success) {
    throw new DesignError(
      `Invalid node: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
    );
  }
  return parsed.data;
}

/** Applique un patch partiel en ne conservant que les champs valides pour le type du noeud. */
export function applyPatch(node: DesignNode, patch: Record<string, unknown>): DesignNode {
  const next: Record<string, unknown> = { ...node };

  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || patch.name.trim() === "") {
      throw new DesignError(`"name" must be a non-empty string.`);
    }
    next.name = patch.name.trim();
  }
  for (const field of GEOMETRY) {
    if (patch[field] !== undefined) next[field] = requireFiniteNumber(patch[field], field as string);
  }
  for (const field of ALLOWED[node.type]) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }

  const unknownFields = Object.keys(patch).filter(
    (key) =>
      key !== "id" &&
      key !== "name" &&
      !GEOMETRY.includes(key as keyof DesignNode) &&
      !ALLOWED[node.type].includes(key as keyof DesignNode)
  );
  if (unknownFields.length > 0) {
    throw new DesignError(
      `Field(s) [${unknownFields.join(", ")}] cannot be set on a "${node.type}" node. ` +
        `Allowed: ${["name", ...GEOMETRY, ...ALLOWED[node.type]].join(", ")}.`
    );
  }

  const parsed = DesignNodeSchema.safeParse(next);
  if (!parsed.success) {
    throw new DesignError(
      `Invalid patch: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
    );
  }
  return parsed.data;
}

export { NODE_DEFAULTS };

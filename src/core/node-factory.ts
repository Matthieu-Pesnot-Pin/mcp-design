import { DesignNodeSchema, type DesignNode, type NodeType } from "../../shared/schemas/design.schema.js";
import {
  GROUP_DERIVED_FIELDS,
  NODE_DEFAULTS,
  NODE_GEOMETRY_FIELDS,
  NODE_STYLE_FIELDS,
  SIZE_DERIVED_KINDS,
  clampNodeSize,
  defaultNodeName,
} from "../../shared/node-defaults.js";
import { hugsText, measuredTextHeight, type RenderNode } from "../../shared/render.js";
import { CORE_ICONS, hasIcon, iconCount } from "../../shared/icons/index.js";
import { suggestIcons } from "../../shared/icons/search.js";
import { shortId } from "./ids.js";

export class DesignError extends Error {}

const GEOMETRY = NODE_GEOMETRY_FIELDS as ReadonlyArray<keyof DesignNode>;
const ALLOWED = NODE_STYLE_FIELDS as Record<NodeType, ReadonlyArray<keyof DesignNode>>;
const DERIVED = GROUP_DERIVED_FIELDS as ReadonlyArray<keyof DesignNode>;

/**
 * Valide le nom d'icone d'un noeud `icon`.
 *
 * Un nom refuse doit repartir avec une piste : sans cela l'agent retombe sur ce
 * qu'on cherche precisement a eviter — reconstituer l'icone a coups d'ellipses.
 * Les suggestions passent par les synonymes de la bibliotheque, ce qui rattrape
 * aussi bien une faute qu'un renommage ("home" -> "house").
 */
function requireIconName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") {
    throw new DesignError(
      `An "icon" node needs an "icon" field naming the icon to draw, e.g. "shopping-cart". ` +
        `Call search_icons to find one among the ${iconCount()} available, or pick from: ${CORE_ICONS.slice(0, 24).join(", ")}...`
    );
  }
  if (hasIcon(name)) return name;

  const suggestions = suggestIcons(name);
  throw new DesignError(
    `Unknown icon "${name}".` +
      (suggestions.length > 0 ? ` Closest matches: ${suggestions.join(", ")}.` : "") +
      ` Call search_icons to search the ${iconCount()} available icons by description.`
  );
}

/**
 * Valide le champ `image` d'un noeud `image`. L'existence du fichier dans la
 * mediatheque, elle, est verifiee par les outils, qui ont acces au stockage.
 */
function requireImageName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") {
    throw new DesignError(
      `An "image" node needs an "image" field naming a stored image, e.g. "img_3f9a1c2b7d4e5f60.png". ` +
        `Call add_image to import a picture file: it stores the file and places the node in one step.`
    );
  }
  return name;
}

/** Champs geometriques réellement modifiables pour un type donné. */
function geometryFieldsFor(type: NodeType): ReadonlyArray<keyof DesignNode> {
  return SIZE_DERIVED_KINDS.includes(type) ? GEOMETRY.filter((field) => !DERIVED.includes(field)) : GEOMETRY;
}

/**
 * Valide le lien d'un noeud `instance` vers son composant. L'existence du
 * groupe cible, elle, est verifiee par `validateHierarchy` : elle depend de la
 * planche entiere, pas du seul noeud.
 */
function requireComponentId(value: unknown): string {
  const componentId = typeof value === "string" ? value.trim() : "";
  if (componentId === "") {
    throw new DesignError(
      `An "instance" node needs a "componentId" field naming the GROUP it mirrors, e.g. { type: "instance", componentId: "g_card" }. ` +
        `Build the block once with group_nodes, then instantiate it — editing the group then updates every instance at once.`
    );
  }
  return componentId;
}

function readParentId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  throw new DesignError(`"parentId" must be the id of an existing group, or null for the root level.`);
}

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
    throw new DesignError(
      `Unknown node type "${String(input.type)}". Expected one of: ${Object.keys(NODE_DEFAULTS).join(", ")}.`
    );
  }

  const id = typeof input.id === "string" && input.id.trim() !== "" ? input.id.trim() : shortId("n");
  if (existingIds.has(id)) throw new DesignError(`Node id "${id}" already exists in this design.`);

  const draft: Record<string, unknown> = {
    id,
    type,
    name: typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : defaultNodeName(type, index),
    parentId: input.parentId === undefined ? null : readParentId(input.parentId),
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    ...NODE_DEFAULTS[type],
  };

  for (const field of geometryFieldsFor(type)) {
    if (input[field] !== undefined) draft[field] = requireFiniteNumber(input[field], field as string);
  }
  for (const field of ALLOWED[type]) {
    if (input[field] !== undefined) draft[field] = input[field];
  }

  if (type === "instance") draft.componentId = requireComponentId(draft.componentId);
  if (type === "image") draft.image = requireImageName(draft.image);
  if (type === "icon") {
    draft.icon = requireIconName(draft.icon);
    // Un calque nomme "Icône 7" ne dit rien au relecteur ; le nom de l'icone,
    // lui, porte deja le sens. C'est le nom par defaut le plus utile.
    if (!(typeof input.name === "string" && input.name.trim() !== "")) draft.name = String(draft.icon);
  }

  const size = clampNodeSize(type, Number(draft.width), Number(draft.height));
  draft.width = size.width;
  draft.height = size.height;

  // Sans hauteur demandée, la boîte d'un texte est celle de son texte : le bloc
  // de lignes, centré dans une boîte à sa taille, se pose alors exactement au
  // point donné — ce que l'appelant attend quand il n'a parlé que de x et y.
  // Après le clamp, donc : ce plancher garde une boîte dessinée sélectionnable,
  // il n'a pas à gonfler une boîte qui n'a jamais été dimensionnée à la souris.
  if (type === "text" && input.height === undefined) {
    draft.height = measuredTextHeight(draft as unknown as RenderNode);
  }

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
  if (patch.parentId !== undefined) next.parentId = readParentId(patch.parentId);
  for (const field of geometryFieldsFor(node.type)) {
    if (patch[field] !== undefined) next[field] = requireFiniteNumber(patch[field], field as string);
  }
  for (const field of ALLOWED[node.type]) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }

  // Une boîte qui épousait son texte continue de l'épouser : rallonger le texte
  // d'une ligne agrandit la boîte au lieu de la faire déborder. Une hauteur
  // choisie — ou redonnée dans ce patch — reste intacte.
  if (node.type === "text" && patch.height === undefined && hugsText(node as unknown as RenderNode)) {
    next.height = measuredTextHeight(next as unknown as RenderNode);
  }

  if (node.type === "icon" && patch.icon !== undefined) next.icon = requireIconName(patch.icon);
  if (node.type === "image" && patch.image !== undefined) next.image = requireImageName(patch.image);
  // Changer le lien echange l'instance de composant, comme un "swap instance".
  if (node.type === "instance" && patch.componentId !== undefined) next.componentId = requireComponentId(patch.componentId);

  const editable = ["name", "parentId", ...geometryFieldsFor(node.type), ...ALLOWED[node.type]];
  const unknownFields = Object.keys(patch).filter((key) => key !== "id" && !editable.includes(key as keyof DesignNode));
  if (unknownFields.length > 0) {
    const derived = unknownFields.filter(
      (key) => SIZE_DERIVED_KINDS.includes(node.type) && DERIVED.includes(key as keyof DesignNode)
    );
    const reason =
      derived.length > 0 ? ` The size of a ${node.type} is derived from its content and cannot be set.` : "";
    throw new DesignError(
      `Field(s) [${unknownFields.join(", ")}] cannot be set on a "${node.type}" node.${reason} ` +
        `Allowed: ${editable.join(", ")}.`
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

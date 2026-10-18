import { z } from "zod";
import { formatFeedbackRound, type FeedbackRound } from "../../shared/feedback.js";
import { CORE_ICONS, hasIcon } from "../../shared/icons/index.js";
import { suggestIcons } from "../../shared/icons/search.js";
import {
  NODE_DEFAULTS,
  NODE_GEOMETRY_FIELDS,
  NODE_STYLE_FIELDS,
  SIZE_DERIVED_KINDS,
  type NodeKind,
} from "../../shared/node-defaults.js";
import { NODE_FIELD_DOCS } from "../../shared/node-fields.js";
import { normalizeDesignGroup, type Design, type DesignNode } from "../../shared/schemas/design.schema.js";
import type { FeedbackFile } from "../../shared/schemas/feedback.schema.js";
import { mutatedDesign, newDesign, parseDesign, syncedDesign } from "./design-model.js";
import { parseFeedbackFile, setRemarksProcessed } from "./feedback-model.js";
import { normalizeHierarchy } from "./hierarchy.js";
import { DesignError, buildNode } from "./node-factory.js";

/**
 * Échanges de la version autonome avec un assistant conversationnel :
 *
 * - le prompt qui lui décrit le format d'une page ;
 * - la lecture stricte d'une page qu'il renvoie, refusée en bloc à la moindre
 *   erreur avec un message qu'on peut lui recoller tel quel ;
 * - le récap d'un retour, qui lui transmet les remarques et l'état courant des
 *   pages concernées ;
 * - l'export et la relecture du projet complet.
 */

export const PAGE_FORMAT = "mcp-design-page";
export const PROJECT_FORMAT = "mcp-design-project";
export const EXCHANGE_VERSION = 1;

/** Pages, remarques et captures (data URI PNG par nom de fichier) d'un projet autonome. */
export interface ProjectData {
  designs: Design[];
  feedback: FeedbackFile;
  captures: Record<string, string>;
}

/** Refus d'un fichier importé. `issues` liste chaque problème, `message` s'adresse à l'assistant. */
export class ExchangeError extends DesignError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `The JSON could not be imported:\n${issues.map((issue) => `- ${issue}`).join("\n")}\n` +
        `Fix these points and send the whole page again, as a single JSON document.`
    );
    this.issues = issues;
  }
}

/** Les types qu'un assistant peut écrire : pas d'image, la version autonome n'a pas de médiathèque. */
const EXCHANGE_KINDS: readonly NodeKind[] = (Object.keys(NODE_DEFAULTS) as NodeKind[]).filter((kind) => kind !== "image");

const COMMON_FIELDS = ["id", "type", "name", "parentId", ...NODE_GEOMETRY_FIELDS] as const;

function allowedFields(kind: NodeKind): string[] {
  return [...COMMON_FIELDS, ...NODE_STYLE_FIELDS[kind]];
}

const ProcessedSchema = z.object({ remark: z.string().min(1), note: z.string().optional() }).strict();

const PageFileSchema = z
  .object({
    format: z.literal(PAGE_FORMAT),
    version: z.literal(EXCHANGE_VERSION),
    page: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        group: z.string().nullable().optional(),
        width: z.number().positive(),
        height: z.number().positive(),
        background: z.string().optional(),
        nodes: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    processed: z.array(ProcessedSchema).optional(),
  })
  .strict();

const ProjectFileSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    version: z.literal(EXCHANGE_VERSION),
    exportedAt: z.string(),
    designs: z.array(z.unknown()),
    feedback: z.unknown(),
    captures: z.record(z.string(), z.string().startsWith("data:image/png;base64,")),
  })
  .strict();

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
}

/**
 * Le JSON à lire : le texte lui-même, ou l'unique bloc de code d'une réponse
 * collée en entier. Plusieurs blocs sont refusés : on ne choisit pas à la
 * place de l'utilisateur.
 */
function jsonOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const blocks = [...trimmed.matchAll(/```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)].map((match) => match[1]);
  if (blocks.length > 1) {
    throw new ExchangeError([`The text holds ${blocks.length} code blocks: paste a single page at a time.`]);
  }
  return blocks[0] ?? trimmed;
}

function parseJson(text: string): unknown {
  const json = jsonOf(text);
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new ExchangeError([`The text is not valid JSON: ${(err as Error).message}`]);
  }
}

// --- Page ------------------------------------------------------------------

/** Une page lue et validée, prête à remplacer ou rejoindre celles du projet. */
export interface PageImport {
  /** La page telle qu'elle sera enregistrée, synchronisée sur son nouveau contenu. */
  design: Design;
  /** Page existante que l'import remplace, ou null pour une nouvelle page. */
  replaces: Design | null;
  /** Remarques déclarées traitées, avec le retour qui les contient. */
  processed: { round: number; remarkId: string; note: string | null }[];
}

/** Le nom d'icône est vérifié ici : le message de `buildNode` renvoie aux outils MCP. */
function checkIconName(icon: unknown): void {
  if (typeof icon !== "string" || icon.trim() === "") {
    throw new DesignError(`An icon node needs an "icon" field naming a Lucide icon, e.g. "shopping-cart".`);
  }
  if (hasIcon(icon.trim())) return;
  const suggestions = suggestIcons(icon.trim());
  throw new DesignError(
    `Unknown icon "${icon}".` + (suggestions.length > 0 ? ` Closest matches: ${suggestions.join(", ")}.` : "")
  );
}

function checkNode(raw: Record<string, unknown>): void {
  const type = raw.type;
  if (type === "image") {
    throw new DesignError(`"image" nodes are not supported: draw a placeholder rect (with a label) where the picture goes.`);
  }
  if (typeof type !== "string" || !EXCHANGE_KINDS.includes(type as NodeKind)) {
    throw new DesignError(`Unknown node type ${JSON.stringify(type)}. Expected one of: ${EXCHANGE_KINDS.join(", ")}.`);
  }
  if (type === "icon") checkIconName(raw.icon);
  const allowed = allowedFields(type as NodeKind);
  const unknown = Object.keys(raw).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new DesignError(
      `Field(s) [${unknown.join(", ")}] do not apply to a "${type}" node. Allowed: ${allowed.join(", ")}.`
    );
  }
}

function buildNodes(rawNodes: Record<string, unknown>[], issues: string[]): DesignNode[] {
  const ids = new Set<string>();
  const nodes: DesignNode[] = [];
  rawNodes.forEach((raw, index) => {
    const label = typeof raw.id === "string" ? `nodes[${index}] "${raw.id}"` : `nodes[${index}]`;
    try {
      checkNode(raw);
      if (typeof raw.id !== "string" || raw.id.trim() === "") throw new DesignError(`"id" is required.`);
      const node = buildNode(raw, ids, index + 1);
      ids.add(node.id);
      nodes.push(node);
    } catch (err) {
      issues.push(`${label}: ${(err as Error).message}`);
    }
  });
  return nodes;
}

/**
 * Lit une page renvoyée par l'assistant. Rien n'est appliqué ici : le résultat
 * dit ce que l'import ferait, `applyPageImport` l'exécute.
 */
export function parsePageReply(text: string, project: Pick<ProjectData, "designs" | "feedback">): PageImport {
  const parsed = PageFileSchema.safeParse(parseJson(text));
  if (!parsed.success) throw new ExchangeError(zodIssues(parsed.error));
  const { page, processed = [] } = parsed.data;

  const issues: string[] = [];
  const nodes = buildNodes(page.nodes, issues);

  const marked = processed.flatMap((entry) => {
    const round = project.feedback.rounds.find((candidate) => candidate.remarks.some((remark) => remark.id === entry.remark));
    const remark = round?.remarks.find((candidate) => candidate.id === entry.remark);
    if (!round || !remark) {
      issues.push(`processed: remark "${entry.remark}" is not part of any feedback round.`);
      return [];
    }
    if (remark.designId !== page.id) {
      issues.push(`processed: remark "${entry.remark}" is about page "${remark.designId}", not "${page.id}".`);
      return [];
    }
    return [{ round: round.number, remarkId: remark.id, note: entry.note?.trim() || null }];
  });
  if (issues.length > 0) throw new ExchangeError(issues);

  const now = new Date().toISOString();
  const replaces = project.designs.find((design) => design.id === page.id) ?? null;
  const base =
    replaces ??
    newDesign(page.id, { name: page.name, width: page.width, height: page.height, background: page.background }, now);

  let design: Design;
  try {
    design = mutatedDesign(base, "agent", (draft) => {
      draft.name = page.name;
      draft.width = page.width;
      draft.height = page.height;
      if (page.background !== undefined) draft.background = page.background;
      if (page.group !== undefined) draft.group = normalizeDesignGroup(page.group);
      draft.nodes = nodes;
    });
  } catch (err) {
    throw new ExchangeError([(err as Error).message]);
  }
  return { design: syncedDesign(design, now), replaces, processed: marked };
}

/** Enregistre une page lue par `parsePageReply` et note les remarques traitées. */
export function applyPageImport(project: ProjectData, plan: PageImport): void {
  if (plan.replaces) {
    project.designs = project.designs.map((design) => (design.id === plan.design.id ? plan.design : design));
  } else {
    project.designs.push(plan.design);
  }
  for (const entry of plan.processed) {
    setRemarksProcessed(project.feedback, {
      round: entry.round,
      remarkIds: [entry.remarkId],
      processed: true,
      by: "agent",
      note: entry.note,
    });
  }
}

interface PageFile {
  format: string;
  version: number;
  page: { id: string; name: string; group: string | null; width: number; height: number; background: string; nodes: object[] };
  processed: { remark: string; note?: string }[];
}

/** La page au format d'échange. La taille des groupes et des instances, dérivée, n'y figure pas. */
export function pageFileOf(design: Design): PageFile {
  return {
    format: PAGE_FORMAT,
    version: EXCHANGE_VERSION,
    page: {
      id: design.id,
      name: design.name,
      group: design.group,
      width: design.width,
      height: design.height,
      background: design.background,
      nodes: design.nodes.map((node) => {
        if (!SIZE_DERIVED_KINDS.includes(node.type)) return node;
        const { width: _width, height: _height, ...rest } = node;
        return rest;
      }),
    },
    processed: [],
  };
}

/** JSON d'une page, un élément par ligne : lisible et bien plus court qu'une indentation complète. */
export function pageJson(file: PageFile): string {
  const nodes = file.page.nodes.map((node) => `      ${JSON.stringify(node)}`).join(",\n");
  const placeholder = "@@nodes@@";
  return JSON.stringify({ ...file, page: { ...file.page, nodes: placeholder } }, null, 2).replace(
    JSON.stringify(placeholder),
    file.page.nodes.length > 0 ? `[\n${nodes}\n    ]` : "[]"
  );
}

// --- Projet ----------------------------------------------------------------

export function projectFileOf(project: ProjectData, exportedAt: string): object {
  return {
    format: PROJECT_FORMAT,
    version: EXCHANGE_VERSION,
    exportedAt,
    designs: project.designs,
    feedback: project.feedback,
    captures: project.captures,
  };
}

/** Relit un export complet ; refusé en bloc à la moindre incohérence. */
export function parseProjectFile(text: string): ProjectData {
  const parsed = ProjectFileSchema.safeParse(parseJson(text));
  if (!parsed.success) throw new ExchangeError(zodIssues(parsed.error));

  const issues: string[] = [];
  const designs: Design[] = [];
  parsed.data.designs.forEach((raw, index) => {
    try {
      const { design } = parseDesign(raw, `designs[${index}]`);
      if (designs.some((other) => other.id === design.id)) throw new DesignError(`duplicate page id "${design.id}".`);
      if (design.nodes.some((node) => node.type === "image")) throw new DesignError(`page "${design.id}" contains image nodes.`);
      designs.push({ ...design, nodes: normalizeHierarchy(design.nodes) });
    } catch (err) {
      issues.push(`designs[${index}]: ${(err as Error).message}`);
    }
  });

  let feedback: FeedbackFile | null = null;
  try {
    feedback = parseFeedbackFile(parsed.data.feedback, "feedback");
  } catch (err) {
    issues.push((err as Error).message);
  }

  const captures = parsed.data.captures;
  const referenced = feedback
    ? [...feedback.remarks.map((remark) => remark.capture), ...feedback.rounds.flatMap((round) => round.remarks.map((remark) => remark.capture))]
    : [];
  for (const name of new Set(referenced)) {
    if (name !== null && captures[name] === undefined) issues.push(`captures: "${name}" is referenced by a remark but missing.`);
  }

  if (issues.length > 0 || feedback === null) throw new ExchangeError(issues);
  return { designs, feedback, captures };
}

// --- Prompt ----------------------------------------------------------------

/** Champs décrits à l'assistant, avec les nuances propres à cet échange. */
const PROMPT_FIELD_DOCS: Record<string, string> = {
  ...NODE_FIELD_DOCS,
  id: "Unique id within the page, short and readable (\"hero-title\", \"nav\"). Required.",
  icon:
    "Name of a Lucide icon, e.g. \"shopping-cart\", \"circle-check\", \"user\". Required on an icon node. NEVER approximate " +
    "an icon out of rects, ellipses and lines. The box is square: the drawing is scaled to fit it.",
  componentId:
    "Instance nodes only: id of the GROUP this instance mirrors. The group's content is resolved at render time, so " +
    "editing the group updates every instance. When the same block appears several times (cards, list rows, menu items), " +
    "build it once as a group and add instances of it, placed with x and y.",
};

function fieldsPerType(): string {
  return EXCHANGE_KINDS.map((kind) => {
    const style = NODE_STYLE_FIELDS[kind];
    const derived = SIZE_DERIVED_KINDS.includes(kind) ? " — width/height are derived from the content: omit them" : "";
    return `- ${kind}: ${style.length > 0 ? style.join(", ") : "(no style field)"}${derived}`;
  }).join("\n");
}

function fieldReference(): string {
  return Object.entries(PROMPT_FIELD_DOCS)
    .filter(([field]) => field !== "image" && field !== "fit")
    .map(([field, doc]) => `- ${field}: ${doc}`)
    .join("\n");
}

function defaultsReference(): string {
  return EXCHANGE_KINDS.filter((kind) => !SIZE_DERIVED_KINDS.includes(kind))
    .map((kind) => `- ${kind}: ${JSON.stringify(NODE_DEFAULTS[kind])}`)
    .join("\n");
}

const EXAMPLE_PAGE: PageFile = {
  format: PAGE_FORMAT,
  version: EXCHANGE_VERSION,
  page: {
    id: "home",
    name: "Home",
    group: null,
    width: 1440,
    height: 900,
    background: "#ffffff",
    nodes: [
      { id: "header", type: "group", name: "Header", parentId: null, x: 0, y: 0 },
      { id: "header-bg", type: "rect", name: "Background", parentId: "header", x: 0, y: 0, width: 1440, height: 72, fill: "#0f172a", strokeWidth: 0, radius: 0 },
      { id: "logo", type: "text", name: "Logo", parentId: "header", x: 40, y: 0, width: 200, height: 72, text: "Acme", color: "#ffffff", fontSize: 22, fontWeight: 700 },
      { id: "cart", type: "icon", name: "Cart", parentId: "header", x: 1376, y: 24, width: 24, height: 24, icon: "shopping-cart", stroke: "#ffffff" },
      { id: "card", type: "group", name: "Card", parentId: null, x: 40, y: 120 },
      { id: "card-bg", type: "rect", name: "Card background", parentId: "card", x: 0, y: 0, width: 320, height: 200, fill: "#f1f5f9", strokeWidth: 0, radius: 12 },
      { id: "card-title", type: "text", name: "Card title", parentId: "card", x: 24, y: 24, width: 272, text: "Fast delivery\nin 24 hours", fontSize: 20, fontWeight: 600 },
      { id: "card-2", type: "instance", name: "Card 2", parentId: null, x: 400, y: 120, componentId: "card" },
    ],
  },
  processed: [],
};

/** Ce que l'utilisateur colle en tête de conversation, suivi de sa demande. */
export function creationPrompt(): string {
  return `You design user-interface mockups for mcp-design, a minimal vector canvas. You never produce images: you describe each page as a JSON document that I import into the editor. There I adjust it by hand, pin review remarks on it, and send you a review recap to apply.

## Reply format

Send ONE page per reply, as a single JSON document in a \`\`\`json code block (nothing else inside the block):

{ "format": "${PAGE_FORMAT}", "version": ${EXCHANGE_VERSION}, "page": { "id": "...", "name": "...", "group": null, "width": 1440, "height": 900, "background": "#ffffff", "nodes": [ ... ] }, "processed": [] }

- page.id: stable kebab-case identifier ("home", "checkout-step-2"). Sending a page with an existing id REPLACES that page; a new id creates a page.
- page.name: name shown in the page list.
- page.group: optional folder path such as "Mobile/Onboarding", or null.
- page.width / page.height: artboard size in pixels (1440x900 desktop, 375x812 mobile).
- page.background: CSS colour of the artboard.
- page.nodes: every element of the page (see below).
- processed: when you apply a review recap, one entry per remark of THIS page you addressed: { "remark": "rm_xxxxxxxx", "note": "what you changed" }. Leave it empty otherwise.

When several pages are needed, first list them (id and name) in plain text and send the first one; I will say "next" to get each following page.

## Nodes

All lengths are pixels, angles degrees, opacity 0 to 1. The origin is the top-left corner, y goes down. Coordinates are relative to the parent group (to the artboard at the root).

Every node has: id, type, name, parentId, x, y, width, height, rotation, opacity. Each type also accepts:
${fieldsPerType()}

Any other field is rejected. There are no image nodes: draw a light rect with a short label where a picture would go.

Rules:
- nodes is a flat list; nesting is expressed with parentId, which must name a group. List order is the stacking order among siblings: later nodes are drawn on top.
- Structure the page: a handful of top-level section groups, blocks inside them, elements inside blocks.
- Text never wraps: break lines with explicit \\n. Omit height on free text; to centre a label in a button, give the text the button's y and height.
- Use icon nodes for every pictogram. Common names: ${CORE_ICONS.join(", ")}. Any other Lucide icon name works too; an unknown name is rejected with close suggestions.
- Fields you omit take these defaults:
${defaultsReference()}
  rotation 0, opacity 1, parentId null.

## Field reference

${fieldReference()}

## Example

\`\`\`json
${pageJson(EXAMPLE_PAGE)}
\`\`\`

## My request

`;
}

// --- Récap -----------------------------------------------------------------

/** Ce qui, pour l'assistant, exprime les coordonnées des remarques. */
export const COORDINATES_SOURCE = "the page JSON";

/** Fichiers joints au récap : une vue de chaque page, et une image par capture. */
export interface RecapFiles {
  /** Vue d'ensemble de chaque page concernée, par id de page. */
  pages: Map<string, string>;
  /** Fichier de chaque capture, dans l'ordre où le texte du retour les numérote. */
  captures: string[];
}

/** Texte du récap d'un retour, à transmettre à l'assistant avec les fichiers joints. */
export function recapText(round: FeedbackRound, designs: Design[], files: RecapFiles): string {
  const pageIds = [...new Set(round.remarks.map((remark) => remark.designId))];
  const pages = pageIds.map((id) => designs.find((design) => design.id === id) ?? null);
  const first = pages.find((page) => page !== null);

  const attachments = [
    ...pageIds.flatMap((id) => {
      const file = files.pages.get(id);
      const name = round.remarks.find((remark) => remark.designId === id)?.designName ?? id;
      return file ? [`- ${file}: the whole page "${name}" as it renders now, remarks outlined and numbered.`] : [];
    }),
    ...files.captures.map((file, index) => `- ${file}: image ${index + 1}, the capture cited by the remark that names it.`),
  ];

  const current = pages
    .map((page, index) =>
      page === null
        ? `### Page ${pageIds[index]}\n\nThis page has been deleted since the review: skip its remarks.`
        : `### Page "${page.name}" (${page.id})\n\n\`\`\`json\n${pageJson(pageFileOf(page))}\n\`\`\``
    )
    .join("\n\n");

  return `# Review recap — "${round.title}" (round ${round.number})

Apply every remark below to the pages, then send back the updated pages, ONE PAGE PER REPLY, each as a single JSON document in the "${PAGE_FORMAT}" format. Start with page "${first?.id ?? pageIds[0]}"; I will say "next" for the following one. Keep the ids of the elements you keep, and list in "processed" the remarks of that page you addressed, with a short note.

## Attached images

${attachments.length > 0 ? attachments.join("\n") : "None."}

## Remarks

${formatFeedbackRound(round, COORDINATES_SOURCE)}

## Current pages

${current}

## Format reminder

${creationPrompt().split("## My request")[0].trim()}
`;
}

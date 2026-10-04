/**
 * Remarques de l'utilisateur sur un design, et retours transmis à l'agent.
 *
 * Une remarque vise la page entière, un élément, ou une zone rectangulaire de la
 * planche. Tant qu'elle est un brouillon, l'utilisateur la modifie librement ;
 * « Terminer les retours » fige les remarques cochées dans un retour numéroté,
 * nommé, que l'agent lit avec `get_feedback`. Une remarque transmise ne se
 * modifie plus : le retour qui la contient reste exactement ce que l'agent a
 * reçu. Seul son traitement évolue, déclaré par l'agent avec
 * `mark_feedback_processed` ou par l'utilisateur dans la page des retours.
 *
 * Comme `render.ts` et `tree.ts`, ce module ne dépend d'aucune librairie : il
 * est importé par le serveur MCP comme par la GUI, qui s'en sert pour afficher
 * l'aperçu exact du retour avant de l'enregistrer.
 */

import { expandInstances } from "./instances.js";
import type { RenderNode } from "./render.js";
import { ancestorsOf, boundsOf, boxesIntersect, childrenByParent, computeLayout, type Box } from "./tree.js";

export type RemarkStatus = "draft" | "sent";

/** Élément de la planche cité par une remarque. */
export interface RemarkElement {
  id: string;
  name: string;
  type: RenderNode["type"];
}

export type RemarkTarget =
  | { kind: "page" }
  | {
      kind: "node";
      element: RemarkElement;
      /** Noms des groupes englobants puis de l'élément, de la racine vers lui. */
      path: string[];
      /** Boîte de l'élément au moment de la remarque, en coordonnées document. */
      box: Box;
    }
  | {
      kind: "area";
      /** Zone tracée, en coordonnées document. */
      box: Box;
      /** Éléments de la zone que l'utilisateur a choisi de citer. */
      elements: RemarkElement[];
    };

export type RemarkKind = RemarkTarget["kind"];

export interface Remark {
  id: string;
  designId: string;
  /** Numéro de la pastille sur la planche ; null pour la remarque de page. */
  number: number | null;
  target: RemarkTarget;
  text: string;
  /** Nom du fichier PNG de la capture, ou null sans capture. */
  capture: string | null;
  status: RemarkStatus;
  /** Retour qui contient la remarque, une fois transmise. */
  round: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Traitement d'une remarque transmise : qui l'a déclarée traitée, quand, et ce qui a été fait. */
export interface RemarkProcessing {
  at: string;
  by: "agent" | "user";
  note: string | null;
}

/** Remarque telle qu'elle figure dans un retour transmis. */
export interface RoundRemark {
  id: string;
  designId: string;
  designName: string;
  number: number | null;
  target: RemarkTarget;
  text: string;
  capture: string | null;
  /** Null tant que la remarque n'est pas traitée. */
  processed: RemarkProcessing | null;
}

export interface FeedbackRound {
  number: number;
  /** Nom donné par l'utilisateur en terminant sa revue. */
  title: string;
  submittedAt: string;
  remarks: RoundRemark[];
}

export type RoundStatus = "pending" | "in_progress" | "done";

/** Avancement d'un retour : à traiter, en cours, ou entièrement traité. */
export function roundProgress(round: Pick<FeedbackRound, "remarks">): { done: number; total: number; status: RoundStatus } {
  const total = round.remarks.length;
  const done = round.remarks.filter((remark) => remark.processed !== null).length;
  return { done, total, status: done === 0 ? "pending" : done === total ? "done" : "in_progress" };
}

/** Nom proposé pour un retour avant que l'utilisateur ne le change. */
export function defaultRoundTitle(number: number): string {
  return `Retour n°${number}`;
}

/** Élément touché par une zone. `partial` : il en déborde. */
export interface AreaHit extends RemarkElement {
  partial: boolean;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Éléments qu'une zone recouvre, au niveau le plus utile pour les nommer.
 *
 * Un élément entièrement compris dans la zone est cité tel quel, sans détailler
 * son contenu. Un groupe qui en déborde est ouvert, pour citer ceux de ses
 * éléments que la zone touche. Un élément sans contenu qui en déborde (forme,
 * texte, instance) est cité comme partiel. Les instances ne sont jamais
 * ouvertes : leur contenu n'existe pas en stockage.
 */
export function elementsInArea(nodes: RenderNode[], area: Box): AreaHit[] {
  const layout = computeLayout(expandInstances(nodes));
  const children = childrenByParent(nodes);
  const hits: AreaHit[] = [];

  const visit = (node: RenderNode) => {
    const box = boundsOf(layout, node.id);
    if (box.width <= 0 && box.height <= 0) return;
    if (!boxesIntersect(box, area)) return;

    const element = { id: node.id, name: node.name, type: node.type };
    if (contains(area, box)) {
      hits.push({ ...element, partial: false });
      return;
    }
    const content = node.type === "group" ? (children.get(node.id) ?? []) : [];
    if (content.length > 0) content.forEach(visit);
    else hits.push({ ...element, partial: true });
  };

  (children.get(null) ?? []).forEach(visit);
  return hits;
}

/** Noms des groupes englobants puis de l'élément, de la racine vers lui. */
export function nodePath(nodes: RenderNode[], id: string): string[] {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return [];
  return [...ancestorsOf(nodes, id).reverse().map((ancestor) => ancestor.name), node.name];
}

/** Cible d'une remarque sur un élément, calculée sur l'état courant du design. */
export function nodeTarget(nodes: RenderNode[], id: string): Extract<RemarkTarget, { kind: "node" }> {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Node "${id}" not found in the design.`);
  const box = boundsOf(computeLayout(expandInstances(nodes)), id);
  return {
    kind: "node",
    element: { id: node.id, name: node.name, type: node.type },
    path: nodePath(nodes, id),
    box: roundBox(box),
  };
}

export function roundBox(box: Box): Box {
  const round = (value: number) => Math.round(value * 100) / 100;
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

/**
 * Ordre de lecture d'un lot de remarques : les pages dans l'ordre où elles
 * apparaissent, puis dans chaque page la remarque de page d'abord et les autres
 * par numéro de pastille. Le serveur fige un retour dans cet ordre, la GUI
 * affiche son aperçu dans le même.
 */
export function orderRemarks<T extends Pick<Remark, "designId" | "number">>(remarks: T[]): T[] {
  const pages = [...new Set(remarks.map((remark) => remark.designId))];
  return [...remarks].sort(
    (a, b) => pages.indexOf(a.designId) - pages.indexOf(b.designId) || (a.number ?? 0) - (b.number ?? 0)
  );
}

export const PATH_SEPARATOR = " › ";

function formatBox(box: Box): string {
  const round = (value: number) => Math.round(value);
  return `x ${round(box.x)}, y ${round(box.y)}, ${round(box.width)}×${round(box.height)}`;
}

function formatElement(element: RemarkElement): string {
  return `${element.id} "${element.name}" (${element.type})`;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * Texte d'un retour, tel que l'agent le reçoit.
 *
 * La GUI l'affiche en aperçu avant l'enregistrement : c'est la même fonction,
 * donc le même texte. Chaque remarque porte son identifiant, que l'agent passe
 * à `mark_feedback_processed`. Les captures sont numérotées dans l'ordre des
 * remarques ; `get_feedback` joint les images dans cet ordre.
 */
export function formatFeedbackRound(round: Pick<FeedbackRound, "number" | "title" | "submittedAt" | "remarks">): string {
  const pages = new Map<string, RoundRemark[]>();
  for (const remark of round.remarks) {
    const list = pages.get(remark.designId);
    if (list) list.push(remark);
    else pages.set(remark.designId, [remark]);
  }

  const progress = roundProgress(round);
  const lines = [
    `Feedback round ${round.number} "${round.title}" — submitted ${round.submittedAt} — ` +
      `${round.remarks.length} remark(s) on ${pages.size} page(s), ${progress.done} processed.`,
    "Coordinates are design pixels in the artboard's space, as in get_design.",
  ];

  let image = 0;
  for (const [designId, remarks] of pages) {
    lines.push("", `Page "${remarks[0].designName}" (${designId})`);
    for (const remark of remarks) {
      const capture = remark.capture ? ` — capture: image ${++image}` : "";
      const target = remark.target;
      let head: string;
      if (target.kind === "page") {
        head = `- ${remark.id} [whole page]`;
      } else if (target.kind === "node") {
        head =
          `- ${remark.id} [#${remark.number} · element] ${formatElement(target.element)} — ` +
          `path: ${target.path.join(PATH_SEPARATOR)} — box ${formatBox(target.box)}${capture}`;
      } else {
        const elements =
          target.elements.length > 0 ? target.elements.map(formatElement).join(", ") : "no element selected";
        head = `- ${remark.id} [#${remark.number} · area] box ${formatBox(target.box)} — elements: ${elements}${capture}`;
      }
      lines.push(head, indent(remark.text, "    "));
      if (remark.processed) {
        const note = remark.processed.note ? `: ${remark.processed.note}` : "";
        lines.push(`    ✓ processed by ${remark.processed.by} at ${remark.processed.at}${note}`);
      }
    }
  }
  return lines.join("\n");
}

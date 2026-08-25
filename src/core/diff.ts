import type { DesignNode } from "../../shared/schemas/design.schema.js";

export interface NodeFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface UpdatedNode {
  id: string;
  name: string;
  type: string;
  changes: NodeFieldChange[];
}

export interface DesignDiff {
  added: DesignNode[];
  updated: UpdatedNode[];
  removed: DesignNode[];
  reordered: boolean;
}

/** Les nombres issus de la GUI portent du bruit sous-pixel qui n'est pas un changement de design. */
function equalValues(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.01;
  return a === b;
}

export function diffNodes(before: DesignNode[], after: DesignNode[]): DesignDiff {
  const beforeById = new Map(before.map((n) => [n.id, n]));
  const afterById = new Map(after.map((n) => [n.id, n]));

  const added = after.filter((n) => !beforeById.has(n.id));
  const removed = before.filter((n) => !afterById.has(n.id));

  const updated: UpdatedNode[] = [];
  for (const node of after) {
    const previous = beforeById.get(node.id);
    if (!previous) continue;

    const fields = new Set([...Object.keys(previous), ...Object.keys(node)]);
    const changes: NodeFieldChange[] = [];
    for (const field of fields) {
      if (field === "id" || field === "type") continue;
      const a = (previous as Record<string, unknown>)[field];
      const b = (node as Record<string, unknown>)[field];
      if (!equalValues(a, b)) changes.push({ field, before: a, after: b });
    }
    if (changes.length > 0) {
      updated.push({ id: node.id, name: node.name, type: node.type, changes });
    }
  }

  // L'ordre d'empilement change le rendu sans changer un seul champ : on le signale à part.
  const commonBefore = before.filter((n) => afterById.has(n.id)).map((n) => n.id);
  const commonAfter = after.filter((n) => beforeById.has(n.id)).map((n) => n.id);
  const reordered = commonBefore.join("|") !== commonAfter.join("|");

  return { added, updated, removed, reordered };
}

export function countChanges(before: DesignNode[], after: DesignNode[]): number {
  const diff = diffNodes(before, after);
  return diff.added.length + diff.updated.length + diff.removed.length;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return JSON.stringify(value);
}

/** Résumé lisible du diff, destiné à être renvoyé tel quel à l'agent. */
export function formatDiff(diff: DesignDiff): string {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push(`## Added (${diff.added.length})`);
    for (const node of diff.added) {
      lines.push(
        `- ${node.id} — "${node.name}" (${node.type}) at ${Math.round(node.x)},${Math.round(node.y)} ` +
          `size ${Math.round(node.width)}x${Math.round(node.height)}`
      );
    }
    lines.push("");
  }

  if (diff.updated.length > 0) {
    lines.push(`## Updated (${diff.updated.length})`);
    for (const node of diff.updated) {
      lines.push(`- ${node.id} — "${node.name}" (${node.type})`);
      for (const change of node.changes) {
        lines.push(`    ${change.field}: ${formatValue(change.before)} -> ${formatValue(change.after)}`);
      }
    }
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push(`## Removed (${diff.removed.length})`);
    for (const node of diff.removed) {
      lines.push(`- ${node.id} — "${node.name}" (${node.type})`);
    }
    lines.push("");
  }

  if (diff.reordered) {
    lines.push("## Reordered");
    lines.push("- The stacking order of existing nodes changed.");
    lines.push("");
  }

  if (lines.length === 0) return "No changes since the last mark_synced.";
  return lines.join("\n").trimEnd();
}

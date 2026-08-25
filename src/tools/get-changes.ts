import type { DesignStore } from "../core/design-store.js";
import { diffNodes, formatDiff } from "../core/diff.js";
import { requireString, textResult, type ToolResult } from "./types.js";

/**
 * Cœur de la boucle agent <-> utilisateur : ce que la GUI (ou l'agent) a changé
 * depuis le dernier `mark_synced`.
 *
 * Lire les changements ne les acquitte jamais : seul `mark_synced` déplace la
 * référence, pour qu'un appel de lecture ne puisse pas faire disparaître un
 * diff que l'agent n'a pas encore intégré.
 */
export function getChanges(store: DesignStore, args: Record<string, unknown> | undefined): ToolResult {
  const id = requireString(args, "design_id");
  const design = store.get(id);
  const diff = diffNodes(design.baseline.nodes, design.nodes);
  const total = diff.added.length + diff.updated.length + diff.removed.length;

  if (total === 0 && !diff.reordered) {
    return textResult(
      `No change in "${design.name}" since the baseline taken at ${design.baseline.at} (revision ${design.baseline.revision}).`
    );
  }

  const header = [
    `Changes in "${design.name}" (${id}) since revision ${design.baseline.revision} (${design.baseline.at}).`,
    `Current revision ${design.revision}, last edited by ${design.lastEditor}.`,
    "",
  ].join("\n");

  const footer =
    "\n\nOnce these changes are integrated into the codebase, call mark_synced to move the baseline forward. " +
    "Use export_design (format html or jsx) to get ready-to-adapt markup.";

  return textResult(header + formatDiff(diff) + footer);
}

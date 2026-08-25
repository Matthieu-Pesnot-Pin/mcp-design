import type { DesignStore } from "../core/design-store.js";
import { toSummary } from "../core/export.js";
import { countChanges } from "../core/diff.js";
import { requireString, textResult, type ToolResult } from "./types.js";

/**
 * Deux niveaux de détail : `summary` (défaut) pour se repérer sans saturer le
 * contexte, `json` quand l'agent a besoin des valeurs exactes pour patcher.
 */
export function getDesign(store: DesignStore, args: Record<string, unknown> | undefined): ToolResult {
  const id = requireString(args, "design_id");
  const format = args?.format === "json" ? "json" : "summary";
  const design = store.get(id);

  const pending = countChanges(design.baseline.nodes, design.nodes);
  const notice =
    pending > 0
      ? `\n\nNOTE: ${pending} node(s) differ from the last synced baseline. Call get_changes to see exactly what the user edited.`
      : "";

  if (format === "json") {
    return textResult(
      JSON.stringify(
        {
          id: design.id,
          name: design.name,
          width: design.width,
          height: design.height,
          background: design.background,
          revision: design.revision,
          lastEditor: design.lastEditor,
          nodes: design.nodes,
        },
        null,
        2
      ) + notice
    );
  }

  return textResult(toSummary(design) + notice);
}

import type { DesignStore } from "../core/design-store.js";
import { textResult, type ToolResult } from "./types.js";

export function listDesigns(store: DesignStore): ToolResult {
  const designs = store.list();
  if (designs.length === 0) {
    return textResult("No design yet. Use create_design to start one.");
  }

  const lines = designs.map((d) => {
    const pending = d.pendingChanges > 0 ? ` — ${d.pendingChanges} unsynced change(s)` : "";
    return (
      `- ${d.id} — "${d.name}" ${d.width}x${d.height}, ${d.nodeCount} node(s), ` +
      `rev ${d.revision} last edited by ${d.lastEditor} at ${d.updatedAt}${pending}`
    );
  });

  return textResult([`${designs.length} design(s):`, ...lines].join("\n"));
}

import type { DesignStore } from "../core/design-store.js";
import { textResult, type ToolResult } from "./types.js";

export function listDesigns(store: DesignStore): ToolResult {
  const designs = store.list();
  if (designs.length === 0) {
    return textResult("No design yet. Use create_design to start one.");
  }

  const describe = (d: (typeof designs)[number]) => {
    const pending = d.pendingChanges > 0 ? ` — ${d.pendingChanges} unsynced change(s)` : "";
    return (
      `- ${d.id} — "${d.name}" ${d.width}x${d.height}, ${d.nodeCount} node(s), ` +
      `rev ${d.revision} last edited by ${d.lastEditor} at ${d.updatedAt}${pending}`
    );
  };

  // Presentées par groupe de pages : c'est la vue qu'a l'utilisateur dans la
  // barre latérale, et celle qui montre à l'agent où ranger une nouvelle page.
  const byGroup = new Map<string, typeof designs>();
  for (const design of designs) {
    const key = design.group ?? "";
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(design);
    else byGroup.set(key, [design]);
  }

  const lines: string[] = [];
  for (const key of [...byGroup.keys()].sort()) {
    lines.push(key === "" ? "[no group]" : `[${key}]`);
    for (const design of byGroup.get(key)!) lines.push(`  ${describe(design)}`);
  }

  return textResult([`${designs.length} design(s):`, ...lines].join("\n"));
}

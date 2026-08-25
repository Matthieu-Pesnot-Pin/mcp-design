import type { DesignStore } from "../core/design-store.js";
import { requireString, textResult, type ToolResult } from "./types.js";

export function deleteDesign(store: DesignStore, args: Record<string, unknown> | undefined): ToolResult {
  const id = requireString(args, "design_id");
  const design = store.get(id);
  store.delete(id);
  return textResult(`Design "${design.name}" (${id}) deleted, along with its ${design.nodes.length} node(s).`);
}

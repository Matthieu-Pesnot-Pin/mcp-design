import type { DesignStore } from "../core/design-store.js";
import type { Design } from "../../shared/schemas/design.schema.js";
import { textResult, requireString, type ToolResult } from "./types.js";

export interface CreateDesignResult extends ToolResult {
  design?: Design;
}

export function createDesign(store: DesignStore, args: Record<string, unknown> | undefined): CreateDesignResult {
  const name = requireString(args, "name");
  const design = store.create({
    name,
    width: args?.width === undefined ? undefined : Number(args.width),
    height: args?.height === undefined ? undefined : Number(args.height),
    background: typeof args?.background === "string" ? args.background : undefined,
    group: args?.group === undefined ? null : (args.group as string | null),
  });

  return {
    ...textResult(
      `Design "${design.name}" created with id "${design.id}" (${design.width}x${design.height}, background ${design.background})` +
        `${design.group === null ? "" : ` in page group "${design.group}"`}.\n` +
        `Add content with add_nodes, then open the GUI to let the user refine it.`
    ),
    design,
  };
}

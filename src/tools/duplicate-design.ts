import type { DesignStore } from "../core/design-store.js";
import { requireString, textResult } from "./types.js";
import type { CreateDesignResult } from "./create-design.js";

/** Copie complète d'un design : planche, éléments, groupes et instances. */
export function duplicateDesign(store: DesignStore, args: Record<string, unknown> | undefined): CreateDesignResult {
  const id = requireString(args, "design_id");
  if (args?.name !== undefined && (typeof args.name !== "string" || args.name.trim() === "")) {
    throw new Error(`"name" must be a non-empty string.`);
  }
  const design = store.duplicate(id, {
    name: args?.name as string | undefined,
    group: args?.group === undefined ? undefined : (args.group as string | null),
  });

  return {
    ...textResult(
      `Design "${id}" copied to "${design.name}" with id "${design.id}" (${design.width}x${design.height}, ` +
        `${design.nodes.length} node(s))${design.group === null ? "" : ` in page group "${design.group}"`}. ` +
        `Node ids are the same as in the original, so ids read from it apply to the copy.`
    ),
    design,
  };
}

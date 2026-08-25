import type { DesignStore } from "../core/design-store.js";
import { countChanges } from "../core/diff.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/**
 * Seul point d'acquittement des changements. Appelé une fois le design réellement
 * reporté dans le code, jamais "au cas où".
 */
export function markSynced(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const before = store.get(id);
  const pending = countChanges(before.baseline.nodes, before.nodes);
  const design = store.markSynced(id);

  return {
    ...textResult(
      pending === 0
        ? `Baseline of "${design.name}" was already up to date (revision ${design.revision}).`
        : `Baseline of "${design.name}" moved to revision ${design.revision}. ` +
            `${pending} change(s) acknowledged — get_changes now reports nothing until the next edit.`
    ),
    design,
  };
}

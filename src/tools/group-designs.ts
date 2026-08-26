import type { DesignStore } from "../core/design-store.js";
import { normalizeDesignGroup } from "../../shared/schemas/design.schema.js";
import { textResult, type ToolResult } from "./types.js";

/**
 * Range plusieurs pages dans un meme groupe, ou les en sort (group = null).
 *
 * Un outil dedie plutot qu'un appel a update_design par page : reorganiser la
 * barre laterale se fait presque toujours par lots, et chaque appel est une
 * ecriture disque verrouillee.
 */
export function groupDesigns(store: DesignStore, args: Record<string, unknown> | undefined): ToolResult {
  const ids = args?.design_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`"design_ids" is required and must be a non-empty array of design ids.`);
  }
  if (!("group" in (args ?? {}))) {
    throw new Error(`"group" is required. Pass a path like "Marketing/Landing", or null to move the pages back to the root.`);
  }

  const group = normalizeDesignGroup(args!.group);

  // Toutes les pages sont verifiees avant la premiere ecriture : un id fautif
  // ne doit pas laisser le classement a moitie applique.
  const targets = ids.map((raw) => {
    const id = String(raw);
    if (!store.has(id)) throw new Error(`Design "${id}" not found. Use list_designs to see the available pages.`);
    return id;
  });

  for (const id of targets) {
    store.mutate(id, "agent", (draft) => {
      draft.group = group;
    });
  }

  return textResult(
    `Moved ${targets.length} page(s) ${group === null ? "back to the root" : `into page group "${group}"`}: ${targets.join(", ")}.`
  );
}

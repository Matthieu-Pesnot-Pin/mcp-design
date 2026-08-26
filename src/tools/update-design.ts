import type { DesignStore } from "../core/design-store.js";
import { normalizeDesignGroup } from "../../shared/schemas/design.schema.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/** Propriétés de la planche elle-même (nom, dimensions, fond) — pas de ses noeuds. */
export function updateDesign(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const id = requireString(args, "design_id");
  const fields = ["name", "group", "width", "height", "background"] as const;
  if (fields.every((field) => args?.[field] === undefined)) {
    throw new Error(`Nothing to update. Provide at least one of: ${fields.join(", ")}.`);
  }
  const changed: string[] = [];

  const design = store.mutate(id, "agent", (draft) => {
    if (args?.name !== undefined) {
      const name = String(args.name).trim();
      if (name === "") throw new Error(`"name" must be a non-empty string.`);
      draft.name = name;
      changed.push(`name -> "${name}"`);
    }
    for (const field of ["width", "height"] as const) {
      if (args?.[field] === undefined) continue;
      const value = Number(args[field]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`"${field}" must be a positive number.`);
      draft[field] = value;
      changed.push(`${field} -> ${value}`);
    }
    if (args?.group !== undefined) {
      // null (ou "") sort la page de tout groupe : c'est la seule facon de la
      // remettre a la racine sans passer par un autre outil.
      draft.group = normalizeDesignGroup(args.group);
      changed.push(`group -> ${draft.group === null ? "(racine)" : `"${draft.group}"`}`);
    }
    if (args?.background !== undefined) {
      draft.background = String(args.background);
      changed.push(`background -> ${draft.background}`);
    }
  });

  return { ...textResult(`Design "${design.id}" updated: ${changed.join(", ")}.`), design };
}

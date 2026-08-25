import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { updateNodes } from "../src/tools/update-nodes.js";
import { getChanges } from "../src/tools/get-changes.js";
import { exportDesign } from "../src/core/export.js";
import { migrateDesign } from "../src/core/migrate.js";
import { defaultLineHeight, measuredTextHeight, textMetrics, type RenderNode } from "../shared/render.js";

const TEXT: Partial<RenderNode> = { type: "text", x: 0, y: 0, width: 400, height: 200 };

test("lineHeight is read as pixels, not as a multiple of fontSize", () => {
  const node = { ...TEXT, fontSize: 64, lineHeight: 76, text: "un\ndeux" } as RenderNode;
  const metrics = textMetrics(node);

  assert.equal(metrics.lineStep, 76);
  assert.equal(measuredTextHeight(node), 152);
});

test("an omitted lineHeight follows the font size", () => {
  assert.equal(textMetrics({ ...TEXT, fontSize: 64 } as RenderNode).lineStep, defaultLineHeight(64));
  assert.equal(defaultLineHeight(64), 86.4);
  assert.equal(defaultLineHeight(24), 32.4);
});

test("a ratio-looking lineHeight is rejected at write time", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const design = store.create({ name: "Texte" });

  assert.throws(
    () => addNodes(store, { design_id: design.id, nodes: [{ type: "text", fontSize: 64, lineHeight: 1.2 }] }),
    /PIXELS/
  );
  assert.throws(
    () => addNodes(store, { design_id: design.id, nodes: [{ type: "text", fontSize: 24, lineHeight: 3.9 }] }),
    /PIXELS/
  );
});

test("a plausible pixel lineHeight goes through, and reaches the HTML export in px", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const design = store.create({ name: "Texte" });

  addNodes(store, {
    design_id: design.id,
    nodes: [{ type: "text", id: "t", name: "Titre", fontSize: 64, lineHeight: 76, text: "Bonjour" }],
  });
  const html = exportDesign(store.get(design.id), "html");

  assert.match(html, /line-height: 76px;/);
  assert.doesNotMatch(html, /line-height: 1\./);
});

test("patching lineHeight with a ratio is refused too", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const design = store.create({ name: "Texte" });
  addNodes(store, { design_id: design.id, nodes: [{ type: "text", id: "t", fontSize: 32 }] });

  assert.throws(() => updateNodes(store, { design_id: design.id, updates: [{ id: "t", lineHeight: 1.35 }] }), /PIXELS/);
  updateNodes(store, { design_id: design.id, updates: [{ id: "t", lineHeight: 44 }] });
  assert.equal(store.get(design.id).nodes[0].lineHeight, 44);
});

test("migrateDesign converts legacy ratios using each node's own font size", () => {
  const migrated = migrateDesign({
    nodes: [
      { id: "a", type: "text", fontSize: 64, lineHeight: 1.35 },
      { id: "b", type: "text", fontSize: 16, lineHeight: 1.5 },
      { id: "c", type: "text", lineHeight: 1.35 },
      { id: "d", type: "text", fontSize: 24, lineHeight: 72 },
      { id: "e", type: "rect" },
    ],
    baseline: { nodes: [{ id: "a", type: "text", fontSize: 64, lineHeight: 1.35 }] },
  }) as any;

  assert.equal(migrated.nodes[0].lineHeight, 86.4);
  assert.equal(migrated.nodes[1].lineHeight, 24);
  // Sans fontSize, la valeur par défaut (24) sert de référence.
  assert.equal(migrated.nodes[2].lineHeight, 32.4);
  assert.equal(migrated.nodes[3].lineHeight, 72, "une valeur déjà en pixels n'est pas touchée");
  assert.equal(migrated.nodes[4].lineHeight, undefined);
  // La baseline suit, sinon le diff signalerait un faux changement sur chaque texte.
  assert.equal(migrated.baseline.nodes[0].lineHeight, 86.4);
});

test("migrateDesign is idempotent and reports no change when there is none", () => {
  const upToDate = { nodes: [{ id: "a", type: "text", fontSize: 24, lineHeight: 32 }] };

  assert.equal(migrateDesign(upToDate), null);
  assert.equal(migrateDesign(migrateDesign({ nodes: [{ id: "a", type: "text", fontSize: 24, lineHeight: 1.35 }] })), null);
});

test("an existing design file is migrated on read, without showing up as a user edit", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Legacy" });
  addNodes(store, {
    design_id: design.id,
    nodes: [{ type: "text", id: "t", fontSize: 40, lineHeight: 54, text: "Salut" }],
  });
  store.markSynced(design.id);

  // On réécrit le fichier dans l'ancienne unité, comme une version antérieure l'aurait fait.
  const file = path.join(dir, "designs", `${design.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  raw.nodes[0].lineHeight = 1.35;
  raw.baseline.nodes[0].lineHeight = 1.35;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf-8");
  (store as unknown as { cache: Map<string, unknown> }).cache.clear();

  const reloaded = store.get(design.id);

  assert.equal(reloaded.nodes[0].lineHeight, 54, "1.35 x 40 = 54");
  assert.match(getChanges(store, { design_id: design.id }).content[0].text, /No change/i);
  assert.equal(
    JSON.parse(fs.readFileSync(file, "utf-8")).nodes[0].lineHeight,
    54,
    "la migration est persistée, pas seulement appliquée en mémoire"
  );
});

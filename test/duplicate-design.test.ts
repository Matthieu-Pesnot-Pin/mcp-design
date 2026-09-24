import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { duplicateDesign } from "../src/tools/duplicate-design.js";
import { countChanges } from "../src/core/diff.js";

function makeSource(store: ReturnType<typeof makeStore>["store"]) {
  const design = store.create({ name: "Accueil", width: 375, height: 800, background: "#f0f0f0", group: "Mobile" });
  addNodes(store, {
    design_id: design.id,
    nodes: [
      { type: "group", id: "card", name: "Carte", x: 10, y: 10 },
      { type: "rect", id: "bg", parentId: "card", width: 200, height: 120 },
      { type: "instance", id: "i1", componentId: "card", x: 10, y: 200 },
    ],
  });
  return store.get(design.id);
}

test("duplicate_design copies the artboard and every node", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const source = makeSource(store);
  const result = duplicateDesign(store, { design_id: source.id });
  const copy = result.design!;

  assert.notEqual(copy.id, source.id);
  assert.equal(copy.name, "Accueil (copy)");
  assert.equal(copy.group, "Mobile");
  assert.equal(copy.width, 375);
  assert.equal(copy.height, 800);
  assert.equal(copy.background, "#f0f0f0");
  assert.deepEqual(copy.nodes, source.nodes);
  assert.equal(countChanges(copy.baseline.nodes, copy.nodes), 0);
  assert.deepEqual(store.get(copy.id).nodes, source.nodes);
});

test("duplicate_design accepts a name and a group, and leaves the original untouched", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const source = makeSource(store);
  const copy = duplicateDesign(store, { design_id: source.id, name: "Accueil B", group: null }).design!;

  assert.equal(copy.name, "Accueil B");
  assert.equal(copy.group, null);
  assert.deepEqual(store.get(source.id), source);
});

test("duplicate_design rejects an unknown design and an empty name", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const source = makeSource(store);
  assert.throws(() => duplicateDesign(store, { design_id: "ghost" }), /not found/);
  assert.throws(() => duplicateDesign(store, { design_id: source.id, name: " " }), /name/);
});

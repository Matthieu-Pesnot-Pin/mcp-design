import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { groupNodes } from "../src/tools/group-nodes.js";
import { duplicateNodes } from "../src/tools/duplicate-nodes.js";

/** Une carte : un fond et un titre, réunis dans un groupe. */
function makeCard(store: ReturnType<typeof makeStore>["store"]) {
  const design = store.create({ name: "Cartes" });
  addNodes(store, {
    design_id: design.id,
    nodes: [
      { type: "rect", id: "bg", name: "Fond", x: 0, y: 0, width: 200, height: 120 },
      { type: "text", id: "title", name: "Titre", x: 12, y: 12, text: "Carte" },
    ],
  });
  const grouped = groupNodes(store, { design_id: design.id, node_ids: ["bg", "title"], group_id: "card", name: "Carte" });
  return grouped.design!;
}

test("duplicating a group copies its whole content with fresh ids", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["card"] });
  const nodes = result.design!.nodes;

  assert.equal(nodes.length, 6);
  assert.equal(new Set(nodes.map((node) => node.id)).size, 6);

  const groups = nodes.filter((node) => node.type === "group");
  assert.equal(groups.length, 2);
  const copy = groups.find((node) => node.id !== "card")!;
  assert.equal(copy.name, "Carte");
  assert.equal(nodes.filter((node) => node.parentId === copy.id).length, 2);
});

test("only the copied roots are shifted, the content follows its parent", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  const original = store.get(design.id).nodes.find((node) => node.id === "card")!;
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["card"], offset_x: 240, offset_y: 0 });

  const copy = result.design!.nodes.find((node) => node.type === "group" && node.id !== "card")!;
  assert.equal(copy.x, original.x + 240);
  assert.equal(copy.y, original.y);

  const copiedTitle = result.design!.nodes.find((node) => node.parentId === copy.id && node.type === "text")!;
  const originalTitle = result.design!.nodes.find((node) => node.id === "title")!;
  assert.equal(copiedTitle.x, originalTitle.x);
  assert.equal(copiedTitle.y, originalTitle.y);
});

test("count lays out a regular series in one call", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  const result = duplicateNodes(store, {
    design_id: design.id,
    node_ids: ["card"],
    offset_x: 0,
    offset_y: 140,
    count: 3,
  });

  const copies = result.design!.nodes.filter((node) => node.type === "group" && node.id !== "card");
  assert.equal(copies.length, 3);
  assert.deepEqual(
    copies.map((node) => node.y).sort((a, b) => a - b),
    [140, 280, 420]
  );
});

test("a node whose group is also listed is not copied twice", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["card", "title"] });

  // 3 originaux + 3 copies : "title" n'a pas ete copie une seconde fois seul.
  assert.equal(result.design!.nodes.length, 6);
});

test("parent_id drops the copies into another group", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  addNodes(store, {
    design_id: design.id,
    nodes: [{ type: "rect", id: "side", name: "Colonne", x: 400, y: 0, width: 100, height: 100 }],
  });
  groupNodes(store, { design_id: design.id, node_ids: ["side"], group_id: "column", name: "Colonne" });

  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["title"], parent_id: "column" });
  const copy = result.design!.nodes.find((node) => node.type === "text" && node.id !== "title")!;
  assert.equal(copy.parentId, "column");
});

test("duplicate_nodes rejects an unknown node and an invalid count", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  assert.throws(() => duplicateNodes(store, { design_id: design.id, node_ids: ["ghost"] }), /not found/);
  assert.throws(() => duplicateNodes(store, { design_id: design.id, node_ids: ["card"], count: 0 }), /count/);
  assert.throws(
    () => duplicateNodes(store, { design_id: design.id, node_ids: ["card"], parent_id: "title" }),
    /must reference a group/
  );
  assert.equal(store.get(design.id).nodes.length, 3);
});

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

test("target_design_id copies a group into another design at its on-screen position", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  addNodes(store, { design_id: design.id, nodes: [{ type: "group", id: "section", name: "Section", x: 100, y: 50 }] });
  const moved = store.mutate(design.id, "agent", (draft) => {
    draft.nodes.find((node) => node.id === "card")!.parentId = "section";
  });
  const card = moved.nodes.find((node) => node.id === "card")!;

  const other = store.create({ name: "Autre" });
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["card"], target_design_id: other.id });

  assert.equal(result.design!.id, other.id);
  assert.equal(result.design!.nodes.length, 3);
  const copy = result.design!.nodes.find((node) => node.type === "group")!;
  assert.equal(copy.parentId, null);
  assert.equal(copy.x, card.x + 100);
  assert.equal(copy.y, card.y + 50);
  assert.equal(result.design!.nodes.filter((node) => node.parentId === copy.id).length, 2);
  assert.equal(store.get(design.id).nodes.length, 4);
});

test("target_design_id brings along the components of copied instances", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  addNodes(store, {
    design_id: design.id,
    nodes: [
      { type: "group", id: "list", name: "Liste", x: 0, y: 300 },
      { type: "instance", id: "i1", componentId: "card", parentId: "list", x: 0, y: 0 },
      { type: "instance", id: "i2", componentId: "card", parentId: "list", x: 220, y: 0 },
    ],
  });

  const other = store.create({ name: "Autre" });
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["list"], target_design_id: other.id, count: 2, offset_y: 200 });
  const nodes = result.design!.nodes;

  const components = nodes.filter((node) => node.name === "Carte" && node.type === "group");
  assert.equal(components.length, 1);
  const instances = nodes.filter((node) => node.type === "instance");
  assert.equal(instances.length, 4);
  assert.ok(instances.every((node) => node.componentId === components[0].id));
  assert.equal(nodes.filter((node) => node.parentId === components[0].id).length, 2);
});

test("an instance copied with its component points at the copied component", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  addNodes(store, { design_id: design.id, nodes: [{ type: "instance", id: "i1", componentId: "card", x: 300, y: 0 }] });

  const other = store.create({ name: "Autre" });
  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["card", "i1"], target_design_id: other.id });
  const nodes = result.design!.nodes;

  assert.equal(nodes.length, 4);
  const component = nodes.find((node) => node.type === "group")!;
  assert.equal(nodes.find((node) => node.type === "instance")!.componentId, component.id);
});

test("target_design_id resolves parent_id in the target design", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = makeCard(store);
  const other = store.create({ name: "Autre" });
  addNodes(store, { design_id: other.id, nodes: [{ type: "group", id: "zone", name: "Zone", x: 40, y: 40 }] });

  const result = duplicateNodes(store, { design_id: design.id, node_ids: ["title"], target_design_id: other.id, parent_id: "zone" });
  assert.equal(result.design!.nodes.find((node) => node.type === "text")!.parentId, "zone");

  assert.throws(
    () => duplicateNodes(store, { design_id: design.id, node_ids: ["title"], target_design_id: other.id, parent_id: "card" }),
    /not found in design "autre"/
  );
  assert.throws(() => duplicateNodes(store, { design_id: design.id, node_ids: ["title"], target_design_id: "ghost" }), /not found/);
});

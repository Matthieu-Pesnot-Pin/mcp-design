import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { groupNodes } from "../src/tools/group-nodes.js";
import { reorderNodesTool } from "../src/tools/reorder-nodes.js";
import { reorderNodes } from "../shared/tree.js";
import type { DesignNode } from "../shared/schemas/design.schema.js";

/** Ordre d'empilement d'une fratrie, du fond vers le dessus. */
function orderOf(nodes: DesignNode[], parentId: string | null): string[] {
  return nodes.filter((node) => node.parentId === parentId).map((node) => node.id);
}

function seed() {
  const { store, cleanup } = makeStore();
  const design = store.create({ name: "Stack" });
  addNodes(store, {
    design_id: design.id,
    nodes: [
      { type: "rect", id: "a", x: 0, y: 0 },
      { type: "rect", id: "b", x: 10, y: 10 },
      { type: "rect", id: "c", x: 20, y: 20 },
      { type: "rect", id: "d", x: 30, y: 30 },
    ],
  });
  return { store, id: design.id, cleanup };
}

test("front and back send nodes to the edges of their sibling order", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "front" });
  assert.deepEqual(orderOf(store.get(id).nodes, null), ["b", "c", "d", "a"]);

  reorderNodesTool(store, { design_id: id, node_ids: ["d"], position: "back" });
  assert.deepEqual(orderOf(store.get(id).nodes, null), ["d", "b", "c", "a"]);
});

test("forward and backward move a node one step at a time", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "forward" });
  assert.deepEqual(orderOf(store.get(id).nodes, null), ["b", "a", "c", "d"]);

  reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "backward" });
  assert.deepEqual(orderOf(store.get(id).nodes, null), ["a", "b", "c", "d"]);
});

test("a node already at the edge does not move, and says so", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  const result = reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "back" });

  assert.match(result.content[0].text, /Nothing moved/);
  assert.deepEqual(orderOf(store.get(id).nodes, null), ["a", "b", "c", "d"]);
});

test("moving several nodes at once preserves their relative order", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  reorderNodesTool(store, { design_id: id, node_ids: ["a", "c"], position: "front" });

  assert.deepEqual(orderOf(store.get(id).nodes, null), ["b", "d", "a", "c"]);
});

test("stacking stays inside a group: a member cannot climb past the group's siblings", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  groupNodes(store, { design_id: id, node_ids: ["a", "b"], group_id: "g1", name: "Carte" });
  // La planche vaut désormais : racine = [g1, c, d], contenu de g1 = [a, b].
  reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "front" });

  const nodes = store.get(id).nodes;
  assert.deepEqual(orderOf(nodes, "g1"), ["b", "a"], "a passe devant b, à l'intérieur du groupe");
  assert.deepEqual(orderOf(nodes, null), ["g1", "c", "d"], "la racine n'a pas bougé");
});

test("a group carries its whole content when it moves", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  groupNodes(store, { design_id: id, node_ids: ["a", "b"], group_id: "g1" });
  reorderNodesTool(store, { design_id: id, node_ids: ["g1"], position: "front" });

  const nodes = store.get(id).nodes;
  assert.deepEqual(orderOf(nodes, null), ["c", "d", "g1"]);
  assert.deepEqual(orderOf(nodes, "g1"), ["a", "b"]);
  // Le stockage reste en parcours préfixe : le groupe est suivi de son sous-arbre.
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["c", "d", "g1", "a", "b"]
  );
});

test("selecting a node together with its own group ignores the redundant one", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  groupNodes(store, { design_id: id, node_ids: ["a", "b"], group_id: "g1" });
  reorderNodesTool(store, { design_id: id, node_ids: ["g1", "a"], position: "front" });

  const nodes = store.get(id).nodes;
  assert.deepEqual(orderOf(nodes, null), ["c", "d", "g1"]);
  assert.deepEqual(orderOf(nodes, "g1"), ["a", "b"], "a n'a pas bougé dans le groupe");
});

test("an unknown node id or an unknown position is rejected", (t) => {
  const { store, id, cleanup } = seed();
  t.after(cleanup);

  assert.throws(() => reorderNodesTool(store, { design_id: id, node_ids: ["nope"], position: "front" }), /not found/);
  assert.throws(() => reorderNodesTool(store, { design_id: id, node_ids: ["a"], position: "up" }), /must be one of/);
  assert.throws(() => reorderNodesTool(store, { design_id: id, node_ids: [], position: "front" }), /non-empty array/);
});

test("reorderNodes leaves the list untouched when nothing can move", () => {
  const nodes: DesignNode[] = [
    { id: "a", type: "rect", name: "A", parentId: null, x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 },
  ];

  assert.equal(reorderNodes(nodes, [], "front"), nodes);
  assert.deepEqual(
    reorderNodes(nodes, ["a"], "forward").map((node) => node.id),
    ["a"]
  );
});

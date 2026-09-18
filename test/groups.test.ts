import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { createDesign } from "../src/tools/create-design.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { updateNodes } from "../src/tools/update-nodes.js";
import { deleteNodes } from "../src/tools/delete-nodes.js";
import { groupNodes } from "../src/tools/group-nodes.js";
import { ungroupNodes } from "../src/tools/ungroup-nodes.js";
import { getChanges } from "../src/tools/get-changes.js";
import { markSynced } from "../src/tools/mark-synced.js";
import { exportDesignTool } from "../src/tools/export-design.js";
import { getDesign } from "../src/tools/get-design.js";
import { computeLayout, boundsOf, descendantIds, ancestorsOf } from "../shared/tree.js";
import type { RenderNode } from "../shared/render.js";
import type { DesignStore } from "../src/core/design-store.js";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0].text ?? "";
}

/** Deux cartes côte à côte, prêtes à être regroupées. */
function seed(store: DesignStore) {
  createDesign(store, { name: "Board", width: 800, height: 600 });
  addNodes(store, {
    design_id: "board",
    nodes: [
      { type: "rect", id: "a", x: 100, y: 100, width: 200, height: 100 },
      { type: "rect", id: "b", x: 400, y: 150, width: 100, height: 100 },
      { type: "text", id: "loose", x: 20, y: 500, text: "Hors groupe" },
    ],
  });
  return () => store.get("board");
}

function documentBox(store: DesignStore, nodeId: string) {
  const design = store.get("board");
  return boundsOf(computeLayout(design.nodes as unknown as RenderNode[]), nodeId);
}

test("grouping rebases coordinates so nothing moves on screen", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const board = seed(store);

  const before = { a: documentBox(store, "a"), b: documentBox(store, "b") };
  const result = groupNodes(store, { design_id: "board", node_ids: ["a", "b"], name: "Cartes", group_id: "g1" });
  assert.match(textOf(result), /Grouped 2 node\(s\) into "Cartes" \(g1\)/);

  const design = board();
  const group = design.nodes.find((n) => n.id === "g1")!;
  assert.equal(group.type, "group");
  assert.equal(group.parentId, null);
  assert.deepEqual({ x: group.x, y: group.y }, { x: 100, y: 100 }, "the group sits on the top-left of its content");

  const a = design.nodes.find((n) => n.id === "a")!;
  assert.equal(a.parentId, "g1");
  assert.deepEqual({ x: a.x, y: a.y }, { x: 0, y: 0 }, "coordinates become relative to the group");

  assert.deepEqual(documentBox(store, "a"), before.a, "position on screen is unchanged");
  assert.deepEqual(documentBox(store, "b"), before.b);
});

test("a group's size is derived from its content", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);

  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  const group = () => store.get("board").nodes.find((n) => n.id === "g1")!;
  // a: 100..300 x 100..200 ; b: 400..500 x 150..250 -> 400 x 150
  assert.deepEqual({ width: group().width, height: group().height }, { width: 400, height: 150 });

  updateNodes(store, { design_id: "board", updates: [{ id: "b", width: 300 }] });
  assert.equal(group().width, 600, "widening a child widens the group");
});

test("the derived size of a group is not writable", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a"], group_id: "g1" });

  assert.throws(
    () => updateNodes(store, { design_id: "board", updates: [{ id: "g1", width: 999 }] }),
    /size of a group is derived from its content/
  );
});

test("moving a group moves its content and changes a single field", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  markSynced(store, { design_id: "board" });

  updateNodes(store, { design_id: "board", updates: [{ id: "g1", x: 150, y: 200 }] });

  assert.deepEqual(documentBox(store, "a"), { x: 150, y: 200, width: 200, height: 100 });
  const changes = textOf(getChanges(store, { design_id: "board" }));
  assert.match(changes, /## Updated \(1\)/, "only the group itself changed");
  assert.match(changes, /x: 100 -> 150/);
});

test("ungrouping restores absolute coordinates without moving anything", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  updateNodes(store, { design_id: "board", updates: [{ id: "g1", x: 150 }] });

  const before = documentBox(store, "a");
  assert.match(textOf(ungroupNodes(store, { design_id: "board", group_ids: ["g1"] })), /2 node\(s\) moved up one level/);

  const design = store.get("board");
  assert.equal(design.nodes.find((n) => n.id === "g1"), undefined);
  assert.equal(design.nodes.find((n) => n.id === "a")!.parentId, null);
  assert.deepEqual(documentBox(store, "a"), before);
});

test("nested groups resolve through several levels", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);

  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "inner" });
  groupNodes(store, { design_id: "board", node_ids: ["inner"], group_id: "outer" });

  const design = store.get("board");
  assert.equal(design.nodes.find((n) => n.id === "inner")!.parentId, "outer");
  assert.deepEqual([...descendantIds(design.nodes, "outer")].sort(), ["a", "b", "inner"]);
  assert.deepEqual(
    ancestorsOf(design.nodes, "a").map((n) => n.id),
    ["inner", "outer"]
  );

  updateNodes(store, { design_id: "board", updates: [{ id: "outer", x: 200 }] });
  assert.equal(documentBox(store, "a").x, 200, "the offset cascades down two levels");
});

test("dissolving several nested groups at once keeps positions", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "inner" });
  groupNodes(store, { design_id: "board", node_ids: ["inner"], group_id: "outer" });
  updateNodes(store, { design_id: "board", updates: [{ id: "outer", x: 260, y: 40 }] });

  const before = documentBox(store, "b");
  ungroupNodes(store, { design_id: "board", group_ids: ["outer", "inner"] });

  const design = store.get("board");
  assert.deepEqual(design.nodes.map((n) => n.parentId), [null, null, null]);
  assert.deepEqual(documentBox(store, "b"), before);
});

test("deleting a group deletes its content", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });

  const result = deleteNodes(store, { design_id: "board", node_ids: ["g1"] });
  assert.match(textOf(result), /Deleted 3 node\(s\).*2 of them nested/);
  assert.deepEqual(store.get("board").nodes.map((n) => n.id), ["loose"]);
});

test("reparenting through update_nodes is accepted", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a"], group_id: "g1" });

  updateNodes(store, { design_id: "board", updates: [{ id: "loose", parentId: "g1" }] });
  assert.equal(store.get("board").nodes.find((n) => n.id === "loose")!.parentId, "g1");

  updateNodes(store, { design_id: "board", updates: [{ id: "loose", parentId: null }] });
  assert.equal(store.get("board").nodes.find((n) => n.id === "loose")!.parentId, null);
});

test("a node cannot be parented to a non-group or to a missing node", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);

  assert.throws(
    () => updateNodes(store, { design_id: "board", updates: [{ id: "a", parentId: "b" }] }),
    /because it is a "rect", not a group/
  );
  assert.throws(
    () => updateNodes(store, { design_id: "board", updates: [{ id: "a", parentId: "fantome" }] }),
    /parent "fantome" that does not exist/
  );
});

test("a cycle is refused rather than persisted", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a"], group_id: "inner" });
  groupNodes(store, { design_id: "board", node_ids: ["inner"], group_id: "outer" });

  assert.throws(
    () => updateNodes(store, { design_id: "board", updates: [{ id: "outer", parentId: "inner" }] }),
    /cycle/
  );
  assert.equal(store.get("board").nodes.find((n) => n.id === "outer")!.parentId, null);
});

test("grouping across different parents is refused", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a"], group_id: "g1" });

  assert.throws(
    () => groupNodes(store, { design_id: "board", node_ids: ["a", "b"] }),
    /nodes that live in different groups/
  );
});

test("grouping a group with its own descendant is refused", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a"], group_id: "g1" });

  assert.throws(
    () => groupNodes(store, { design_id: "board", node_ids: ["g1", "a"] }),
    /together with its own ancestor|different groups/
  );
});

test("ungroup refuses a node that is not a group", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);

  assert.throws(() => ungroupNodes(store, { design_id: "board", group_ids: ["a"] }), /is a "rect", not a group/);
});

test("svg export nests groups and keeps children in local coordinates", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  updateNodes(store, { design_id: "board", updates: [{ id: "g1", x: 150, y: 120 }] });

  const svg = textOf(exportDesignTool(store, { design_id: "board", format: "svg" }));
  assert.match(svg, /<g transform="translate\(150 120\)">/);
  assert.match(svg, /<rect x="0" y="0" width="200" height="100"/, "the child keeps its local coordinates");
  assert.match(svg, /<\/g>/);
});

test("html export nests divs and offsets children against their group", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });

  const html = textOf(exportDesignTool(store, { design_id: "board", format: "html" }));
  // Le groupe est positionné sur la boîte de son contenu, les enfants à l'intérieur.
  assert.match(html, /\.d-groupe-g1 \{[^}]*left: 100px;[^}]*top: 100px;[^}]*width: 400px;[^}]*height: 150px;/s);
  assert.match(html, /<div class="d-groupe-g1">/);
  assert.match(html, /<\/div>/);
});

test("the summary indents grouped nodes and reports document coordinates", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  updateNodes(store, { design_id: "board", updates: [{ id: "g1", x: 150 }] });

  const summary = textOf(getDesign(store, { design_id: "board" }));
  assert.match(summary, /- g1 group "Groupe" @ 150,100 400x150 — 2 child\(ren\)/);
  assert.match(summary, /^ {2}- a rect "Rectangle 1" @ 150,100/m, "children are indented under their group");
});

test("grouping and ungrouping are reported to the agent as changes", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  seed(store);
  markSynced(store, { design_id: "board" });

  groupNodes(store, { design_id: "board", node_ids: ["a", "b"], group_id: "g1" });
  const changes = textOf(getChanges(store, { design_id: "board" }));

  assert.match(changes, /## Added \(1\)/);
  assert.match(changes, /g1 — "Groupe" \(group\) at 100,100/);
  assert.match(changes, /parentId: racine -> "g1"/, "reparenting shows up on the members");
});

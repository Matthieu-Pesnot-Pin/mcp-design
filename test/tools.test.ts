import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import path from "path";
import { makeStore } from "./helpers.js";
import { listDesigns } from "../src/tools/list-designs.js";
import { createDesign } from "../src/tools/create-design.js";
import { getDesign } from "../src/tools/get-design.js";
import { updateDesign } from "../src/tools/update-design.js";
import { deleteDesign } from "../src/tools/delete-design.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { updateNodes } from "../src/tools/update-nodes.js";
import { deleteNodes } from "../src/tools/delete-nodes.js";
import { getChanges } from "../src/tools/get-changes.js";
import { markSynced } from "../src/tools/mark-synced.js";
import { exportDesignTool } from "../src/tools/export-design.js";

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

test("list_designs guides the agent when there is nothing yet", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  assert.match(textOf(listDesigns(store)), /No design yet\. Use create_design/);
});

test("create_design then list_designs surfaces the new design", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const created = createDesign(store, { name: "Landing", width: 375, height: 812 });
  assert.equal(created.design!.id, "landing");
  assert.match(textOf(created), /375x812/);
  assert.match(textOf(listDesigns(store)), /landing — "Landing" 375x812, 0 node\(s\)/);
});

test("create_design requires a name", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  assert.throws(() => createDesign(store, {}), /"name" is required/);
});

test("add_nodes creates the nodes and reports their geometry", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });

  const result = addNodes(store, {
    design_id: "board",
    nodes: [
      { type: "rect", id: "card", x: 40, y: 40, width: 300, height: 180 },
      { type: "text", id: "title", x: 60, y: 60, text: "Bonjour" },
    ],
  });

  assert.match(textOf(result), /Added 2 node\(s\)/);
  assert.match(textOf(result), /card — "Rectangle 1" \(rect\) at 40,40 size 300x180/);
  assert.equal(store.get("board").nodes.length, 2);
});

test("add_nodes writes nothing when one entry of the batch is invalid", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });

  assert.throws(() =>
    addNodes(store, { design_id: "board", nodes: [{ type: "rect" }, { type: "hexagon" }] })
  );
  assert.equal(store.get("board").nodes.length, 0, "the valid node must not be persisted either");
  assert.equal(store.get("board").revision, 0);
});

test("add_nodes rejects an empty batch", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  assert.throws(() => addNodes(store, { design_id: "board", nodes: [] }), /non-empty array/);
});

test("update_nodes patches only the given fields", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "text", id: "t", text: "Avant", fontSize: 20, x: 10 }] });

  updateNodes(store, { design_id: "board", updates: [{ id: "t", text: "Après", fontSize: 48 }] });

  const node = store.get("board").nodes[0];
  assert.equal(node.text, "Après");
  assert.equal(node.fontSize, 48);
  assert.equal(node.x, 10, "untouched fields are preserved");
});

test("update_nodes names the known ids when one is unknown", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "known" }] });

  assert.throws(
    () => updateNodes(store, { design_id: "board", updates: [{ id: "ghost", x: 1 }] }),
    /Known ids: known/
  );
});

test("update_nodes applies nothing when one update of the batch is invalid", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "a", x: 0 }, { type: "rect", id: "b", x: 0 }] });
  const revisionBefore = store.get("board").revision;

  assert.throws(() =>
    updateNodes(store, { design_id: "board", updates: [{ id: "a", x: 500 }, { id: "b", fontSize: 12 }] })
  );

  assert.equal(store.get("board").nodes[0].x, 0);
  assert.equal(store.get("board").revision, revisionBefore);
});

test("delete_nodes removes the nodes and refuses unknown ids", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "a" }, { type: "rect", id: "b" }] });

  assert.throws(() => deleteNodes(store, { design_id: "board", node_ids: ["a", "zzz"] }), /not found/);
  assert.equal(store.get("board").nodes.length, 2, "a partially valid batch deletes nothing");

  deleteNodes(store, { design_id: "board", node_ids: ["a"] });
  assert.deepEqual(store.get("board").nodes.map((n) => n.id), ["b"]);
});

test("update_design changes the artboard, not the nodes", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect" }] });

  updateDesign(store, { design_id: "board", name: "Renommé", background: "#000000", width: 1024 });

  const design = store.get("board");
  assert.equal(design.name, "Renommé");
  assert.equal(design.background, "#000000");
  assert.equal(design.width, 1024);
  assert.equal(design.nodes.length, 1);
});

test("update_design refuses a call that changes nothing", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  const revisionBefore = store.get("board").revision;

  assert.throws(() => updateDesign(store, { design_id: "board" }), /Nothing to update/);
  assert.equal(store.get("board").revision, revisionBefore);
});

test("get_design offers a summary and a json view", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "text", id: "t", text: "Salut" }] });
  markSynced(store, { design_id: "board" });

  assert.match(textOf(getDesign(store, { design_id: "board" })), /# Board \(board\)/);

  const json = JSON.parse(textOf(getDesign(store, { design_id: "board", format: "json" })));
  assert.equal(json.nodes[0].text, "Salut");
});

test("get_design warns when user edits are still pending", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect" }] });

  assert.match(textOf(getDesign(store, { design_id: "board" })), /Call get_changes/);
});

test("get_changes reports what the user edited in the GUI", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "card", x: 0, fill: "#ffffff" }] });
  markSynced(store, { design_id: "board" });

  // L'utilisateur déplace et recolore la carte depuis la GUI.
  store.mutate("board", "user", (draft) => {
    draft.nodes[0].x = 240;
    draft.nodes[0].fill = "#ff5533";
  });

  const text = textOf(getChanges(store, { design_id: "board" }));
  assert.match(text, /## Updated \(1\)/);
  assert.match(text, /x: 0 -> 240/);
  assert.match(text, /fill: "#ffffff" -> "#ff5533"/);
  assert.match(text, /last edited by user/);
});

test("get_changes never acknowledges the changes it reports", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "card" }] });

  const first = textOf(getChanges(store, { design_id: "board" }));
  const second = textOf(getChanges(store, { design_id: "board" }));
  assert.equal(first, second);
  assert.match(second, /## Added \(1\)/);
});

test("mark_synced clears the diff until the next edit", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "card" }] });

  assert.match(textOf(markSynced(store, { design_id: "board" })), /1 change\(s\) acknowledged/);
  assert.match(textOf(getChanges(store, { design_id: "board" })), /No change in "Board"/);

  store.mutate("board", "user", (draft) => {
    draft.nodes[0].y = 999;
  });
  assert.match(textOf(getChanges(store, { design_id: "board" })), /y: 0 -> 999/);
});

test("mark_synced on an already-clean design says so", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  assert.match(textOf(markSynced(store, { design_id: "board" })), /already up to date/);
});

test("export_design returns the content, or writes it to a file", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  addNodes(store, { design_id: "board", nodes: [{ type: "rect", id: "card" }] });

  assert.match(textOf(exportDesignTool(store, { design_id: "board" })), /<!doctype html>/);
  assert.match(textOf(exportDesignTool(store, { design_id: "board", format: "svg" })), /<svg /);

  const target = path.join(dir, "out", "board.html");
  assert.match(textOf(exportDesignTool(store, { design_id: "board", output_path: target })), /exported as html to/);
  assert.match(fs.readFileSync(target, "utf-8"), /<!doctype html>/);
});

test("export_design rejects an unknown format", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });
  assert.throws(() => exportDesignTool(store, { design_id: "board", format: "pdf" }), /Unknown format "pdf"/);
});

test("delete_design removes the design for good", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  createDesign(store, { name: "Board" });

  assert.match(textOf(deleteDesign(store, { design_id: "board" })), /deleted/);
  assert.match(textOf(listDesigns(store)), /No design yet/);
});

test("every tool rejects a missing design_id the same way", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const calls: Array<() => unknown> = [
    () => getDesign(store, {}),
    () => updateDesign(store, {}),
    () => deleteDesign(store, {}),
    () => addNodes(store, { nodes: [{ type: "rect" }] }),
    () => updateNodes(store, { updates: [{ id: "a" }] }),
    () => deleteNodes(store, { node_ids: ["a"] }),
    () => getChanges(store, {}),
    () => markSynced(store, {}),
    () => exportDesignTool(store, {}),
  ];
  for (const call of calls) {
    assert.throws(call, /"design_id" is required/);
  }
});

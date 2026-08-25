import assert from "node:assert/strict";
import test from "node:test";
import { diffNodes, formatDiff, countChanges } from "../src/core/diff.js";
import { buildNode } from "../src/core/node-factory.js";
import type { DesignNode } from "../shared/schemas/design.schema.js";

function rect(id: string, overrides: Record<string, unknown> = {}): DesignNode {
  return buildNode({ type: "rect", id, ...overrides }, new Set(), 1);
}

test("an identical list yields no change", () => {
  const nodes = [rect("a"), rect("b")];
  const diff = diffNodes(nodes, structuredClone(nodes));
  assert.deepEqual(diff, { added: [], updated: [], removed: [], reordered: false });
  assert.equal(formatDiff(diff), "No changes since the last mark_synced.");
});

test("an added node is reported as added", () => {
  const diff = diffNodes([rect("a")], [rect("a"), rect("b")]);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].id, "b");
  assert.equal(diff.updated.length, 0);
  assert.equal(diff.removed.length, 0);
});

test("a removed node is reported as removed", () => {
  const diff = diffNodes([rect("a"), rect("b")], [rect("a")]);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].id, "b");
});

test("a modified field is reported with its before and after values", () => {
  const before = [rect("a", { x: 0, fill: "#ffffff" })];
  const after = [rect("a", { x: 120, fill: "#ff0000" })];
  const diff = diffNodes(before, after);

  assert.equal(diff.updated.length, 1);
  const changed = Object.fromEntries(diff.updated[0].changes.map((c) => [c.field, c]));
  assert.deepEqual({ before: changed.x.before, after: changed.x.after }, { before: 0, after: 120 });
  assert.deepEqual({ before: changed.fill.before, after: changed.fill.after }, { before: "#ffffff", after: "#ff0000" });
});

test("sub-pixel noise from the GUI is not a change", () => {
  const diff = diffNodes([rect("a", { x: 100 })], [rect("a", { x: 100.004 })]);
  assert.equal(diff.updated.length, 0);
});

test("a real one-pixel move is a change", () => {
  const diff = diffNodes([rect("a", { x: 100 })], [rect("a", { x: 101 })]);
  assert.equal(diff.updated.length, 1);
});

test("reordering without any field change is reported on its own", () => {
  const a = rect("a");
  const b = rect("b");
  const diff = diffNodes([a, b], [b, a]);
  assert.equal(diff.updated.length, 0);
  assert.equal(diff.reordered, true);
});

test("adding a node on top is not a reorder", () => {
  const diff = diffNodes([rect("a")], [rect("a"), rect("b")]);
  assert.equal(diff.reordered, false);
});

test("countChanges sums additions, updates and removals", () => {
  const before = [rect("a"), rect("b")];
  const after = [rect("a", { x: 10 }), rect("c")];
  assert.equal(countChanges(before, after), 3);
});

test("formatDiff lists each category with readable values", () => {
  const before = [rect("a", { x: 0, name: "Carte" }), rect("gone")];
  const after = [rect("a", { x: 40, name: "Carte" }), rect("new")];
  const text = formatDiff(diffNodes(before, after));

  assert.match(text, /## Added \(1\)/);
  assert.match(text, /## Updated \(1\)/);
  assert.match(text, /## Removed \(1\)/);
  assert.match(text, /x: 0 -> 40/);
});

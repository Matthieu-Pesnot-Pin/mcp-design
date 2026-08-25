import assert from "node:assert/strict";
import test from "node:test";
import { buildNode, applyPatch, DesignError } from "../src/core/node-factory.js";

test("a node can be created from its type alone", () => {
  const rect = buildNode({ type: "rect" }, new Set(), 1);
  assert.equal(rect.type, "rect");
  assert.equal(rect.name, "Rectangle 1");
  assert.equal(rect.x, 0);
  assert.equal(rect.width, 200);
  assert.equal(rect.opacity, 1);
  assert.equal(rect.rotation, 0);
  assert.ok(rect.id.startsWith("n_"));
  assert.ok(rect.fill, "a shape must be visible by default");
});

test("text nodes get typography defaults", () => {
  const text = buildNode({ type: "text" }, new Set(), 1);
  assert.equal(text.text, "Texte");
  assert.equal(text.fontSize, 24);
  assert.equal(text.fontWeight, 400);
  assert.equal(text.textAlign, "left");
});

test("explicit values override the defaults", () => {
  const node = buildNode(
    { type: "text", id: "title", name: "Titre", x: 40, y: 60, width: 500, text: "Bonjour", fontSize: 64, color: "#ff0000" },
    new Set(),
    1
  );
  assert.equal(node.id, "title");
  assert.equal(node.name, "Titre");
  assert.equal(node.x, 40);
  assert.equal(node.fontSize, 64);
  assert.equal(node.color, "#ff0000");
});

test("an unknown node type is rejected with the list of valid types", () => {
  assert.throws(() => buildNode({ type: "triangle" }, new Set(), 1), /rect, ellipse, line, text/);
});

test("a duplicate explicit id is rejected", () => {
  assert.throws(() => buildNode({ type: "rect", id: "dup" }, new Set(["dup"]), 1), /already exists/);
});

test("a non-numeric coordinate is rejected", () => {
  assert.throws(() => buildNode({ type: "rect", x: "left" }, new Set(), 1), /must be a finite number/);
});

test("shapes cannot be created with a zero or negative size", () => {
  const node = buildNode({ type: "rect", width: 0, height: -50 }, new Set(), 1);
  assert.equal(node.width, 1);
  assert.equal(node.height, 50);
});

test("lines keep negative deltas, which encode their direction", () => {
  const line = buildNode({ type: "line", x: 100, y: 100, width: -80, height: -40 }, new Set(), 1);
  assert.equal(line.width, -80);
  assert.equal(line.height, -40);
});

test("applyPatch only touches the given fields", () => {
  const text = buildNode({ type: "text", text: "Avant", fontSize: 20 }, new Set(), 1);
  const patched = applyPatch(text, { text: "Après" });
  assert.equal(patched.text, "Après");
  assert.equal(patched.fontSize, 20);
  assert.equal(patched.id, text.id);
});

test("applyPatch rejects an out-of-range opacity", () => {
  const rect = buildNode({ type: "rect" }, new Set(), 1);
  assert.throws(() => applyPatch(rect, { opacity: 2 }), DesignError);
});

test("applyPatch rejects an empty name", () => {
  const rect = buildNode({ type: "rect" }, new Set(), 1);
  assert.throws(() => applyPatch(rect, { name: "   " }), /non-empty string/);
});

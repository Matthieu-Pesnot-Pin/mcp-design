import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch, buildNode } from "../src/core/node-factory.js";
import { defaultLineHeight, measuredTextHeight, textMetrics, type RenderNode } from "../shared/render.js";

/**
 * La boîte d'un texte posé sans hauteur épouse son texte. C'est ce qui fait
 * que le texte commence bien au point donné : le bloc de lignes est centré
 * dans sa boîte, et une boîte à sa taille n'a plus rien à décaler.
 */

test("a text created without a height gets the height of its text", () => {
  const node = buildNode({ type: "text", x: 40, y: 60, text: "Bonjour", fontSize: 24, lineHeight: 32 }, new Set(), 1);
  assert.equal(node.height, 32);
  assert.equal(textMetrics(node as unknown as RenderNode).blockOffset, 0, "rien à décaler : le texte part du haut");
});

test("the default text node hugs its default text", () => {
  const node = buildNode({ type: "text" }, new Set(), 1);
  assert.equal(node.height, measuredTextHeight(node as unknown as RenderNode));
});

test("several lines make a taller box, not an overflowing one", () => {
  const node = buildNode({ type: "text", text: "une\ndeux\ntrois", fontSize: 20, lineHeight: 30 }, new Set(), 1);
  assert.equal(node.height, 90);
  assert.equal(textMetrics(node as unknown as RenderNode).blockOffset, 0);
});

test("without lineHeight the box follows the default interline", () => {
  const node = buildNode({ type: "text", text: "une\ndeux", fontSize: 40 }, new Set(), 1);
  assert.equal(node.height, 2 * defaultLineHeight(40));
});

test("an explicit height is kept — that is how a label centres in its button", () => {
  const node = buildNode({ type: "text", y: 100, height: 26, text: "OK", fontSize: 12 }, new Set(), 1);
  assert.equal(node.height, 26);
  assert.ok(textMetrics(node as unknown as RenderNode).blockOffset > 0, "le libellé reste centré dans son bouton");
});

test("a box that hugs its text keeps hugging it when the text grows", () => {
  const node = buildNode({ type: "text", text: "une", fontSize: 20, lineHeight: 30 }, new Set(), 1);
  const patched = applyPatch(node, { text: "une\ndeux" });
  assert.equal(patched.height, 60);
});

test("a chosen height survives a text change", () => {
  const node = buildNode({ type: "text", height: 26, text: "OK", fontSize: 12, lineHeight: 16 }, new Set(), 1);
  assert.equal(applyPatch(node, { text: "Valider" }).height, 26);
});

test("a height given in the same patch wins over the fit", () => {
  const node = buildNode({ type: "text", text: "une", fontSize: 20, lineHeight: 30 }, new Set(), 1);
  assert.equal(applyPatch(node, { text: "une\ndeux", height: 200 }).height, 200);
});

test("growing the font size grows the box that hugs the text", () => {
  const node = buildNode({ type: "text", text: "Titre", fontSize: 20 }, new Set(), 1);
  const patched = applyPatch(node, { fontSize: 40 });
  assert.equal(patched.height, defaultLineHeight(40));
});

import assert from "node:assert/strict";
import test from "node:test";
import { textMetrics, type RenderNode } from "../shared/render.js";

function textNode(patch: Partial<RenderNode>): RenderNode {
  return {
    id: "t",
    type: "text",
    name: "Texte",
    parentId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    rotation: 0,
    opacity: 1,
    text: "Bonjour",
    fontSize: 20,
    ...patch,
  } as RenderNode;
}

/** Centre optique d'une ligne : la ligne de base moins la demi-hauteur des capitales. */
function opticalCentre(node: RenderNode): number {
  const m = textMetrics(node);
  return m.firstBaseline - m.fontSize * 0.36;
}

test("a single line sits at the middle of its box whatever the line height", () => {
  for (const lineHeight of [8, 27, 32, 64]) {
    const node = textNode({ height: 40, fontSize: 20, lineHeight });
    assert.equal(
      Math.round(opticalCentre(node) * 100) / 100,
      20,
      `lineHeight ${lineHeight} must not move the line away from the middle of the box`
    );
  }
});

test("the badge case that was rendered below its own box is now centred", () => {
  // Valeurs relevées sur un badge réel : interligne 32 pour une ligne de 11px
  // dans une boîte de 16px poussait la ligne de base à 19.96, donc sous la boîte.
  const node = textNode({ height: 16, fontSize: 11, lineHeight: 32, text: "Technologie" });
  assert.equal(opticalCentre(node), 8);
  assert.ok(textMetrics(node).firstBaseline < 16, "the baseline must fall inside the box");
});

test("several lines are centred as a block, and keep their spacing", () => {
  const node = textNode({ height: 100, fontSize: 20, lineHeight: 30, text: "une\ndeux" });
  const m = textMetrics(node);

  assert.equal(m.blockHeight, 60);
  assert.equal(m.blockOffset, 20);
  // Les deux lignes restent espacées de lineStep, centrées autour de height / 2.
  assert.equal(opticalCentre(node), 35);
  assert.equal(opticalCentre(node) + m.lineStep, 65);
});

test("a box that exactly fits its text keeps the previous placement", () => {
  // Cas le plus courant : height = lignes x interligne. Le centrage ne doit rien
  // déplacer, sinon tous les designs déjà réglés bougeraient.
  const node = textNode({ height: 54, fontSize: 20, lineHeight: 27, text: "une\ndeux" });
  const m = textMetrics(node);
  assert.equal(m.blockOffset, 0);
  assert.equal(m.firstBaseline, 27 * 0.5 + 20 * 0.36);
});

test("a text taller than its box overflows symmetrically", () => {
  const node = textNode({ height: 10, fontSize: 20, lineHeight: 27, text: "une ligne" });
  const m = textMetrics(node);
  assert.equal(m.blockOffset, (10 - 27) / 2);
  assert.equal(opticalCentre(node), 5, "the line stays centred on the box even when it does not fit");
});

import assert from "node:assert/strict";
import test from "node:test";
import { screenshotDesign } from "../src/core/screenshot.js";
import { subtreeToSvg } from "../shared/render.js";
import { buildNode } from "../src/core/node-factory.js";
import type { Design, DesignNode } from "../shared/schemas/design.schema.js";

function makeDesign(nodes: DesignNode[]): Design {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "shot",
    name: "Shot Design",
    width: 800,
    height: 600,
    background: "#fafaf8",
    nodes,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    lastEditor: "agent",
    baseline: { revision: 0, at: now, nodes: [] },
  };
}

const taken = new Set<string>();
const group = buildNode({ type: "group", id: "g1", name: "Carte", x: 100, y: 50 }, taken, 1);
const rect = buildNode(
  { type: "rect", id: "r1", name: "Fond", parentId: "g1", x: 0, y: 0, width: 200, height: 120, fill: "#ffffff" },
  taken,
  2
);
const label = buildNode(
  { type: "text", id: "t1", name: "Titre", parentId: "g1", x: 16, y: 16, width: 160, text: "Bonjour", fontSize: 24 },
  taken,
  3
);
const outside = buildNode(
  { type: "rect", id: "r2", name: "Ailleurs", x: 500, y: 400, width: 100, height: 100, fill: "#ff0000" },
  taken,
  4
);

const design = makeDesign([group, rect, label, outside]);

test("a full-design screenshot matches the artboard size", () => {
  const shot = screenshotDesign(design, { maxDimension: 4000 });

  assert.equal(shot.sourceWidth, 800);
  assert.equal(shot.sourceHeight, 600);
  assert.equal(shot.width, 800);
  assert.equal(shot.height, 600);
  assert.equal(shot.png.subarray(1, 4).toString("ascii"), "PNG");
});

test("a group screenshot is framed on the group's bounding box plus its padding", () => {
  const shot = screenshotDesign(design, { nodeId: "g1", padding: 10, maxDimension: 4000 });

  assert.equal(shot.sourceWidth, 220);
  assert.equal(shot.sourceHeight, 140);
  assert.equal(shot.width, 220);
  assert.equal(shot.height, 140);
});

test("the cropped SVG holds only the captured subtree, placed in document space", () => {
  const svg = subtreeToSvg(
    { name: design.name, width: design.width, height: design.height, background: design.background, nodes: design.nodes as any },
    "g1",
    0
  );

  assert.match(svg, /viewBox="100 50 200 120"/);
  assert.match(svg, /translate\(100 50\)/);
  assert.match(svg, />Bonjour</);
  // Le rectangle rouge vit hors du groupe : il ne doit pas entrer dans le cadre.
  assert.doesNotMatch(svg, /#ff0000/);
});

test("a single node can be captured, including one nested in a group", () => {
  const shot = screenshotDesign(design, { nodeId: "r1", padding: 0, maxDimension: 4000 });

  assert.equal(shot.sourceWidth, 200);
  assert.equal(shot.sourceHeight, 120);
});

test("the output is downscaled so its longest side stays under the cap", () => {
  const shot = screenshotDesign(design, { scale: 4, maxDimension: 400 });

  assert.equal(Math.max(shot.width, shot.height), 400);
  assert.equal(shot.scale, 0.5);
});

test("capturing an unknown node fails loudly", () => {
  assert.throws(() => screenshotDesign(design, { nodeId: "nope" }), /not found/);
});

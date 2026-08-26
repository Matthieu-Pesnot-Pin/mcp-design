import assert from "node:assert/strict";
import test from "node:test";
import { exportDesign, toSummary } from "../src/core/export.js";
import { buildNode } from "../src/core/node-factory.js";
import { documentToSvg, measuredTextHeight, normalizedBox } from "../shared/render.js";
import type { Design, DesignNode } from "../shared/schemas/design.schema.js";

function makeDesign(nodes: DesignNode[]): Design {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "demo",
    name: "Demo Design",
    group: null,
    width: 800,
    height: 600,
    background: "#fafaf8",
    nodes,
    createdAt: now,
    updatedAt: now,
    revision: 3,
    lastEditor: "user",
    baseline: { revision: 0, at: now, nodes: [] },
  };
}

const rect = buildNode({ type: "rect", id: "r1", name: "Carte", x: 20, y: 30, width: 200, height: 100, radius: 12, fill: "#ffffff", stroke: "#111111", strokeWidth: 2 }, new Set(), 1);
const title = buildNode({ type: "text", id: "t1", name: "Titre", x: 40, y: 200, width: 400, text: "Bonjour\nmonde", fontSize: 32, color: "#111111" }, new Set(), 2);
const line = buildNode({ type: "line", id: "l1", name: "Trait", x: 40, y: 400, width: 300, height: 0, stroke: "#111111", strokeWidth: 3 }, new Set(), 3);
const ellipse = buildNode({ type: "ellipse", id: "e1", name: "Pastille", x: 500, y: 100, width: 120, height: 120, fill: "#ff5533" }, new Set(), 4);

test("svg export contains the canvas, the background and every node", () => {
  const svg = exportDesign(makeDesign([rect, ellipse, line, title]), "svg");

  assert.match(svg, /<svg [^>]*width="800" height="600"/);
  assert.match(svg, /<rect x="0" y="0" width="800" height="600" fill="#fafaf8"/);
  assert.match(svg, /<rect x="20" y="30" width="200" height="100" rx="12"/);
  assert.match(svg, /<ellipse cx="560" cy="160" rx="60" ry="60"/);
  assert.match(svg, /<line x1="40" y1="400" x2="340" y2="400"/);
  assert.match(svg, /<text /);
});

test("multi-line text becomes one tspan per line", () => {
  const svg = exportDesign(makeDesign([title]), "svg");
  const tspans = svg.match(/<tspan /g) ?? [];
  assert.equal(tspans.length, 2);
  assert.match(svg, />Bonjour</);
  assert.match(svg, />monde</);
});

test("text is escaped rather than injected into the svg", () => {
  const hostile = buildNode({ type: "text", id: "x", text: '<script>alert("x")</script>' }, new Set(), 1);
  const svg = exportDesign(makeDesign([hostile]), "svg");
  assert.ok(!svg.includes("<script>"), "raw markup must not reach the output");
  assert.match(svg, /&lt;script&gt;/);
});

test("html export produces one absolutely positioned div per node", () => {
  const html = exportDesign(makeDesign([rect, title]), "html");

  assert.match(html, /<!doctype html>/);
  assert.match(html, /position: relative; width: 800px; height: 600px/);
  assert.match(html, /position: absolute;/);
  assert.match(html, /border-radius: 12px;/);
  assert.match(html, /border: 2px solid #111111;/);
  assert.match(html, /font-size: 32px;/);
  assert.match(html, /Bonjour/);
});

test("html export renders an ellipse as a fully rounded box", () => {
  const html = exportDesign(makeDesign([ellipse]), "html");
  assert.match(html, /border-radius: 50%;/);
});

test("html export renders a line as a rotated bar anchored on its start point", () => {
  const diagonal = buildNode({ type: "line", id: "d", x: 0, y: 0, width: 100, height: 100, strokeWidth: 2 }, new Set(), 1);
  const html = exportDesign(makeDesign([diagonal]), "html");

  assert.match(html, /width: 141\.42px;/);
  assert.match(html, /transform: rotate\(45deg\);/);
  assert.match(html, /transform-origin: 0 50%;/);
  assert.match(html, /top: -1px;/, "the bar is centred on the geometric line");
});

test("jsx export yields a compilable-looking React component", () => {
  const jsx = exportDesign(makeDesign([rect, title]), "jsx");

  assert.match(jsx, /^export function DemoDesign\(\) \{/m);
  assert.match(jsx, /position: "absolute"/);
  assert.match(jsx, /borderRadius: "12px"/);
  assert.match(jsx, /\{\/\* Carte \*\/\}/);
  assert.match(jsx, /"Bonjour\\nmonde"/);
});

test("jsx export falls back to a valid identifier when the name has none", () => {
  const design = { ...makeDesign([]), name: "1234" };
  assert.match(exportDesign(design, "jsx"), /^export function Design\(\) \{/m);
});

test("json export exposes the raw nodes and no internal bookkeeping", () => {
  const parsed = JSON.parse(exportDesign(makeDesign([rect]), "json"));
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].id, "r1");
  assert.equal(parsed.baseline, undefined);
});

test("summary lists every node with its geometry", () => {
  const summary = toSummary(makeDesign([rect, title, line]));
  assert.match(summary, /# Demo Design \(demo\)/);
  assert.match(summary, /r1 rect "Carte" @ 20,30 200x100/);
  assert.match(summary, /t1 text "Titre" @ 40,200/);
  assert.match(summary, /l1 line "Trait" @ 40,400 300x0/);
});

test("normalizedBox flips a negative-sized box", () => {
  const box = normalizedBox({ ...rect, x: 100, y: 100, width: -60, height: -40 });
  assert.deepEqual(box, { x: 40, y: 60, width: 60, height: 40 });
});

test("measuredTextHeight grows with the number of lines", () => {
  const single = measuredTextHeight({ ...title, text: "une ligne" });
  const double = measuredTextHeight({ ...title, text: "deux\nlignes" });
  assert.ok(double > single);
});

test("documentToSvg is stable for an empty design", () => {
  const svg = documentToSvg({ name: "Vide", width: 100, height: 50, background: "#fff", nodes: [] });
  assert.match(svg, /<svg[^>]*viewBox="0 0 100 50"/);
  assert.equal((svg.match(/<rect/g) ?? []).length, 1, "only the background rect");
});

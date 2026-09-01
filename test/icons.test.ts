import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch, buildNode } from "../src/core/node-factory.js";
import { exportDesign, toSummary } from "../src/core/export.js";
import { screenshotDesign } from "../src/core/screenshot.js";
import { searchIconsTool } from "../src/tools/search-icons.js";
import { hasIcon, iconCount, CORE_ICONS } from "../shared/icons/index.js";
import { searchIcons, suggestIcons } from "../shared/icons/search.js";
import { nodeToSvg, type RenderNode } from "../shared/render.js";
import type { Design, DesignNode } from "../shared/schemas/design.schema.js";
import { makeStore } from "./helpers.js";

/** Texte de la première partie d'un résultat d'outil, quel que soit le reste. */
function firstText(result: { content: Array<{ type: string }> }): string {
  return (result.content[0] as { text?: string }).text ?? "";
}

function designWith(nodes: DesignNode[]): Design {
  const { store, cleanup } = makeStore();
  try {
    const design = store.create({ name: "Icônes", width: 400, height: 200 });
    return store.mutate(design.id, "agent", (draft) => {
      draft.nodes.push(...nodes);
    });
  } finally {
    cleanup();
  }
}

test("every curated icon name exists in the bundled library", () => {
  const missing = CORE_ICONS.filter((name) => !hasIcon(name));
  assert.deepEqual(missing, [], "the list shown to the agent must never name an icon that cannot be drawn");
  assert.ok(iconCount() > 1000);
});

test("an icon node stores the name, never the path data", () => {
  const node = buildNode({ type: "icon", icon: "shopping-cart", x: 10, y: 20 }, new Set(), 1);
  assert.equal(node.icon, "shopping-cart");
  assert.equal(node.width, 24);
  assert.equal(node.height, 24);
  // Ce que l'agent relira plus tard : un nom qui dit ce que la forme represente.
  assert.deepEqual(Object.keys(node).filter((key) => key === "d" || key === "path"), []);
});

test("the layer name defaults to the icon name", () => {
  assert.equal(buildNode({ type: "icon", icon: "bell" }, new Set(), 7).name, "bell");
  assert.equal(buildNode({ type: "icon", icon: "bell", name: "Alerte" }, new Set(), 7).name, "Alerte");
});

test("an icon node is square whatever box is asked for", () => {
  const node = buildNode({ type: "icon", icon: "star", width: 120, height: 40 }, new Set(), 1);
  assert.equal(node.width, 40);
  assert.equal(node.height, 40);
});

test("an unknown icon name is rejected with close matches", () => {
  assert.throws(() => buildNode({ type: "icon", icon: "home" }, new Set(), 1), (error: Error) => {
    assert.match(error.message, /Unknown icon "home"/);
    assert.match(error.message, /house/, "a renamed icon must come back as a suggestion");
    return true;
  });
});

test("an icon node without a name explains what to do", () => {
  assert.throws(() => buildNode({ type: "icon" }, new Set(), 1), /needs an "icon" field/);
});

test("patching an icon revalidates the name", () => {
  const node = buildNode({ type: "icon", icon: "star" }, new Set(), 1);
  assert.equal(applyPatch(node, { icon: "bell" }).icon, "bell");
  assert.throws(() => applyPatch(node, { icon: "not-an-icon" }), /Unknown icon/);
});

test("the SVG scales the drawing uniformly and centres it in its box", () => {
  const node = buildNode({ type: "icon", icon: "check", x: 10, y: 20, width: 48, height: 48 }, new Set(), 1);
  const svg = nodeToSvg(node as unknown as RenderNode);
  assert.match(svg, /translate\(10 20\) scale\(2\)/);
  // L'epaisseur reste exprimee dans la grille de 24 : c'est l'echelle qui la
  // fait grossir, sinon un trait de 2px se perdrait sur une icone de 96.
  assert.match(svg, /stroke-width="2"/);
  assert.match(svg, /stroke="#1a1a18"/);
});

test("an unknown icon renders a placeholder instead of throwing", () => {
  // Un design ouvert apres un renommage de la bibliotheque doit rester ouvrable :
  // le meme SVG sert au canvas, a l'export et a la capture.
  const node = { ...buildNode({ type: "icon", icon: "star" }, new Set(), 1), icon: "gone" };
  const svg = nodeToSvg(node as unknown as RenderNode);
  assert.match(svg, /stroke-dasharray/);
});

test("the summary shows the icon name, which is what makes it readable", () => {
  const node = buildNode({ type: "icon", icon: "shopping-cart", x: 8, y: 8 }, new Set(), 1);
  const summary = toSummary(designWith([node]));
  assert.match(summary, /icon "shopping-cart" @ 8,8 24x24 — shopping-cart/);
});

test("HTML and JSX exports inline the icon, with no runtime dependency", () => {
  const design = designWith([buildNode({ type: "icon", icon: "circle-check" }, new Set(), 1)]);

  const html = exportDesign(design, "html");
  assert.match(html, /<svg viewBox="0 0 24 24"/);
  assert.match(html, /stroke-linecap="round"/);

  const jsx = exportDesign(design, "jsx");
  assert.match(jsx, /strokeLinecap="round"/, "JSX needs camelCase attributes to compile");
  assert.doesNotMatch(jsx, /stroke-width=/);
});

test("an icon is rasterised like any other node", () => {
  const design = designWith([buildNode({ type: "icon", icon: "star", width: 64, height: 64 }, new Set(), 1)]);
  const shot = screenshotDesign(design);
  assert.ok(shot.png.length > 0);
});

test("search finds an icon from a description, best match first", () => {
  assert.equal(searchIcons("shopping cart", 5)[0].name, "shopping-cart");
  assert.equal(searchIcons("home", 5)[0].name, "house");
  // Le rang du synonyme compte : "close" est le premier synonyme de "x", et
  // seulement un morceau du nom de "panel-top-close".
  assert.equal(searchIcons("close", 5)[0].name, "x");
  assert.deepEqual(searchIcons("", 5), []);
});

test("suggestions are empty for a name that exists", () => {
  assert.deepEqual(suggestIcons("star"), []);
  assert.ok(suggestIcons("trolley").includes("shopping-cart"));
});

test("search_icons returns names and a preview sheet", () => {
  const result = searchIconsTool({ query: "cart", limit: 6 });
  assert.match(firstText(result), /shopping-cart/);
  assert.equal(result.content[1]?.type, "image");

  const withoutPreview = searchIconsTool({ query: "cart", preview: false });
  assert.equal(withoutPreview.content.length, 1);
});

test("search_icons explains itself when nothing matches", () => {
  const result = searchIconsTool({ query: "zzzzqqq" });
  assert.match(firstText(result), /No icon matches/);
  assert.equal(result.content.length, 1);
});

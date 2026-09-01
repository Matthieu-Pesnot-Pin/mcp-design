import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { addNodes } from "../src/tools/add-nodes.js";
import { groupNodes } from "../src/tools/group-nodes.js";
import { updateNodes } from "../src/tools/update-nodes.js";
import { deleteNodes } from "../src/tools/delete-nodes.js";
import { ungroupNodes } from "../src/tools/ungroup-nodes.js";
import { detachInstances } from "../src/tools/detach-instances.js";
import { getChanges } from "../src/tools/get-changes.js";
import { markSynced } from "../src/tools/mark-synced.js";
import { exportDesign } from "../src/core/export.js";
import { screenshotDesign } from "../src/core/screenshot.js";
import { expandInstances, instanceRootOf, isExpandedId } from "../shared/instances.js";
import { boundsOf, computeLayout } from "../shared/tree.js";
import type { RenderNode } from "../shared/render.js";
import type { Design } from "../shared/schemas/design.schema.js";

/** Une carte groupee, prete a etre instanciee. */
function makeComponent(store: ReturnType<typeof makeStore>["store"]): Design {
  const design = store.create({ name: "Cartes" });
  addNodes(store, {
    design_id: design.id,
    nodes: [
      // Une couleur qui n'est pas celle du fond de planche : elle se compte dans le SVG.
      { type: "rect", id: "bg", name: "Fond", x: 0, y: 0, width: 200, height: 120, fill: "#123456" },
      { type: "text", id: "title", name: "Titre", x: 12, y: 12, width: 176, height: 40, text: "Carte" },
    ],
  });
  return groupNodes(store, { design_id: design.id, node_ids: ["bg", "title"], group_id: "card", name: "Carte" })
    .design!;
}

function addInstance(store: ReturnType<typeof makeStore>["store"], designId: string, id: string, x: number): Design {
  return addNodes(store, {
    design_id: designId,
    nodes: [{ type: "instance", id, name: `Carte ${id}`, componentId: "card", x, y: 0 }],
  }).design!;
}

test("an instance is a single stored node but renders the whole component", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = addInstance(store, makeComponent(store).id, "i1", 300);

  // Trois noeuds pour le composant, un seul de plus pour l'instance.
  assert.equal(design.nodes.length, 4);
  assert.equal(design.nodes.find((node) => node.id === "i1")!.type, "instance");

  const expanded = expandInstances(design.nodes as unknown as RenderNode[]);
  assert.equal(expanded.length, 6);
  assert.equal(expanded.filter((node) => node.type === "instance").length, 0);
  assert.ok(expanded.some((node) => node.id === "i1~bg" && node.parentId === "i1"));
  assert.equal(instanceRootOf("i1~bg"), "i1");
  assert.ok(isExpandedId("i1~bg") && !isExpandedId("i1"));
});

test("editing the component updates every instance at once", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addInstance(store, id, "i1", 300);
  const design = addInstance(store, id, "i2", 600);
  const before = exportDesign(design, "svg");
  assert.equal(before.split("#123456").length - 1, 3); // le composant et ses deux instances

  markSynced(store, { design_id: id });
  const updated = updateNodes(store, { design_id: id, updates: [{ id: "bg", fill: "#ff0000" }] }).design!;
  const after = exportDesign(updated, "svg");
  assert.equal(after.split("#ff0000").length - 1, 3);
  assert.ok(!after.includes("#123456"));

  // Une seule retouche a lire cote agent, pas une par copie.
  const changes = getChanges(store, { design_id: id }).content[0].text;
  assert.equal(changes.split("\n").filter((line) => line.includes("fill")).length, 1);
});

test("an instance takes the size of its component", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = addInstance(store, makeComponent(store).id, "i1", 300);
  const instance = design.nodes.find((node) => node.id === "i1")!;
  assert.equal(instance.width, 200);
  assert.equal(instance.height, 120);

  const layout = computeLayout(expandInstances(design.nodes as unknown as RenderNode[]));
  assert.deepEqual(boundsOf(layout, "i1"), { x: 300, y: 0, width: 200, height: 120 });
});

test("the summary lists an instance as one line, not as a copy of the component", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = addInstance(store, makeComponent(store).id, "i1", 300);
  const summary = exportDesign(design, "summary");
  assert.match(summary, /i1 instance "Carte i1" @ 300,0 200x120 — mirrors group card "Carte"/);
  assert.equal(summary.split("Titre").length - 1, 1);
});

test("the HTML export materialises the content of each instance", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = addInstance(store, makeComponent(store).id, "i1", 300);
  const html = exportDesign(design, "html");
  assert.equal(html.split("Carte</div>").length - 1, 2);
});

test("a screenshot renders instances", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = addInstance(store, makeComponent(store).id, "i1", 300);
  // La capture cadree sur l'instance sait la mesurer : elle a bien le format du composant.
  const shot = screenshotDesign(design, { nodeId: "i1" });
  assert.ok(shot.png.length > 0);
  assert.equal(shot.sourceWidth, 200);
  assert.equal(shot.sourceHeight, 120);
});

test("nested instances are expanded recursively", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addNodes(store, {
    design_id: id,
    nodes: [
      { type: "rect", id: "row-bg", name: "Fond ligne", x: 0, y: 300, width: 400, height: 140 },
      { type: "instance", id: "row-card", name: "Carte de la ligne", componentId: "card", x: 10, y: 310 },
    ],
  });
  groupNodes(store, { design_id: id, node_ids: ["row-bg", "row-card"], group_id: "row", name: "Ligne" });
  const withRow = addNodes(store, {
    design_id: id,
    nodes: [{ type: "instance", id: "i-row", name: "Ligne 2", componentId: "row", x: 0, y: 500 }],
  }).design!;

  const expanded = expandInstances(withRow.nodes as unknown as RenderNode[]);
  // L'instance de ligne porte l'instance de carte, elle-meme expansee.
  assert.ok(expanded.some((node) => node.id === "i-row~row-card~title"));
  assert.equal(expanded.filter((node) => node.type === "instance").length, 0);
});

test("an invalid or recursive component is refused", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;

  assert.throws(
    () => addNodes(store, { design_id: id, nodes: [{ type: "instance", name: "Sans lien" }] }),
    /needs a "componentId"/
  );
  assert.throws(
    () => addNodes(store, { design_id: id, nodes: [{ type: "instance", componentId: "nope" }] }),
    /does not exist/
  );
  assert.throws(
    () => addNodes(store, { design_id: id, nodes: [{ type: "instance", componentId: "bg" }] }),
    /Only a group can be instantiated/
  );
  // Une instance de la carte, posee DANS la carte : l'expansion boucherait.
  assert.throws(
    () => addNodes(store, { design_id: id, nodes: [{ type: "instance", componentId: "card", parentId: "card" }] }),
    /contain itself/
  );

  addInstance(store, id, "i1", 300);
  assert.throws(
    () => addNodes(store, { design_id: id, nodes: [{ type: "rect", parentId: "i1" }] }),
    /content of an instance belongs to its component/
  );
});

test("a component still in use cannot be deleted nor ungrouped", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addInstance(store, id, "i1", 300);

  assert.throws(() => deleteNodes(store, { design_id: id, node_ids: ["card"] }), /still mirrored by 1 instance/);
  assert.throws(() => ungroupNodes(store, { design_id: id, group_ids: ["card"] }), /still mirrored by 1 instance/);

  // Les deux ensemble, en revanche, sont coherents.
  const design = deleteNodes(store, { design_id: id, node_ids: ["card", "i1"] }).design!;
  assert.equal(design.nodes.length, 0);
});

test("detaching materialises the content and stops the propagation", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addInstance(store, id, "i1", 300);
  addInstance(store, id, "i2", 600);

  const detached = detachInstances(store, { design_id: id, node_ids: ["i1"] }).design!;
  const instance = detached.nodes.find((node) => node.id === "i1")!;
  assert.equal(instance.type, "group");
  assert.equal(instance.componentId, undefined);
  assert.equal(detached.nodes.filter((node) => node.parentId === "i1").length, 2);

  const updated = updateNodes(store, { design_id: id, updates: [{ id: "title", text: "Modifie" }] }).design!;
  const svg = exportDesign(updated, "svg");
  // Le composant et l'instance restante suivent ; la copie detachee, non.
  assert.equal(svg.split("Modifie").length - 1, 2);
  assert.equal(svg.split(">Carte<").length - 1, 1);
});

test("a nested instance stays an instance when its container is detached", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addNodes(store, {
    design_id: id,
    nodes: [{ type: "instance", id: "row-card", name: "Carte de la ligne", componentId: "card", x: 10, y: 310 }],
  });
  groupNodes(store, { design_id: id, node_ids: ["row-card"], group_id: "row", name: "Ligne" });
  addNodes(store, {
    design_id: id,
    nodes: [{ type: "instance", id: "i-row", name: "Ligne 2", componentId: "row", x: 0, y: 500 }],
  });

  const detached = detachInstances(store, { design_id: id, node_ids: ["i-row"] }).design!;
  const copy = detached.nodes.find((node) => node.parentId === "i-row")!;
  assert.equal(copy.type, "instance");
  assert.equal(copy.componentId, "card");
});

test("an instance can be swapped over to another component", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addNodes(store, {
    design_id: id,
    nodes: [{ type: "ellipse", id: "dot", name: "Pastille", x: 0, y: 400, width: 40, height: 40 }],
  });
  groupNodes(store, { design_id: id, node_ids: ["dot"], group_id: "badge", name: "Pastille" });
  addInstance(store, id, "i1", 300);

  const swapped = updateNodes(store, { design_id: id, updates: [{ id: "i1", componentId: "badge" }] }).design!;
  assert.equal(swapped.nodes.find((node) => node.id === "i1")!.width, 40);
});

test("nothing but the link can be patched on an instance", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const id = makeComponent(store).id;
  addInstance(store, id, "i1", 300);

  assert.throws(() => updateNodes(store, { design_id: id, updates: [{ id: "i1", fill: "#000000" }] }), /cannot be set/);
  assert.throws(
    () => updateNodes(store, { design_id: id, updates: [{ id: "i1", width: 500 }] }),
    /size of a instance is derived/
  );
  // La position, elle, appartient bien a l'instance.
  const moved = updateNodes(store, { design_id: id, updates: [{ id: "i1", x: 700 }] }).design!;
  assert.equal(moved.nodes.find((node) => node.id === "i1")!.x, 700);
});

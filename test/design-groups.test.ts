import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { normalizeDesignGroup } from "../shared/schemas/design.schema.js";
import { groupDesigns } from "../src/tools/group-designs.js";
import { updateDesign } from "../src/tools/update-design.js";

test("normalizeDesignGroup trims segments and drops empty ones", () => {
  assert.equal(normalizeDesignGroup("  Marketing / Landing  "), "Marketing/Landing");
  assert.equal(normalizeDesignGroup("Marketing//Landing/"), "Marketing/Landing");
  assert.equal(normalizeDesignGroup("   "), null);
  assert.equal(normalizeDesignGroup(null), null);
  assert.equal(normalizeDesignGroup(undefined), null);
});

test("a design created without a group sits at the root", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  assert.equal(store.create({ name: "Accueil" }).group, null);
  assert.equal(store.create({ name: "Tarifs", group: " Marketing / Landing " }).group, "Marketing/Landing");
});

test("group_designs files several pages at once and can pull them back", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const first = store.create({ name: "Accueil" });
  const second = store.create({ name: "Tarifs" });

  groupDesigns(store, { design_ids: [first.id, second.id], group: "Marketing/Landing" });
  assert.equal(store.get(first.id).group, "Marketing/Landing");
  assert.equal(store.get(second.id).group, "Marketing/Landing");

  groupDesigns(store, { design_ids: [second.id], group: null });
  assert.equal(store.get(second.id).group, null);
});

test("group_designs refuses an unknown page before writing anything", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Accueil" });
  assert.throws(() => groupDesigns(store, { design_ids: [design.id, "ghost"], group: "Marketing" }), /not found/);
  assert.equal(store.get(design.id).group, null);
});

test("update_design moves a single page in and out of a group", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Accueil" });
  updateDesign(store, { design_id: design.id, group: "Marketing" });
  assert.equal(store.get(design.id).group, "Marketing");

  updateDesign(store, { design_id: design.id, group: null });
  assert.equal(store.get(design.id).group, null);
});

test("editing the nodes leaves the page group untouched", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Accueil", group: "Marketing" });
  const updated = store.mutate(design.id, "user", (draft) => {
    draft.name = "Accueil v2";
  });
  assert.equal(updated.group, "Marketing");
});

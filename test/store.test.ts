import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import path from "path";
import { makeStore } from "./helpers.js";
import { DesignStore } from "../src/core/design-store.js";
import { buildNode, applyPatch, DesignError } from "../src/core/node-factory.js";

test("create allocates a slug id derived from the name", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Landing Page" });
  assert.equal(design.id, "landing-page");
  assert.equal(design.width, 1440);
  assert.equal(design.height, 900);
  assert.equal(design.nodes.length, 0);
  assert.equal(design.revision, 0);
});

test("create suffixes the id when the slug is already taken", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  assert.equal(store.create({ name: "Écran d'accueil" }).id, "ecran-d-accueil");
  assert.equal(store.create({ name: "Ecran d accueil" }).id, "ecran-d-accueil-2");
});

test("create rejects an empty name and non-positive dimensions", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  assert.throws(() => store.create({ name: "  " }), DesignError);
  assert.throws(() => store.create({ name: "ok", width: 0 }), DesignError);
  assert.throws(() => store.create({ name: "ok", height: -10 }), DesignError);
});

test("designs survive a fresh store instance (persisted to disk)", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ name: "Persisted" });
  store.mutate(created.id, "agent", (draft) => {
    draft.nodes.push(buildNode({ type: "rect", x: 10, y: 20 }, new Set(), 1));
  });

  // Un store neuf a un cache vide : il relit forcément le disque.
  const reloaded = new DesignStore(dir).get(created.id);
  assert.equal(reloaded.nodes.length, 1);
  assert.equal(reloaded.nodes[0].x, 10);
  assert.equal(reloaded.revision, 1);
});

test("mutate bumps the revision and records the editor", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Rev" });
  const afterAgent = store.mutate(design.id, "agent", (draft) => {
    draft.nodes.push(buildNode({ type: "text", text: "Bonjour" }, new Set(), 1));
  });
  assert.equal(afterAgent.revision, 1);
  assert.equal(afterAgent.lastEditor, "agent");

  const afterUser = store.mutate(design.id, "user", (draft) => {
    draft.nodes[0].x = 50;
  });
  assert.equal(afterUser.revision, 2);
  assert.equal(afterUser.lastEditor, "user");
});

test("mutate leaves the stored design untouched when the callback throws", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Atomic" });
  assert.throws(() =>
    store.mutate(design.id, "agent", (draft) => {
      draft.nodes.push(buildNode({ type: "rect" }, new Set(), 1));
      throw new Error("boom");
    })
  );

  assert.equal(store.get(design.id).nodes.length, 0);
  assert.equal(store.get(design.id).revision, 0);
});

test("get reports a helpful error for an unknown design", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  assert.throws(() => store.get("nope"), /not found/);
});

test("get rejects a design file that no longer matches the schema", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Broken" });
  fs.writeFileSync(path.join(dir, "designs", `${design.id}.json`), JSON.stringify({ id: design.id }), "utf-8");

  const fresh = new DesignStore(dir);
  assert.throws(() => fresh.get(design.id), /does not match the expected schema/);
});

test("list skips unreadable design files instead of failing", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  store.create({ name: "Valide" });
  fs.writeFileSync(path.join(dir, "designs", "corrompu.json"), "{ not json", "utf-8");

  const listed = new DesignStore(dir).list();
  assert.deepEqual(
    listed.map((d) => d.id),
    ["valide"]
  );
});

test("delete removes the file and the design disappears from list", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Temporaire" });
  assert.equal(store.list().length, 1);
  store.delete(design.id);
  assert.equal(store.list().length, 0);
  assert.throws(() => store.delete(design.id), /not found/);
});

test("list reports the number of unsynced changes", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Pending" });
  assert.equal(store.list()[0].pendingChanges, 0);

  store.mutate(design.id, "user", (draft) => {
    draft.nodes.push(buildNode({ type: "rect" }, new Set(), 1));
  });
  assert.equal(store.list()[0].pendingChanges, 1);

  store.markSynced(design.id);
  assert.equal(store.list()[0].pendingChanges, 0);
});

test("markSynced copies the nodes rather than aliasing them", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const design = store.create({ name: "Baseline" });
  store.mutate(design.id, "agent", (draft) => {
    draft.nodes.push(buildNode({ type: "rect", id: "r1", x: 0 }, new Set(), 1));
  });
  store.markSynced(design.id);

  const moved = store.mutate(design.id, "user", (draft) => {
    draft.nodes[0].x = 300;
  });
  assert.equal(moved.baseline.nodes[0].x, 0, "the baseline must keep the pre-edit value");
  assert.equal(moved.nodes[0].x, 300);
});

test("applyPatch refuses a field that does not belong to the node type", () => {
  const rect = buildNode({ type: "rect" }, new Set(), 1);
  assert.throws(() => applyPatch(rect, { fontSize: 40 }), /cannot be set on a "rect" node/);
});

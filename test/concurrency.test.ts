import assert from "node:assert/strict";
import test from "node:test";
import { makeStore } from "./helpers.js";
import { DesignStore } from "../src/core/design-store.js";
import { buildNode, DesignError } from "../src/core/node-factory.js";

/** buildNode attend (input, idsExistants, index) — un helper garde les tests lisibles. */
const rect = (id: string) => buildNode({ type: "rect", id }, new Set<string>(), 0);

/**
 * Deux GUI ouvertes = deux processus serveur, donc deux DesignStore sur le même
 * dataDir, chacun avec son cache. C'est la configuration qui a détruit 72 noeuds
 * en production : le store parti d'un état périmé réécrivait le fichier entier.
 */
function twoStores(dir: string): [DesignStore, DesignStore] {
  return [new DesignStore(dir), new DesignStore(dir)];
}

test("a store re-reads a design written by another process", (t) => {
  const { dir, cleanup } = makeStore();
  t.after(cleanup);

  const [a, b] = twoStores(dir);
  const created = a.create({ name: "Shared" });

  // A met le design en cache, puis B lui ajoute des noeuds.
  assert.equal(a.get(created.id).nodes.length, 0);
  b.mutate(created.id, "agent", (draft) => {
    draft.nodes.push(rect("r1"));
    draft.nodes.push(rect("r2"));
  });

  // Avant correctif : A servait son cache vide.
  assert.equal(a.get(created.id).nodes.length, 2, "A doit voir les noeuds écrits par B");
  assert.equal(a.get(created.id).revision, 1);
});

test("a stale store does not clobber another process's nodes", (t) => {
  const { dir, cleanup } = makeStore();
  t.after(cleanup);

  const [a, b] = twoStores(dir);
  const created = a.create({ name: "Shared" });

  a.get(created.id); // A met en cache l'état vide.
  b.mutate(created.id, "agent", (draft) => {
    draft.nodes.push(rect("kept"));
  });

  // A édite en aveugle : sa mutation doit se greffer sur l'état courant,
  // pas remplacer le document par sa copie périmée.
  a.mutate(created.id, "user", (draft) => {
    draft.name = "Renamed by A";
  });

  const onDisk = new DesignStore(dir).get(created.id);
  assert.equal(onDisk.name, "Renamed by A");
  assert.deepEqual(
    onDisk.nodes.map((n) => n.id),
    ["kept"],
    "le noeud écrit par B doit survivre à l'écriture de A"
  );
  assert.equal(onDisk.revision, 2, "les révisions doivent avancer, jamais reculer");
});

test("baseRevision refuses a write based on an outdated design", (t) => {
  const { dir, cleanup } = makeStore();
  t.after(cleanup);

  const [a, b] = twoStores(dir);
  const created = a.create({ name: "Shared" });

  const loaded = a.get(created.id); // révision 0, ce que la GUI a à l'écran
  b.mutate(created.id, "agent", (draft) => {
    draft.nodes.push(rect("from-b"));
  });

  // Sauvegarde intégrale façon GUI : elle remplace `nodes` en bloc.
  assert.throws(
    () =>
      a.mutate(
        created.id,
        "user",
        (draft) => {
          draft.nodes = [];
        },
        { baseRevision: loaded.revision }
      ),
    (err: unknown) => err instanceof DesignError && /revision/i.test((err as Error).message),
    "une sauvegarde basée sur une révision périmée doit être refusée"
  );

  const onDisk = new DesignStore(dir).get(created.id);
  assert.deepEqual(onDisk.nodes.map((n) => n.id), ["from-b"], "le refus ne doit rien avoir écrit");
});

test("baseRevision accepts a write based on the current revision", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ name: "Shared" });
  const updated = store.mutate(
    created.id,
    "user",
    (draft) => {
      draft.nodes = [rect("ok")];
    },
    { baseRevision: created.revision }
  );

  assert.equal(updated.revision, 1);
  assert.deepEqual(new DesignStore(dir).get(created.id).nodes.map((n) => n.id), ["ok"]);
});

test("markSynced sees the freshest nodes, not a cached copy", (t) => {
  const { dir, cleanup } = makeStore();
  t.after(cleanup);

  const [a, b] = twoStores(dir);
  const created = a.create({ name: "Shared" });

  a.get(created.id);
  b.mutate(created.id, "agent", (draft) => {
    draft.nodes.push(rect("r1"));
  });

  const synced = a.markSynced(created.id);
  assert.equal(synced.baseline.nodes.length, 1, "la baseline doit figer l'état réel du disque");
  assert.equal(synced.baseline.revision, 1);
});

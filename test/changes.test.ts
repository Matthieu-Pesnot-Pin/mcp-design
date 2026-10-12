import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Route `/api/changes` du GUI worker : le test tient le rôle du master, pousse
 * des évènements par IPC et relit le journal comme le fait la GUI.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = path.resolve(__dirname, "../src/gui-worker.js");

let worker: ChildProcess;
let baseUrl: string;
let dataDir: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: allocated } = server.address() as net.AddressInfo;
      server.close(() => resolve(allocated));
    });
  });
}

async function changes(query = ""): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/changes${query}`, { signal: AbortSignal.timeout(3000) });
  return { status: response.status, body: await response.json() };
}

/** Pousse un évènement comme le ferait le master, puis attend que le worker l'ait journalisé. */
async function push(event: Record<string, unknown>, expectedSeq: number) {
  worker.send({ ...event, timestamp: new Date().toISOString() });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await changes()).body.seq >= expectedSeq) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the worker never journaled event #${expectedSeq}`);
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-changes-"));
  const env: NodeJS.ProcessEnv = { ...process.env, APP_PORT: String(port), MCP_LOG_DIR: path.join(dataDir, "logs") };
  delete env.PROXY_URL;
  worker = fork(WORKER_ENTRY, [], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GUI worker did not report READY")), 15000);
    worker.on("message", (message: any) => {
      if (message?.type === "READY") {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`GUI worker exited early (code ${code})`));
    });
  });
});

after(() => {
  worker?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("le premier appel, sans position, demande un rechargement complet", async () => {
  const { status, body } = await changes();
  assert.equal(status, 200);
  assert.equal(body.reset, true);
  assert.equal(typeof body.epoch, "string");
  assert.equal(body.seq, 0);
  assert.equal(body.events, undefined);
});

test("les évènements poussés par le master sont restitués depuis la position du client", async () => {
  const { body: start } = await changes();

  await push({ type: "DESIGN_UPDATED", data: { designId: "board" } }, start.seq + 1);
  await push({ type: "REMARKS_UPDATED", data: {} }, start.seq + 2);

  const { status, body } = await changes(`?since=${start.seq}&epoch=${start.epoch}`);
  assert.equal(status, 200);
  assert.equal(body.reset, false);
  assert.equal(body.epoch, start.epoch);
  assert.equal(body.seq, start.seq + 2);
  assert.deepEqual(
    body.events.map((event: { type: string }) => event.type),
    ["DESIGN_UPDATED", "REMARKS_UPDATED"]
  );
  assert.deepEqual(body.events[0].data, { designId: "board" });

  const { body: upToDate } = await changes(`?since=${body.seq}&epoch=${body.epoch}`);
  assert.equal(upToDate.reset, false);
  assert.deepEqual(upToDate.events, []);
});

test("un message IPC qui n'est pas un évènement poussé n'entre pas dans le journal", async () => {
  const { body: start } = await changes();
  worker.send({ type: "LIST_DESIGNS_RESPONSE", data: {}, timestamp: new Date().toISOString() });
  await push({ type: "DESIGNS_UPDATED", data: {} }, start.seq + 1);

  const { body } = await changes(`?since=${start.seq}&epoch=${start.epoch}`);
  assert.deepEqual(
    body.events.map((event: { type: string }) => event.type),
    ["DESIGNS_UPDATED"]
  );
});

test("un epoch d'un autre démarrage du worker demande un rechargement complet", async () => {
  const { body } = await changes("?since=0&epoch=un-autre-demarrage");
  assert.equal(body.reset, true);
  assert.notEqual(body.epoch, "un-autre-demarrage");
});

test("une position en avance sur le journal demande un rechargement complet", async () => {
  const { body: start } = await changes();
  const { body } = await changes(`?since=${start.seq + 10}&epoch=${start.epoch}`);
  assert.equal(body.reset, true);
  assert.equal(body.seq, start.seq);
});

test("une position antérieure aux entrées conservées demande un rechargement complet", async () => {
  const { body: start } = await changes();
  for (let index = 1; index <= 201; index++) {
    worker.send({ type: "DESIGNS_UPDATED", data: {}, timestamp: new Date().toISOString() });
  }
  await push({ type: "DESIGNS_UPDATED", data: {} }, start.seq + 202);

  const { body: dropped } = await changes(`?since=${start.seq}&epoch=${start.epoch}`);
  assert.equal(dropped.reset, true);

  const { body: kept } = await changes(`?since=${start.seq + 2}&epoch=${start.epoch}`);
  assert.equal(kept.reset, false);
  assert.equal(kept.events.length, 200);
});

test("un since invalide est refusé avec un message explicite", async () => {
  const { body: start } = await changes();
  for (const since of ["abc", "-1", "1.5", ""]) {
    const { status, body } = await changes(`?since=${encodeURIComponent(since)}&epoch=${start.epoch}`);
    assert.equal(status, 400, `since="${since}"`);
    assert.match(body.error, /Invalid "since" parameter/);
  }
});

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exposition réseau du GUI worker : écoute sur 127.0.0.1 uniquement, refus
 * d'un Host étranger et des modifications cross-site, acceptation des
 * requêtes relayées par le proxy (Host réécrit en localhost, Origin du proxy).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = path.resolve(__dirname, "../src/gui-worker.js");

let worker: ChildProcess;
let port: number;
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

interface RawResponse {
  status: number;
  body: string;
}

/** Requête HTTP brute : `fetch` ne permet pas de fixer l'en-tête Host. */
function request(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  address?: string;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: options.address ?? "127.0.0.1",
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function externalIPv4(): string | undefined {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

before(async () => {
  port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-network-"));
  const env: NodeJS.ProcessEnv = { ...process.env, APP_PORT: String(port), MCP_LOG_DIR: path.join(dataDir, "logs") };
  delete env.PROXY_URL;
  worker = fork(WORKER_ENTRY, [], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });

  // Le test tient le rôle du master pour la seule requête IPC que la suite déclenche.
  worker.on("message", (message: any) => {
    if (message?.type === "SUBMIT_FEEDBACK") {
      worker.send({
        type: "SUBMIT_FEEDBACK_RESPONSE",
        correlationId: message.correlationId,
        data: { ok: true },
        timestamp: new Date().toISOString(),
      });
    }
  });

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

const feedback = JSON.stringify({ remarkIds: [], title: "network-exposure-test" });

test("un Host étranger est refusé", async () => {
  const response = await request({ method: "GET", path: "/proxy/health", headers: { Host: "attacker.example" } });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(response.body).error, /is not allowed/);
});

test("une modification cross-site signalée par Sec-Fetch-Site est refusée", async () => {
  const response = await request({
    method: "POST",
    path: "/api/feedback",
    headers: { Host: `localhost:${port}`, "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    body: feedback,
  });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(response.body).error, /Cross-site request refused/);
});

test("une modification depuis une Origin étrangère est refusée", async () => {
  const response = await request({
    method: "POST",
    path: "/api/feedback",
    headers: { Host: `localhost:${port}`, Origin: "http://attacker.example", "Content-Type": "application/json" },
    body: feedback,
  });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(response.body).error, /Cross-site request refused/);
});

test("une modification relayée par le proxy est acceptée", async () => {
  const response = await request({
    method: "POST",
    path: "/api/feedback",
    headers: {
      Host: `localhost:${port}`,
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: feedback,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("le serveur n'est pas joignable sur l'IPv4 externe de la machine", async (t) => {
  const address = externalIPv4();
  if (!address) {
    t.skip("aucune interface IPv4 externe");
    return;
  }
  await assert.rejects(request({ method: "GET", path: "/proxy/health", address }));
});

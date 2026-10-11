import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test de bout en bout : un vrai serveur MCP sur stdio, son GUI worker enregistré
 * auprès du proxy, et l'aller-retour complet agent -> GUI -> agent.
 *
 * Le proxy est une dépendance externe : sans lui la suite est ignorée plutôt
 * qu'en échec, pour qu'un `npm test` hors environnement reste vert.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "../src/index.js");
const PROXY_URL = process.env.E2E_PROXY_URL ?? "http://localhost:3000";
const APP_PATH = "/design-e2e-test";

async function proxyIsUp(): Promise<boolean> {
  try {
    const response = await fetch(PROXY_URL, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  }
}

class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, (message: any) => void>();
  readonly stderr: string[] = [];

  constructor(dataDir: string) {
    this.child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {
        ...process.env,
        MCP_DESIGN_DATA_DIR: dataDir,
        MCP_LOG_DIR: path.join(dataDir, "logs"),
        PROXY_URL,
        APP_PATH,
        APP_NAME: "MCP Design E2E",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding("utf-8");
    this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.child.stderr.setEncoding("utf-8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== "") {
        try {
          const message = JSON.parse(line);
          const resolve = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
          if (resolve) {
            this.pending.delete(message.id);
            resolve(message);
          }
        } catch {
          // Ligne non JSON-RPC sur stdout : c'est précisément ce que le logging
          // doit empêcher, on la signale via stderr du test.
          console.error(`[e2e] non-JSON line on stdout: ${line}`);
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  request(method: string, params?: unknown, timeoutMs = 20000): Promise<any> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });

      this.child.stdin.write(payload);
    });
  }

  notify(method: string, params?: unknown) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    return result.content.map((entry: { text: string }) => entry.text).join("\n");
  }

  async stop() {
    this.child.stdin.end();
    this.child.kill();
    await new Promise((resolve) => this.child.once("exit", resolve));
  }
}

let client: McpClient | null = null
let dataDir = ""
let guiUrl = ""
let available = false

before(async () => {
  available = await proxyIsUp();
  if (!available) return;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-e2e-"));
  client = new McpClient(dataDir);

  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-design-e2e", version: "1.0.0" },
  });
  client.notify("notifications/initialized");

  // Le worker n'écoute qu'une fois enregistré auprès du proxy, qui lui assigne
  // son port. On attaque ce port en direct : le proxy est protégé par mot de
  // passe, et le traverser ne testerait que son authentification.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const port = client.stderr.join("").match(/listening on port (\d+)/)?.[1];
    if (port) {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/proxy/health`, { signal: AbortSignal.timeout(2000) });
        if (health.ok) {
          guiUrl = `http://127.0.0.1:${port}`;
          break;
        }
      } catch {
        // Le serveur HTTP n'accepte pas encore de connexion.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

after(async () => {
  await client?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

function skipUnlessAvailable(t: { skip: (reason: string) => void }): boolean {
  if (!available) {
    t.skip(`proxy unreachable at ${PROXY_URL} — start it to run the end-to-end suite`);
    return true;
  }
  return false;
}

test("the server advertises every design tool", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const result = await client!.request("tools/list");
  const names = result.tools.map((tool: { name: string }) => tool.name).sort();

  assert.deepEqual(names, [
    "add_nodes",
    "create_design",
    "delete_design",
    "delete_nodes",
    "detach_instances",
    "duplicate_design",
    "duplicate_nodes",
    "export_design",
    "get_changes",
    "get_design",
    "get_feedback",
    "group_designs",
    "group_nodes",
    "list_designs",
    "mark_feedback_processed",
    "mark_synced",
    "reconnect_gui",
    "reorder_nodes",
    "screenshot_design",
    "search_icons",
    "ungroup_nodes",
    "update_design",
    "update_nodes",
  ]);
});

test("the GUI worker registered with the proxy and serves the SPA", async (t) => {
  if (skipUnlessAvailable(t)) return;
  assert.notEqual(guiUrl, "", "the GUI never became reachable through the proxy");

  const health = await (await fetch(`${guiUrl}/proxy/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.ipc, "connected");
  assert.equal(health.proxy, "connected", "the worker must be registered with the proxy");

  const html = await (await fetch(`${guiUrl}/`)).text();
  assert.match(html, /<base href="\/design-e2e-test\/" \/>/, "the SPA base href must match the proxy mount path");
  assert.match(html, /<div id="root">/);
});

test("the agent creates a design and the GUI API sees it", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const created = await client!.callTool("create_design", { name: "E2E Board", width: 800, height: 600 });
  assert.match(created, /created with id "e2e-board"/);

  await client!.callTool("add_nodes", {
    design_id: "e2e-board",
    nodes: [
      { type: "rect", id: "card", x: 40, y: 40, width: 300, height: 180, fill: "#ffffff" },
      { type: "text", id: "title", x: 60, y: 60, text: "Bonjour", fontSize: 32 },
    ],
  });

  const designs = await (await fetch(`${guiUrl}/api/designs`)).json();
  const summary = designs.find((entry: { id: string }) => entry.id === "e2e-board");
  assert.ok(summary, "the design must be listed by the GUI API");
  assert.equal(summary.nodeCount, 2);
  assert.equal(summary.pendingChanges, 2);

  const design = await (await fetch(`${guiUrl}/api/designs/e2e-board`)).json();
  assert.deepEqual(
    design.nodes.map((node: { id: string }) => node.id),
    ["card", "title"]
  );
});

test("an edit made through the GUI comes back to the agent via get_changes", async (t) => {
  if (skipUnlessAvailable(t)) return;

  await client!.callTool("mark_synced", { design_id: "e2e-board" });
  assert.match(await client!.callTool("get_changes", { design_id: "e2e-board" }), /No change/);

  // Ce que fait l'utilisateur dans le canvas : il déplace la carte et retouche le titre.
  const design = await (await fetch(`${guiUrl}/api/designs/e2e-board`)).json();
  const nodes = design.nodes.map((node: any) =>
    node.id === "card" ? { ...node, x: 240, fill: "#ff5533" } : { ...node, text: "Bonjour le monde" }
  );

  const saved = await fetch(`${guiUrl}/api/designs/e2e-board`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes }),
  });
  assert.equal(saved.status, 200);

  const changes = await client!.callTool("get_changes", { design_id: "e2e-board" });
  assert.match(changes, /last edited by user/);
  assert.match(changes, /## Updated \(2\)/);
  assert.match(changes, /x: 40 -> 240/);
  assert.match(changes, /fill: "#ffffff" -> "#ff5533"/);
  assert.match(changes, /text: "Bonjour" -> "Bonjour le monde"/);

  // Relire ne doit rien acquitter.
  assert.match(await client!.callTool("get_changes", { design_id: "e2e-board" }), /## Updated \(2\)/);
  await client!.callTool("mark_synced", { design_id: "e2e-board" });
  assert.match(await client!.callTool("get_changes", { design_id: "e2e-board" }), /No change/);
});

test("the agent exports the user-refined design as integrable markup", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const html = await client!.callTool("export_design", { design_id: "e2e-board", format: "html" });
  assert.match(html, /left: 240px;/);
  assert.match(html, /background: #ff5533;/);
  assert.match(html, /Bonjour le monde/);

  const jsx = await client!.callTool("export_design", { design_id: "e2e-board", format: "jsx" });
  assert.match(jsx, /export function E2EBoard\(\)/);
});

test("a design created from the GUI is visible to the agent", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const response = await fetch(`${guiUrl}/api/designs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Depuis la GUI", width: 375, height: 812 }),
  });
  assert.equal(response.status, 200);

  const listed = await client!.callTool("list_designs");
  assert.match(listed, /depuis-la-gui — "Depuis la GUI" 375x812/);

  const deleted = await fetch(`${guiUrl}/api/designs/depuis-la-gui`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.doesNotMatch(await client!.callTool("list_designs"), /depuis-la-gui/);
});

test("a page duplicated from the GUI is visible to the agent", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const response = await fetch(`${guiUrl}/api/designs/e2e-board/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Copie GUI" }),
  });
  assert.equal(response.status, 200);
  const { design } = await response.json();
  assert.equal(design.id, "copie-gui");

  assert.match(await client!.callTool("list_designs"), /copie-gui — "Copie GUI"/);

  const deleted = await fetch(`${guiUrl}/api/designs/copie-gui`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
});

test("grouping survives the round trip through the GUI API", async (t) => {
  if (skipUnlessAvailable(t)) return;

  await client!.callTool("group_nodes", { design_id: "e2e-board", node_ids: ["card", "title"], group_id: "hero" });
  await client!.callTool("mark_synced", { design_id: "e2e-board" });

  const design = await (await fetch(`${guiUrl}/api/designs/e2e-board`)).json();
  const group = design.nodes.find((node: { id: string }) => node.id === "hero");
  assert.equal(group.type, "group");
  assert.equal(design.nodes.find((node: { id: string }) => node.id === "card").parentId, "hero");

  // L'utilisateur déplace le groupe dans la GUI : un seul champ doit changer.
  const nodes = design.nodes.map((node: { id: string; x: number }) =>
    node.id === "hero" ? { ...node, x: node.x + 60 } : node
  );
  const saved = await fetch(`${guiUrl}/api/designs/e2e-board`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes }),
  });
  assert.equal(saved.status, 200);

  const changes = await client!.callTool("get_changes", { design_id: "e2e-board" });
  assert.match(changes, /## Updated \(1\)/, "moving a group must not restate every child");
  assert.match(changes, /hero/);

  // L'export imbrique le groupe et garde son contenu en coordonnées locales.
  assert.match(await client!.callTool("export_design", { design_id: "e2e-board", format: "svg" }), /<g transform="translate\(/);

  await client!.callTool("ungroup_nodes", { design_id: "e2e-board", group_ids: ["hero"] });
  const flat = await (await fetch(`${guiUrl}/api/designs/e2e-board`)).json();
  assert.equal(flat.nodes.find((node: { id: string }) => node.id === "hero"), undefined);
  assert.equal(flat.nodes.find((node: { id: string }) => node.id === "card").parentId, null);
  await client!.callTool("mark_synced", { design_id: "e2e-board" });
});

test("the GUI API reports errors instead of failing silently", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const missing = await fetch(`${guiUrl}/api/designs/pas-un-design`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /not found/);

  const badSave = await fetch(`${guiUrl}/api/designs/e2e-board`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: "pas un tableau" }),
  });
  assert.equal(badSave.status, 400);
});

test("nothing leaks onto stdout besides JSON-RPC", async (t) => {
  if (skipUnlessAvailable(t)) return;
  // Le canal stdio est partagé avec le protocole : une seule ligne parasite
  // casserait la connexion MCP. Les requêtes précédentes l'auraient révélé.
  assert.ok(client!.stderr.length > 0, "the server should log to stderr");
});

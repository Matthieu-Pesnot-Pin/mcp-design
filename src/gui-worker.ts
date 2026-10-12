import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { GUI_LISTEN_HOST, ProxyClient, createLogger, honoGuiGuard, setupLogging } from "@imenam/mcp-gui-interface";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

import { IPCMessageSchema } from "../shared/schemas/design.schema.js";
import { resolveLogDir } from "./core/log-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "gui")) || fs.existsSync(path.join(current, "package.json"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}

const rootDir = findProjectRoot(__dirname);
const absoluteStaticRoot = path.resolve(path.join(rootDir, "gui/dist"));
const configuredAppPath = process.env.APP_PATH || "/design-gui";

/**
 * Chemin réellement monté par le proxy. Il peut différer de `configuredAppPath`
 * quand `APP_PATH_PREFIX` est défini : le client partagé préfixe alors le chemin
 * naturel et renvoie le chemin final dans `result.path`. Le `<base href>` doit
 * suivre ce chemin, sinon les assets de la SPA sont demandés au mauvais endroit.
 */
let effectiveAppPath = configuredAppPath;

/**
 * Deux façons d'exposer la GUI, résolues une seule fois au chargement :
 *   - `proxy`      : PROXY_URL est défini, le proxy attribue le port et monte
 *                    la GUI sous APP_PATH (mode historique) ;
 *   - `standalone` : pas de PROXY_URL mais APP_PORT est défini — la GUI écoute
 *                    directement sur ce port, servie à la racine. Permet de
 *                    l'utiliser sans le hub de centralisation.
 * PROXY_URL prime quand les deux sont renseignés.
 */
type GuiMode =
  | { kind: "proxy"; proxyUrl: string }
  | { kind: "standalone"; port: number }
  | { kind: "disabled"; reason: string };

function resolveGuiMode(): GuiMode {
  const proxyUrl = process.env.PROXY_URL?.trim();
  if (proxyUrl) return { kind: "proxy", proxyUrl };

  const rawPort = process.env.APP_PORT?.trim();
  if (!rawPort) {
    return { kind: "disabled", reason: "PROXY_URL et APP_PORT non définis" };
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "disabled", reason: `APP_PORT invalide (${rawPort}) — attendu : entier entre 1 et 65535` };
  }
  return { kind: "standalone", port };
}

const guiMode = resolveGuiMode();
const isStandalone = guiMode.kind === "standalone";

setupLogging({ processLabel: "mcp-design:GUI", logDir: resolveLogDir(rootDir) });
const logger = createLogger("mcp-design:GUI");

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  logger.error(err.stack || "No stack trace");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// Le master peut disparaître sans que l'évènement `disconnect` ne parvienne au
// worker (cas Windows). Deux garde-fous complémentaires : le canal IPC, qui se
// ferme dès que le parent meurt, et le PID parent en dernier recours — les PID
// étant recyclés sous Windows, le premier est le plus fiable des deux.
const parentPid = process.ppid;
const parentCheckInterval = setInterval(() => {
  if (!process.connected) {
    logger.info("IPC channel to the MCP master is closed. Exiting.");
    clearInterval(parentCheckInterval);
    process.exit(0);
    return;
  }
  try {
    process.kill(parentPid, 0);
  } catch {
    logger.info(`Parent process (PID ${parentPid}) is gone. Exiting.`);
    clearInterval(parentCheckInterval);
    process.exit(0);
  }
}, 2000);

const app = new Hono();
app.use("*", honoGuiGuard());
let proxyClient: ProxyClient | null = null;
const pendingRequests = new Map<string, (value: any) => void>();

function safeSend(message: any): boolean {
  if (process.send && process.connected) {
    try {
      return process.send(message);
    } catch (err: any) {
      logger.error(`[IPC] Failed to send message: ${err.message}`);
      return false;
    }
  }
  return false;
}

/** Requête IPC vers le master. Ne rejette jamais : un timeout devient une réponse d'erreur. */
function ipcRequest(type: string, data?: any, timeout = 5000): Promise<any> {
  const correlationId = Math.random().toString(36).substring(7);
  const message = { type, correlationId, data, timestamp: new Date().toISOString() };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(correlationId)) {
        pendingRequests.delete(correlationId);
        resolve({ error: "Request timed out" });
      }
    }, timeout);

    pendingRequests.set(correlationId, (msg: any) => {
      clearTimeout(timer);
      resolve(msg);
    });

    if (!safeSend(message)) {
      clearTimeout(timer);
      pendingRequests.delete(correlationId);
      resolve({ error: "IPC not available" });
    }
  });
}

const PUSHED_EVENTS = new Set(["DESIGNS_UPDATED", "DESIGN_UPDATED", "REMARKS_UPDATED"]);

/**
 * Journal des évènements poussés par le master, relu par la GUI via
 * `/api/changes`. Chaque entrée porte un numéro croissant ; seules les
 * `JOURNAL_LIMIT` dernières sont gardées. `epoch` change à chaque démarrage du
 * worker : un client qui le voit changer sait que sa position ne vaut plus rien.
 */
const JOURNAL_LIMIT = 200;
const epoch = randomUUID();
let lastSeq = 0;
const journal: { seq: number; event: unknown }[] = [];

function appendToJournal(event: unknown) {
  lastSeq += 1;
  journal.push({ seq: lastSeq, event });
  if (journal.length > JOURNAL_LIMIT) journal.splice(0, journal.length - JOURNAL_LIMIT);
}

function setupIpcErrorHandlers() {
  process.on("error", (err: any) => {
    if (err.code === "ERR_IPC_CHANNEL_CLOSED") return;
    logger.error(`Process error: ${err.message}`);
  });

  process.on("disconnect", () => {
    logger.warn("IPC disconnected from MCP master. GUI worker will exit.");
    process.exit(0);
  });

  process.on("message", (msg: any) => {
    if (msg && msg.correlationId && pendingRequests.has(msg.correlationId)) {
      const resolve = pendingRequests.get(msg.correlationId)!;
      pendingRequests.delete(msg.correlationId);
      resolve(msg);
      return;
    }

    if (msg && msg.type === "GET_HEALTH") {
      const memory = process.memoryUsage();
      safeSend({
        type: "HEALTH_RESPONSE",
        correlationId: msg.correlationId,
        data: { status: "ok", uptime: process.uptime(), memory: { rss: memory.rss, heapUsed: memory.heapUsed } },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (msg && PUSHED_EVENTS.has(msg.type)) appendToJournal(msg);
  });
}

// --- Routes HTTP ------------------------------------------------------------

app.get("/proxy/health", (c) => {
  const memory = process.memoryUsage();
  return c.json({
    status: "ok",
    proxy: proxyClient ? proxyClient.getStatus() : isStandalone ? "standalone" : "error",
    uptime: process.uptime(),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    ipc: process.connected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Évènements survenus depuis la position `since` du client. `reset: true`
 * quand cette position n'est pas exploitable — absente, d'un autre démarrage du
 * worker, plus ancienne que le journal ou en avance sur lui : le client
 * recharge alors tout et repart de `seq`.
 */
app.get("/api/changes", (c) => {
  const rawSince = c.req.query("since");
  const clientEpoch = c.req.query("epoch");

  if (rawSince !== undefined && !/^\d+$/.test(rawSince)) {
    return c.json({ error: `Invalid "since" parameter: expected a non-negative integer, got "${rawSince}"` }, 400);
  }

  const reset = { epoch, seq: lastSeq, reset: true };
  if (rawSince === undefined || !clientEpoch || clientEpoch !== epoch) return c.json(reset);

  const since = Number(rawSince);
  const oldestSeq = journal.length > 0 ? journal[0].seq : lastSeq + 1;
  if (since > lastSeq || since < oldestSeq - 1) return c.json(reset);

  const events = journal.filter((entry) => entry.seq > since).map((entry) => entry.event);
  return c.json({ epoch, seq: lastSeq, reset: false, events });
});

app.get("/api/config", async (c) => {
  const result = await ipcRequest("GET_CONFIG");
  if (result.error) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

app.get("/api/designs", async (c) => {
  const result = await ipcRequest("LIST_DESIGNS");
  if (result.error) return c.json({ error: result.error }, 500);
  return c.json(result.data.designs);
});

app.post("/api/designs", async (c) => {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // Corps facultatif : la GUI peut créer un design avec les valeurs par défaut.
  }
  const result = await ipcRequest("CREATE_DESIGN", body, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.get("/api/designs/:id", async (c) => {
  const result = await ipcRequest("GET_DESIGN", { id: c.req.param("id") });
  if (result.error) return c.json({ error: result.error }, 404);
  return c.json(result.data);
});

app.put("/api/designs/:id", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("SAVE_DESIGN", { ...body, id: c.req.param("id") }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.put("/api/designs/:id/group", async (c) => {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("SET_DESIGN_GROUP", { id: c.req.param("id"), group: body?.group ?? null }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.post("/api/designs/:id/duplicate", async (c) => {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("DUPLICATE_DESIGN", { id: c.req.param("id"), name: body?.name }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.delete("/api/designs/:id", async (c) => {
  const result = await ipcRequest("DELETE_DESIGN", { id: c.req.param("id") }, 10000);
  if (result.error) return c.json({ error: result.error }, 404);
  return c.json(result.data);
});

app.get("/api/remarks", async (c) => {
  const result = await ipcRequest("LIST_REMARKS");
  if (result.error) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

app.post("/api/remarks", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  // La capture est rendue côté serveur : un délai plus long qu'une simple écriture.
  const result = await ipcRequest("ADD_REMARK", body, 20000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.put("/api/remarks/:id", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("UPDATE_REMARK", { id: c.req.param("id"), text: body?.text }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.delete("/api/remarks/:id", async (c) => {
  const result = await ipcRequest("DELETE_REMARK", { id: c.req.param("id") }, 10000);
  if (result.error) return c.json({ error: result.error }, 404);
  return c.json(result.data);
});

app.post("/api/feedback", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("SUBMIT_FEEDBACK", { remarkIds: body?.remarkIds, title: body?.title }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.put("/api/rounds/:round", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest("RENAME_ROUND", { round: c.req.param("round"), title: body?.title }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.put("/api/rounds/:round/remarks/:id", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await ipcRequest(
    "SET_REMARK_PROCESSED",
    { round: c.req.param("round"), remarkId: c.req.param("id"), processed: body?.processed },
    10000
  );
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.post("/api/feedback/processed", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  // Sans numéro de retour, tous les retours sont visés.
  const result = await ipcRequest("SET_ROUNDS_PROCESSED", { round: body?.round, processed: body?.processed }, 10000);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

app.get("/api/captures/:name", async (c) => {
  const result = await ipcRequest("GET_CAPTURE", { name: c.req.param("name") }, 10000);
  if (result.error) return c.json({ error: result.error }, 404);
  return c.body(Buffer.from(result.data.png, "base64"), 200, {
    "Content-Type": "image/png",
    // Une capture n'est jamais réécrite : son nom suit l'id de la remarque.
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

app.get("/api/images/:name", async (c) => {
  const result = await ipcRequest("GET_IMAGE", { name: c.req.param("name") }, 10000);
  if (result.error) return c.json({ error: result.error }, 404);
  return c.body(Buffer.from(result.data.data, "base64"), 200, {
    "Content-Type": result.data.mimeType,
    // Le nom d'une image suit l'empreinte de son contenu : il ne désigne jamais deux fichiers différents.
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

// Fichiers statiques de la SPA
app.use("/assets/*", serveStatic({ root: path.relative(process.cwd(), absoluteStaticRoot) }));

function getHtmlBaseHref(appPath: string): string {
  const normalized = appPath.startsWith("/") ? appPath : `/${appPath}`;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

// Fallback SPA
app.get("/*", (c, next) => {
  const urlPath = c.req.path;
  if (urlPath.startsWith("/api") || urlPath.startsWith("/proxy") || urlPath.startsWith("/assets")) return next();

  try {
    const indexPath = path.join(absoluteStaticRoot, "index.html");
    if (fs.existsSync(indexPath)) {
      // ?__direct=1 : accès au worker sur son port local, sans passer par le
      // proxy — le préfixe de montage ne doit alors pas préfixer les assets.
      // En mode standalone la GUI est déjà servie à la racine : même règle.
      const baseHref =
        isStandalone || c.req.query("__direct") === "1" ? "/" : getHtmlBaseHref(effectiveAppPath);
      const html = fs.readFileSync(indexPath, "utf8").replace("<head>", `<head>\n    <base href="${baseHref}" />`);
      return c.html(html);
    }
    return c.text("GUI build not found at " + absoluteStaticRoot, 404);
  } catch {
    return next();
  }
});

/**
 * Lance Hono sur `port` et prévient le master. `publicUrl` est l'URL que
 * l'utilisateur doit ouvrir : via le proxy, ou directement en localhost.
 */
function listen(port: number, publicUrl: string, isProxied: boolean) {
  const serverInstance = serve({ fetch: app.fetch, port, hostname: GUI_LISTEN_HOST }, (info) => {
    logger.info(`Design canvas server listening on port ${info.port}`);
    safeSend(
      IPCMessageSchema.parse({
        type: "READY",
        data: { port: info.port, isProxied, url: publicUrl },
        timestamp: new Date().toISOString(),
      })
    );
  });

  serverInstance.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      // Sortie propre (code 0) : le master ne doit pas relancer un worker de plus.
      logger.error(`Port ${port} already in use — another GUI instance is running.`);
      safeSend(
        IPCMessageSchema.parse({
          type: "ALREADY_RUNNING",
          data: { url: publicUrl },
          timestamp: new Date().toISOString(),
        })
      );
      process.exit(0);
    }
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  });
}

/** Sans proxy : la GUI écoute sur APP_PORT et est servie à la racine. */
function startStandalone(port: number) {
  const publicUrl = `http://localhost:${port}`;
  logger.info(`Standalone mode (no PROXY_URL): serving GUI on ${publicUrl}`);

  setupIpcErrorHandlers();
  listen(port, publicUrl, false);
}

async function startServer() {
  if (guiMode.kind === "disabled") {
    process.stderr.write(`[GUI] ${guiMode.reason} — arrêt.\n`);
    process.exit(0);
  }

  if (guiMode.kind === "standalone") {
    startStandalone(guiMode.port);
    return;
  }

  const proxyUrl = guiMode.proxyUrl;
  const appPath = configuredAppPath;
  const appName = process.env.APP_NAME || "MCP Design";

  logger.info(`Starting server with proxyUrl=${proxyUrl}`);
  proxyClient = new ProxyClient(proxyUrl);

  let result;
  try {
    // APP_GROUP place la GUI dans une section repliable du proxy (facultatif).
    const registerOptions = { path: appPath, name: appName, group: process.env.APP_GROUP };
    result = await proxyClient.register(registerOptions);
  } catch (e: any) {
    process.stderr.write("[GUI] Enregistrement proxy échoué — arrêt.\n");
    logger.error(`Proxy registration error: ${e.message}`);
    process.exit(1);
    return;
  }

  if (result.error === "HTTP 409") {
    logger.info("Another GUI instance already registered.");
    safeSend(
      IPCMessageSchema.parse({
        type: "ALREADY_RUNNING",
        data: { url: `${proxyUrl}${appPath}` },
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(0);
    return;
  }

  if (!result.success) {
    process.stderr.write("[GUI] Enregistrement proxy échoué — arrêt.\n");
    logger.error(`Proxy registration failed: ${result.error}`);
    process.exit(1);
    return;
  }

  const finalPort = result.port;
  effectiveAppPath = result.path ?? appPath;
  const publicUrl = result.url || `${proxyUrl}${effectiveAppPath}`;
  logger.info(`Registered with proxy. Public URL: ${publicUrl}, Local Port: ${finalPort}`);

  const cleanupProxy = async () => {
    if (proxyClient) await proxyClient.unregister();
    process.exit(0);
  };
  process.on("SIGTERM", cleanupProxy);
  process.on("SIGINT", cleanupProxy);

  setupIpcErrorHandlers();

  listen(finalPort, publicUrl, true);
}

startServer().catch((err: any) => {
  logger.error(`Failed to start GUI Worker: ${err.message}`);
  if (err.stack) logger.error(err.stack);
  process.exit(1);
});

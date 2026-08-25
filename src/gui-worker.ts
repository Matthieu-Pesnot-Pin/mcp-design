import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ProxyClient, createLogger, setupLogging } from "@imenam/mcp-gui-interface";
import path from "path";
import fs from "fs";
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
let proxyClient: ProxyClient | null = null;
const sseControllers = new Set<any>();
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

const PUSHED_EVENTS = new Set(["INITIAL_STATE", "DESIGNS_UPDATED", "DESIGN_UPDATED"]);

function setupIpcErrorHandlers() {
  process.on("error", (err: any) => {
    if (err.code === "ERR_IPC_CHANNEL_CLOSED") return;
    logger.error(`Process error: ${err.message}`);
  });

  process.on("disconnect", () => {
    logger.warn("IPC disconnected from MCP master. GUI worker will exit; EventSource clients will show Disconnected.");
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

    if (msg && PUSHED_EVENTS.has(msg.type)) {
      for (const controller of sseControllers) {
        try {
          controller.writeSSE({ data: JSON.stringify(msg), event: "message" });
        } catch {
          sseControllers.delete(controller);
        }
      }
    }
  });
}

// --- Routes HTTP ------------------------------------------------------------

app.get("/proxy/health", (c) => {
  const memory = process.memoryUsage();
  return c.json({
    status: "ok",
    proxy: proxyClient ? proxyClient.getStatus() : process.env.PROXY_URL ? "error" : "standalone",
    uptime: process.uptime(),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    ipc: process.connected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const clientId = Math.random().toString(36).slice(2, 11);
    sseControllers.add(stream);
    logger.info(`SSE /api/events: client connected (id=${clientId})`);

    stream.onAbort(() => {
      sseControllers.delete(stream);
      logger.warn(`SSE /api/events: stream aborted (id=${clientId}).`);
    });

    if (!safeSend({ type: "GET_INITIAL_STATE", timestamp: new Date().toISOString() })) {
      logger.warn(`SSE /api/events: GET_INITIAL_STATE not sent (id=${clientId}) — IPC unavailable.`);
    }

    try {
      await stream.writeSSE({ data: "connected", event: "ping" });
    } catch (err: any) {
      logger.warn(`SSE /api/events: initial writeSSE failed (id=${clientId}): ${err?.message ?? err}`);
      sseControllers.delete(stream);
      return;
    }

    while (true) {
      await stream.sleep(30000);
      try {
        await stream.writeSSE({ data: "ping", event: "ping" });
      } catch (err: any) {
        logger.warn(`SSE /api/events: keepalive ping failed (id=${clientId}): ${err?.message ?? err}`);
        sseControllers.delete(stream);
        break;
      }
    }
  })
);

app.post("/api/client-diagnostics", async (c) => {
  try {
    logger.warn(`Client diagnostics (SSE/EventSource): ${JSON.stringify(await c.req.json())}`);
  } catch (e: any) {
    logger.warn(`Client diagnostics: invalid JSON body (${e?.message ?? e})`);
  }
  return c.json({ ok: true });
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

app.delete("/api/designs/:id", async (c) => {
  const result = await ipcRequest("DELETE_DESIGN", { id: c.req.param("id") }, 10000);
  if (result.error) return c.json({ error: result.error }, 404);
  return c.json(result.data);
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
      const baseHref = c.req.query("__direct") === "1" ? "/" : getHtmlBaseHref(configuredAppPath);
      const html = fs.readFileSync(indexPath, "utf8").replace("<head>", `<head>\n    <base href="${baseHref}" />`);
      return c.html(html);
    }
    return c.text("GUI build not found at " + absoluteStaticRoot, 404);
  } catch {
    return next();
  }
});

async function startServer() {
  if (!process.env.PROXY_URL) {
    process.stderr.write("[GUI] PROXY_URL non défini — arrêt.\n");
    process.exit(0);
  }
  const proxyUrl = process.env.PROXY_URL;
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
  const publicUrl = result.url || `${proxyUrl}${appPath}`;
  logger.info(`Registered with proxy. Public URL: ${publicUrl}, Local Port: ${finalPort}`);

  const cleanupProxy = async () => {
    if (proxyClient) await proxyClient.unregister();
    process.exit(0);
  };
  process.on("SIGTERM", cleanupProxy);
  process.on("SIGINT", cleanupProxy);

  setupIpcErrorHandlers();

  const serverInstance = serve({ fetch: app.fetch, port: finalPort, hostname: "0.0.0.0" }, (info) => {
    logger.info(`Design canvas server listening on port ${info.port}`);
    safeSend(
      IPCMessageSchema.parse({
        type: "READY",
        data: { port: info.port, isProxied: true, url: publicUrl },
        timestamp: new Date().toISOString(),
      })
    );
  });

  serverInstance.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      // Sortie propre (code 0) : le master ne doit pas relancer un worker de plus.
      logger.error(`Port ${finalPort} already in use — another GUI instance is running.`);
      process.exit(0);
    }
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  });
}

startServer().catch((err: any) => {
  logger.error(`Failed to start GUI Worker: ${err.message}`);
  if (err.stack) logger.error(err.stack);
  process.exit(1);
});

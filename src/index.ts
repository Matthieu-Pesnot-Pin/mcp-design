#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GuiLauncher, createLogger, setupLogging } from "@imenam/mcp-gui-interface";

import { APP_VERSION } from "./version.js";
import { resolveLogDir } from "./core/log-dir.js";
import { DesignStore } from "./core/design-store.js";
import { NODE_DEFAULTS } from "./core/node-factory.js";
import { EXPORT_FORMATS } from "./core/export.js";
import { MIN_LINE_HEIGHT_PX } from "../shared/render.js";
import { NODE_FIELD_DOCS } from "../shared/node-fields.js";
import { REORDER_DIRECTIONS } from "../shared/tree.js";
import { listDesigns } from "./tools/list-designs.js";
import { createDesign } from "./tools/create-design.js";
import { getDesign } from "./tools/get-design.js";
import { updateDesign } from "./tools/update-design.js";
import { deleteDesign } from "./tools/delete-design.js";
import { addNodes } from "./tools/add-nodes.js";
import { updateNodes } from "./tools/update-nodes.js";
import { deleteNodes } from "./tools/delete-nodes.js";
import { groupNodes } from "./tools/group-nodes.js";
import { ungroupNodes } from "./tools/ungroup-nodes.js";
import { getChanges } from "./tools/get-changes.js";
import { markSynced } from "./tools/mark-synced.js";
import { exportDesignTool } from "./tools/export-design.js";
import { screenshotDesignTool } from "./tools/screenshot-design.js";
import { reorderNodesTool } from "./tools/reorder-nodes.js";
import type { ToolResult } from "./tools/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Les flags CLI sont traités avant toute initialisation : ils s'exécutent dans le
// répertoire de l'utilisateur, pas dans un serveur MCP.
if (process.argv.slice(2).includes("--claude-setup-mcp")) {
  const { runSetupMcp } = await import("./cli/setup-mcp.js");
  process.exit(runSetupMcp({ cwd: process.cwd(), force: process.argv.slice(2).includes("--force") }));
}

function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}

const rootDir = findProjectRoot(__dirname);
const packageEnvPath = path.join(rootDir, ".env");

setupLogging({ processLabel: "mcp-design", logDir: resolveLogDir(rootDir) });
const logger = createLogger("mcp-design");

// Rechargé à chaque appel, avec override : le .env local doit primer sur les
// variables héritées du JSON de déclaration du MCP.
function getConfig() {
  if (fs.existsSync(packageEnvPath)) dotenv.config({ path: packageEnvPath, override: true });
  return { proxyUrl: process.env.PROXY_URL, version: APP_VERSION };
}

getConfig();

const store = new DesignStore(rootDir);

const server = new Server({ name: "mcp-design", version: APP_VERSION }, { capabilities: { tools: {} } });

// --- Cycle de vie de la GUI -------------------------------------------------

let guiLauncher!: GuiLauncher;
type GuiRuntimeStatus = "disabled" | "starting" | "ready" | "already_running" | "stopped";
let guiStatus: GuiRuntimeStatus = "disabled";
let guiUrl: string | null = null;
let guiStartWaiter: ((result: { outcome: "ready" | "already_running"; url?: string }) => void) | null = null;

function broadcastToGUI(message: Record<string, unknown>) {
  const child = guiLauncher?.getProcess();
  if (child?.connected) {
    try {
      child.send(message);
    } catch (err: any) {
      logger.error(`Failed to send IPC message: ${err.message}`);
    }
  }
}

function reply(msg: any, type: string, data: unknown) {
  broadcastToGUI({ type, correlationId: msg.correlationId, data, timestamp: new Date().toISOString() });
}

function replyError(msg: any, type: string, error: string) {
  broadcastToGUI({ type, correlationId: msg.correlationId, error, timestamp: new Date().toISOString() });
}

/** Notifie la GUI qu'un design a changé côté agent, pour qu'elle se rafraîchisse. */
function notifyDesignChanged(designId: string) {
  broadcastToGUI({
    type: "DESIGN_UPDATED",
    data: { designId, designs: store.list() },
    timestamp: new Date().toISOString(),
  });
}

function handleIPCMessage(msg: any) {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "ALREADY_RUNNING":
      guiStatus = "already_running";
      guiUrl = msg.data?.url ?? guiUrl;
      guiStartWaiter?.({ outcome: "already_running", url: msg.data?.url });
      return;

    case "READY":
      guiStatus = "ready";
      guiUrl = msg.data?.url ?? guiUrl;
      logger.info(`GUI ready at ${guiUrl}`);
      guiStartWaiter?.({ outcome: "ready", url: msg.data?.url });
      return;

    case "GET_INITIAL_STATE":
      broadcastToGUI({
        type: "INITIAL_STATE",
        data: { designs: store.list(), version: APP_VERSION },
        timestamp: new Date().toISOString(),
      });
      return;

    case "LIST_DESIGNS":
      reply(msg, "LIST_DESIGNS_RESPONSE", { designs: store.list() });
      return;

    case "GET_DESIGN":
      try {
        reply(msg, "GET_DESIGN_RESPONSE", store.get(String(msg.data?.id)));
      } catch (err: any) {
        replyError(msg, "GET_DESIGN_RESPONSE", err.message);
      }
      return;

    case "CREATE_DESIGN":
      try {
        const design = store.create({
          name: String(msg.data?.name ?? "Nouveau design"),
          width: msg.data?.width === undefined ? undefined : Number(msg.data.width),
          height: msg.data?.height === undefined ? undefined : Number(msg.data.height),
          background: msg.data?.background,
        });
        reply(msg, "CREATE_DESIGN_RESPONSE", { design, designs: store.list() });
      } catch (err: any) {
        replyError(msg, "CREATE_DESIGN_RESPONSE", err.message);
      }
      return;

    case "SAVE_DESIGN":
      try {
        reply(msg, "SAVE_DESIGN_RESPONSE", handleSaveDesign(msg.data));
      } catch (err: any) {
        replyError(msg, "SAVE_DESIGN_RESPONSE", err.message);
      }
      return;

    case "DELETE_DESIGN":
      try {
        store.delete(String(msg.data?.id));
        reply(msg, "DELETE_DESIGN_RESPONSE", { designs: store.list() });
      } catch (err: any) {
        replyError(msg, "DELETE_DESIGN_RESPONSE", err.message);
      }
      return;

    case "GET_CONFIG":
      reply(msg, "GET_CONFIG_RESPONSE", { dataDir: store.getDataDir(), version: APP_VERSION });
      return;

    default:
      logger.debug(`Unhandled IPC message type: ${msg.type}`);
  }
}

/**
 * Sauvegarde intégrale déclenchée par la GUI. La baseline n'est jamais touchée
 * ici : c'est précisément l'écart entre elle et cet état que l'agent viendra
 * lire via get_changes.
 */
function handleSaveDesign(data: any) {
  const id = String(data?.id ?? "");
  const nodes = data?.nodes;
  if (!Array.isArray(nodes)) throw new Error("SAVE_DESIGN requires a nodes array.");

  // La GUI remplace `nodes` en bloc : sans la révision d'origine, une sauvegarde
  // partie d'un document périmé effacerait tout ce qu'un autre éditeur a ajouté.
  const revision = Number(data?.revision);
  const baseRevision = Number.isFinite(revision) ? revision : undefined;

  const design = store.mutate(id, "user", (draft) => {
    draft.nodes = nodes;
    if (data?.name !== undefined) draft.name = String(data.name);
    if (data?.width !== undefined) draft.width = Number(data.width);
    if (data?.height !== undefined) draft.height = Number(data.height);
    if (data?.background !== undefined) draft.background = String(data.background);
  }, { baseRevision });

  return { design, designs: store.list() };
}

function startGuiWorker() {
  guiStatus = "starting";
  const child = guiLauncher.start();
  child.on("exit", () => {
    // Un start() ultérieur remplace le process courant : seul l'exit du process
    // actif change l'état. ALREADY_RUNNING = la GUI vit dans une autre instance.
    if (guiLauncher.getProcess() === child && guiStatus !== "already_running") guiStatus = "stopped";
  });
  return child;
}

guiLauncher = new GuiLauncher({
  guiPath: path.join(__dirname, "gui-worker.js"),
  env: { ...process.env } as Record<string, string>,
  maxRestarts: 0,
  onMessage: handleIPCMessage,
});

function launchGUI() {
  if (!process.env.PROXY_URL) {
    logger.info("[MASTER] PROXY_URL non défini — GUI désactivée.");
    guiStatus = "disabled";
    return;
  }
  logger.info("Launching GUI worker...");
  startGuiWorker();
}

async function reconnectGui(args: any): Promise<ToolResult> {
  getConfig(); // relit le .env au cas où PROXY_URL aurait été ajouté après le démarrage
  if (!process.env.PROXY_URL) {
    return {
      content: [
        {
          type: "text",
          text: "Error: PROXY_URL is not set — the GUI is disabled. Add PROXY_URL to the .env file, then call reconnect_gui again.",
        },
      ],
      isError: true,
    };
  }

  const child = guiLauncher.getProcess();
  const alive = !!child && child.exitCode === null && !child.killed;
  const force = args?.force === true;

  if (alive && !force) {
    if (guiStatus === "starting") {
      return {
        content: [
          { type: "text", text: "GUI worker is already starting (proxy registration in progress). Wait a few seconds, then call reconnect_gui again if needed." },
        ],
      };
    }
    return {
      content: [
        { type: "text", text: `GUI is already registered with the proxy${guiUrl ? ` at ${guiUrl}` : ""}. Nothing to do (use force=true to restart it anyway).` },
      ],
    };
  }

  logger.info(`[MASTER] reconnect_gui: ${alive ? "restarting (force)" : "relaunching"} GUI worker...`);

  const result = await new Promise<{ outcome: "ready" | "already_running" | "exited" | "timeout"; url?: string; code?: number | null }>(
    (resolve) => {
      const newChild = startGuiWorker();
      const onExit = (code: number | null) => {
        cleanup();
        resolve({ outcome: "exited", code });
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ outcome: "timeout" });
      }, 15000);
      const cleanup = () => {
        clearTimeout(timer);
        newChild.off("exit", onExit);
        guiStartWaiter = null;
      };
      guiStartWaiter = (r) => {
        cleanup();
        resolve(r);
      };
      newChild.on("exit", onExit);
    }
  );

  if (result.outcome === "ready") {
    return { content: [{ type: "text", text: `GUI reconnected and registered with the proxy. URL: ${result.url}` }] };
  }
  if (result.outcome === "already_running") {
    return { content: [{ type: "text", text: `GUI is already registered by another MCP instance. URL: ${result.url ?? "unknown"}` }] };
  }
  if (result.outcome === "exited") {
    return {
      content: [
        { type: "text", text: `GUI worker exited before completing registration (code=${result.code}). The proxy server is probably still unreachable at ${process.env.PROXY_URL}. Start the proxy server, then call reconnect_gui again.` },
      ],
      isError: true,
    };
  }
  return {
    content: [
      { type: "text", text: `GUI worker started but did not confirm proxy registration within 15s. Check the logs (${resolveLogDir(rootDir)}), then retry.` },
    ],
    isError: true,
  };
}

/** URL de la GUI ajoutée aux réponses des outils, pour que l'utilisateur sache où regarder. */
function guiHint(designId: string): string {
  if (!guiUrl) return "";
  return `\n\nOpen the canvas: ${guiUrl}#/${encodeURIComponent(designId)}`;
}

// --- Déclaration des outils -------------------------------------------------

const NODE_FIELDS_DOC =
  "Every length is in PIXELS (x, y, width, height, strokeWidth, radius, fontSize, lineHeight), " +
  "rotation is in degrees and opacity is a 0-1 ratio. " +
  "Coordinates are expressed in the parent's space: a node with parentId null is positioned against the artboard, " +
  "a node inside a group is positioned against that group's origin. " +
  "Set parentId to the id of a group node to nest an element, or to null to move it back to the root. " +
  "A \"group\" node is a pure container: it accepts name, parentId, x, y, rotation and opacity, but its width and " +
  "height are derived from its content and cannot be set. " +
  "Fields accepted per type — rect: fill, stroke, strokeWidth, radius; ellipse: fill, stroke, strokeWidth; " +
  "line: stroke, strokeWidth (the line goes from (x, y) to (x + width, y + height)); " +
  "text: text, color, fontSize, fontFamily, fontWeight, fontStyle, textAlign, lineHeight. " +
  "Any field left out falls back to a sensible default, so a node can be created from its type alone.";

/**
 * Propriétés d'un noeud exposées à l'agent. Les descriptions viennent de
 * shared/node-fields.ts, partagées avec le schéma zod : l'unité d'un champ n'est
 * écrite qu'à un seul endroit.
 */
const NODE_PROPERTIES = {
  id: { type: "string", description: NODE_FIELD_DOCS.id },
  name: { type: "string", description: NODE_FIELD_DOCS.name },
  parentId: { type: ["string", "null"], description: NODE_FIELD_DOCS.parentId },
  x: { type: "number", description: NODE_FIELD_DOCS.x },
  y: { type: "number", description: NODE_FIELD_DOCS.y },
  width: { type: "number", description: NODE_FIELD_DOCS.width },
  height: { type: "number", description: NODE_FIELD_DOCS.height },
  rotation: { type: "number", description: NODE_FIELD_DOCS.rotation },
  opacity: { type: "number", minimum: 0, maximum: 1, description: NODE_FIELD_DOCS.opacity },
  fill: { type: "string", description: NODE_FIELD_DOCS.fill },
  stroke: { type: "string", description: NODE_FIELD_DOCS.stroke },
  strokeWidth: { type: "number", minimum: 0, description: NODE_FIELD_DOCS.strokeWidth },
  radius: { type: "number", minimum: 0, description: NODE_FIELD_DOCS.radius },
  text: { type: "string", description: NODE_FIELD_DOCS.text },
  color: { type: "string", description: NODE_FIELD_DOCS.color },
  fontSize: { type: "number", exclusiveMinimum: 0, description: NODE_FIELD_DOCS.fontSize },
  fontFamily: { type: "string", description: NODE_FIELD_DOCS.fontFamily },
  fontWeight: { type: "number", minimum: 100, maximum: 900, description: NODE_FIELD_DOCS.fontWeight },
  fontStyle: { type: "string", enum: ["normal", "italic"], description: NODE_FIELD_DOCS.fontStyle },
  textAlign: { type: "string", enum: ["left", "center", "right"], description: NODE_FIELD_DOCS.textAlign },
  lineHeight: { type: "number", minimum: MIN_LINE_HEIGHT_PX, description: NODE_FIELD_DOCS.lineHeight },
} as const;

const DESIGN_ID_DOC = "Id of the design, as returned by list_designs or create_design.";

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_designs",
      description:
        "List every design with its size, node count, revision and the number of edits not yet acknowledged with mark_synced. Start here when you do not know which design to work on.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "create_design",
      description:
        "Create an empty design (artboard). Returns its id, which every other tool needs. Default canvas is 1440x900 on a white background.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Human-readable name of the design, e.g. \"Landing page\"." },
          width: { type: "number", description: "Canvas width in pixels (default 1440). Use 375 for mobile, 1440 for desktop." },
          height: { type: "number", description: "Canvas height in pixels (default 900)." },
          background: { type: "string", description: "CSS color of the canvas background (default #ffffff)." },
        },
        required: ["name"],
      },
    },
    {
      name: "get_design",
      description:
        "Read a design. format=summary (default) gives a compact inventory of the nodes; format=json gives the exact values needed to build an update_nodes patch. Never acknowledges pending user edits — use get_changes for that.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          format: { type: "string", enum: ["summary", "json"], description: "Level of detail (default summary)." },
        },
        required: ["design_id"],
      },
    },
    {
      name: "update_design",
      description: "Change the artboard itself: its name, its dimensions or its background color. Does not touch the nodes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          name: { type: "string", description: "New name." },
          width: { type: "number", description: "New canvas width in pixels." },
          height: { type: "number", description: "New canvas height in pixels." },
          background: { type: "string", description: "New CSS background color." },
        },
        required: ["design_id"],
      },
    },
    {
      name: "delete_design",
      description: "Permanently delete a design and all of its nodes.",
      inputSchema: {
        type: "object" as const,
        properties: { design_id: { type: "string", description: DESIGN_ID_DOC } },
        required: ["design_id"],
      },
    },
    {
      name: "add_nodes",
      description:
        `Add one or more nodes on top of the design. Node types: ${Object.keys(NODE_DEFAULTS).join(", ")}. ` +
        NODE_FIELDS_DOC +
        " Nodes are drawn in array order, so the last one added sits on top.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          nodes: {
            type: "array",
            description: "Nodes to create, drawn bottom to top in this order.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["rect", "ellipse", "line", "text", "group"], description: NODE_FIELD_DOCS.type },
                ...NODE_PROPERTIES,
              },
              required: ["type"],
            },
            minItems: 1,
          },
        },
        required: ["design_id", "nodes"],
      },
    },
    {
      name: "update_nodes",
      description:
        "Patch existing nodes. Each entry needs an id plus only the fields to change; everything else is preserved. " +
        NODE_FIELDS_DOC +
        " The whole batch is validated before anything is written, so an invalid entry changes nothing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          updates: {
            type: "array",
            description: "One object per node: { id, ...fields to change }.",
            items: {
              type: "object",
              properties: {
                ...NODE_PROPERTIES,
                id: { type: "string", description: "Id of the node to patch." },
              },
              required: ["id"],
            },
            minItems: 1,
          },
        },
        required: ["design_id", "updates"],
      },
    },
    {
      name: "delete_nodes",
      description: "Remove nodes from a design by id. Deleting a group also deletes everything inside it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          node_ids: { type: "array", items: { type: "string" }, description: "Ids of the nodes to delete.", minItems: 1 },
        },
        required: ["design_id", "node_ids"],
      },
    },
    {
      name: "group_nodes",
      description:
        "Wrap existing nodes into a new group, so they can be moved, hidden or reordered together. The nodes must currently share the same parent, and nothing moves on screen: their coordinates are rebased onto the new group.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          node_ids: { type: "array", items: { type: "string" }, description: "Ids of the nodes to group together.", minItems: 1 },
          name: { type: "string", description: "Name of the new group (default \"Groupe\")." },
          group_id: { type: "string", description: "Optional explicit id for the group. Generated when omitted." },
        },
        required: ["design_id", "node_ids"],
      },
    },
    {
      name: "ungroup_nodes",
      description:
        "Dissolve groups: their content moves up one level, keeping its position on screen. The groups themselves are removed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          group_ids: { type: "array", items: { type: "string" }, description: "Ids of the groups to dissolve.", minItems: 1 },
        },
        required: ["design_id", "group_ids"],
      },
    },
    {
      name: "reorder_nodes",
      description:
        "Change the stacking order of nodes — which one is drawn on top of which. This is the layer panel, agent side. " +
        "Stacking is relative to SIBLINGS only: a node can only move past nodes sharing its parent, never past the content of " +
        "another group. To move an element above a whole group, reorder that group instead; to pull it out of a group, " +
        "change its parentId with update_nodes. " +
        "Moving several nodes at once keeps their relative order, and a node already at the edge of its sibling order simply does not move.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          node_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Ids of the nodes to move. Groups are allowed — a group moves with its whole content. " +
              "A node whose ancestor is also listed is ignored: the ancestor already carries it.",
            minItems: 1,
          },
          position: {
            type: "string",
            enum: [...REORDER_DIRECTIONS],
            description:
              "front = on top of all its siblings, back = behind all of them, " +
              "forward = one step up, backward = one step down.",
          },
        },
        required: ["design_id", "node_ids", "position"],
      },
    },
    {
      name: "get_changes",
      description:
        "Show every node added, modified, removed or reordered since the last mark_synced — this is how you pick up what the user changed by hand in the GUI. Reading changes never acknowledges them; call mark_synced once the changes are integrated into the code.",
      inputSchema: {
        type: "object" as const,
        properties: { design_id: { type: "string", description: DESIGN_ID_DOC } },
        required: ["design_id"],
      },
    },
    {
      name: "mark_synced",
      description:
        "Acknowledge the current state of a design as the new comparison baseline. Call it only after the user's edits have actually been reported into the codebase — get_changes will then be empty until the next edit.",
      inputSchema: {
        type: "object" as const,
        properties: { design_id: { type: "string", description: DESIGN_ID_DOC } },
        required: ["design_id"],
      },
    },
    {
      name: "export_design",
      description:
        "Render a design for integration. html = absolutely positioned divs + CSS (best starting point for real code), jsx = the same as a React component, svg = faithful preview, json = raw nodes, summary = textual inventory. Provide output_path to write to a file instead of returning the content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          format: { type: "string", enum: [...EXPORT_FORMATS], description: "Output format (default html)." },
          output_path: { type: "string", description: "Absolute path to write the export to. When omitted, the content is returned directly." },
        },
        required: ["design_id"],
      },
    },
    {
      name: "screenshot_design",
      description:
        "Render a design to a PNG image and look at it. Use it to check what the design actually looks like — proportions, overlaps, contrast, alignment — instead of inferring it from coordinates. " +
        "Pass node_id to frame the capture on a single group (or any element) rather than the whole artboard. " +
        "The image is returned inline; provide output_path to write a .png file instead.",
      inputSchema: {
        type: "object" as const,
        properties: {
          design_id: { type: "string", description: DESIGN_ID_DOC },
          node_id: {
            type: "string",
            description:
              "Id of a group (or any node) to frame the capture on. When omitted, the whole artboard is captured.",
          },
          scale: {
            type: "number",
            description:
              "Zoom factor applied to the capture (default 1). Useful to read a small group. The result is capped so its longest side stays under 1568 px.",
          },
          padding: {
            type: "number",
            description: "Margin in design pixels around the captured node (default 16, ignored for a full-artboard capture).",
          },
          output_path: {
            type: "string",
            description: "Absolute path of a .png file to write. When omitted, the image is returned inline.",
          },
        },
        required: ["design_id"],
      },
    },
    {
      name: "reconnect_gui",
      description:
        "Relaunch the GUI worker and re-register it with the proxy. Use it when the canvas is unreachable, or after starting the proxy server.",
      inputSchema: {
        type: "object" as const,
        properties: { force: { type: "boolean", description: "Restart the worker even if it looks alive." } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const params = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "list_designs":
        return listDesigns(store);

      case "create_design": {
        const result = createDesign(store, params);
        broadcastToGUI({ type: "DESIGNS_UPDATED", data: { designs: store.list() }, timestamp: new Date().toISOString() });
        return { ...result, content: [{ type: "text", text: result.content[0].text + guiHint(result.design!.id) }] };
      }

      case "get_design":
        return getDesign(store, params);

      case "update_design": {
        const result = updateDesign(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "delete_design": {
        const result = deleteDesign(store, params);
        broadcastToGUI({ type: "DESIGNS_UPDATED", data: { designs: store.list() }, timestamp: new Date().toISOString() });
        return result;
      }

      case "add_nodes": {
        const result = addNodes(store, params);
        notifyDesignChanged(result.design!.id);
        return { ...result, content: [{ type: "text", text: result.content[0].text + guiHint(result.design!.id) }] };
      }

      case "update_nodes": {
        const result = updateNodes(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "delete_nodes": {
        const result = deleteNodes(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "group_nodes": {
        const result = groupNodes(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "ungroup_nodes": {
        const result = ungroupNodes(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "reorder_nodes": {
        const result = reorderNodesTool(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "get_changes":
        return getChanges(store, params);

      case "mark_synced": {
        const result = markSynced(store, params);
        notifyDesignChanged(result.design!.id);
        return result;
      }

      case "export_design":
        return exportDesignTool(store, params);

      case "screenshot_design":
        return screenshotDesignTool(store, params);

      case "reconnect_gui":
        return await reconnectGui(params);

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`MCP Server connected and running on stdio (data dir: ${store.getDataDir()})`);
  launchGUI();
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception in MASTER: ${err.message}`);
  logger.error(err.stack || "No stack trace");
  guiLauncher.getProcess()?.kill("SIGTERM");
  process.exit(1);
});

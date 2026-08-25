import fs from "fs";
import path from "path";
import type { DesignStore } from "../core/design-store.js";
import { screenshotDesign } from "../core/screenshot.js";
import { requireString, type ImageToolResult } from "./types.js";

/** Marge par défaut autour d'un noeud capturé : de l'air, sans noyer l'élément. */
const NODE_PADDING = 16;

export function screenshotDesignTool(store: DesignStore, args: Record<string, unknown> | undefined): ImageToolResult {
  const id = requireString(args, "design_id");
  const design = store.get(id);

  const nodeId = typeof args?.node_id === "string" && args.node_id.trim() !== "" ? args.node_id.trim() : undefined;
  const node = nodeId ? design.nodes.find((candidate) => candidate.id === nodeId) : undefined;
  if (nodeId && !node) {
    throw new Error(`Node "${nodeId}" not found in design "${design.name}" (${design.id}).`);
  }

  const shot = screenshotDesign(design, {
    nodeId,
    scale: args?.scale === undefined ? undefined : Number(args.scale),
    padding: args?.padding === undefined ? (nodeId ? NODE_PADDING : 0) : Number(args.padding),
  });

  const subject = node ? `${node.type} "${node.name}" (${node.id})` : `design "${design.name}"`;
  const geometry =
    `${Math.round(shot.sourceWidth)}x${Math.round(shot.sourceHeight)} design px ` +
    `rendered at ${shot.width}x${shot.height} px (scale ${Math.round(shot.scale * 100) / 100})`;

  const outputPath = typeof args?.output_path === "string" ? args.output_path.trim() : "";
  if (outputPath) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, shot.png);
    return { content: [{ type: "text", text: `Screenshot of ${subject} written to ${target} — ${geometry}.` }] };
  }

  return {
    content: [
      { type: "text", text: `Screenshot of ${subject} — ${geometry}, revision ${design.revision}.` },
      { type: "image", data: shot.png.toString("base64"), mimeType: "image/png" },
    ],
  };
}

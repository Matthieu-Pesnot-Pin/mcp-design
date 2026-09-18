import type { DesignStore } from "../core/design-store.js";
import { screenshotDesign } from "../core/screenshot.js";
import { deliverFile } from "./relay.js";
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

  const destination = typeof args?.destination_path === "string" ? args.destination_path.trim() : "";
  if (destination) {
    // Livrer le PNG et le montrer à la fois n'aurait pas de sens : le relais retire le
    // contenu du résultat, et une image de plus dans le contexte coûte cher pour rien.
    const blocks = deliverFile(shot.png, "image/png", {
      destination_path: destination,
      filename: requireString(args, "filename"),
      destination_overwrite: args?.destination_overwrite === true,
      destination_relay: args?.destination_relay === true,
    });
    return {
      content: [{ type: "text", text: `Screenshot of ${subject} — ${geometry}.` }, ...blocks],
    };
  }

  return {
    content: [
      { type: "text", text: `Screenshot of ${subject} — ${geometry}, revision ${design.revision}.` },
      { type: "image", data: shot.png.toString("base64"), mimeType: "image/png" },
    ],
  };
}

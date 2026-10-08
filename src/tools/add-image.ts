import fs from "fs";
import path from "path";
import type { DesignStore } from "../core/design-store.js";
import { buildNode, DesignError, type CreateNodeInput } from "../core/node-factory.js";
import type { StoredImage } from "../core/image-store.js";
import { requireString, textResult } from "./types.js";
import type { MutationResult } from "./add-nodes.js";

/** Champs du noeud que l'appel peut fixer, en plus de l'image elle-même. */
const NODE_FIELDS = ["id", "name", "parentId", "x", "y", "width", "height", "rotation", "opacity", "fit"] as const;

/**
 * Octets de l'image : le contenu transmis par le relais du gateway quand il est
 * présent, sinon le fichier désigné par `file_path`, lu sur cette machine.
 */
function readImageBytes(args: Record<string, unknown>): Buffer {
  if (typeof args.file_content === "string" && args.file_content !== "") {
    return Buffer.from(args.file_content, "base64");
  }
  const filePath = requireString(args, "file_path");
  if (!path.isAbsolute(filePath)) throw new DesignError(`file_path must be an absolute path: ${filePath}`);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new DesignError(`File not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

/**
 * Taille de la boîte : celle demandée, sinon les dimensions naturelles de
 * l'image. Une seule dimension donnée, l'autre suit les proportions de l'image.
 */
function boxSize(image: StoredImage, width: unknown, height: unknown): { width: number; height: number } {
  const w = width === undefined ? undefined : Number(width);
  const h = height === undefined ? undefined : Number(height);
  if (w !== undefined && h !== undefined) return { width: w, height: h };
  if (w !== undefined) return { width: w, height: Math.round(((w * image.height) / image.width) * 100) / 100 };
  if (h !== undefined) return { width: Math.round(((h * image.width) / image.height) * 100) / 100, height: h };
  return { width: image.width, height: image.height };
}

export function addImage(store: DesignStore, args: Record<string, unknown> | undefined): MutationResult {
  const params = args ?? {};
  const id = requireString(params, "design_id");
  const current = store.get(id);

  const image = store.images.save(readImageBytes(params));

  const input: CreateNodeInput = { type: "image", image: image.name };
  for (const field of NODE_FIELDS) {
    if (params[field] !== undefined) input[field] = params[field];
  }
  if (input.name === undefined) {
    const original = typeof params.file_name === "string" ? params.file_name : String(params.file_path ?? "");
    const base = path.basename(original.replace(/\\/g, "/")).replace(/\.[^.]+$/, "");
    if (base !== "") input.name = base;
  }
  Object.assign(input, boxSize(image, params.width, params.height));

  const node = buildNode(input, new Set(current.nodes.map((n) => n.id)), current.nodes.length + 1);
  const design = store.mutate(id, "agent", (draft) => {
    draft.nodes.push(node);
  });

  return {
    ...textResult(
      `Added image ${node.id} — "${node.name}" to "${design.name}" at ${Math.round(node.x)},${Math.round(node.y)} ` +
        `size ${Math.round(node.width)}x${Math.round(node.height)}, fit ${node.fit}.\n` +
        `Stored as "${image.name}" (${image.format}, ${image.width}x${image.height} px, ${image.bytes} bytes). ` +
        `Use that name as the "image" field of an image node in add_nodes to place the same picture again.`
    ),
    design,
  };
}

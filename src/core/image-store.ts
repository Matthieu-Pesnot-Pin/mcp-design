import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DesignError } from "./node-factory.js";

/**
 * Médiathèque des designs : `<dataDir>/images/<nom>`.
 *
 * Un fichier est nommé d'après l'empreinte de son contenu : importer deux fois
 * la même image ne la stocke qu'une fois, et un nom ne désigne jamais deux
 * contenus différents — ce qui permet de le servir avec un cache permanent.
 * Les images sont partagées par toutes les planches du dossier de données.
 */

/** Taille maximale d'une image importée. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const IMAGE_FORMATS = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
} as const;

export type ImageFormat = keyof typeof IMAGE_FORMATS;

const IMAGE_NAME = /^img_[0-9a-f]{16}\.(png|jpg|gif|webp|svg)$/;

export interface StoredImage {
  /** Nom du fichier dans la médiathèque, à porter dans le champ `image` d'un noeud. */
  name: string;
  format: ImageFormat;
  mimeType: string;
  bytes: number;
  /** Dimensions naturelles, en pixels. */
  width: number;
  height: number;
}

/** Format reconnu d'après les premiers octets, jamais d'après l'extension annoncée. */
function detectFormat(data: Buffer): ImageFormat | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  const head = data.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

function jpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    // Marqueurs sans longueur : remplissage, RST, SOI.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    // SOF0..SOF15, hors DHT (C4), JPG (C8) et DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  const chunk = data.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X" && data.length >= 30) {
    return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 " && data.length >= 30) {
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Longueur SVG en pixels ; null pour une valeur relative (%) ou absente. */
function svgLength(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*([\d.]+)\s*(px)?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

function svgSize(data: Buffer): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(data.toString("utf8"))?.[0];
  if (!tag) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const width = svgLength(attribute("width"));
  const height = svgLength(attribute("height"));
  const viewBox = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const box = viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox : null;

  if (width && height) return { width, height };
  if (box && width) return { width, height: (width * box[3]) / box[2] };
  if (box && height) return { width: (height * box[2]) / box[3], height };
  if (box) return { width: box[2], height: box[3] };
  return null;
}

function naturalSize(data: Buffer, format: ImageFormat): { width: number; height: number } | null {
  switch (format) {
    case "png":
      return data.length >= 24 ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : null;
    case "gif":
      return data.length >= 10 ? { width: data.readUInt16LE(6), height: data.readUInt16LE(8) } : null;
    case "jpg":
      return jpegSize(data);
    case "webp":
      return webpSize(data);
    case "svg":
      return svgSize(data);
  }
}

export class ImageStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "images");
  }

  getDir(): string {
    return this.dir;
  }

  /** Enregistre une image et renvoie sa fiche ; une image déjà présente n'est pas réécrite. */
  save(data: Buffer): StoredImage {
    if (data.length === 0) throw new DesignError("The image file is empty.");
    if (data.length > MAX_IMAGE_BYTES) {
      throw new DesignError(`Image too large: ${data.length} bytes, the limit is ${MAX_IMAGE_BYTES}.`);
    }
    const format = detectFormat(data);
    if (!format) {
      throw new DesignError(`Unsupported image format. Accepted: ${Object.keys(IMAGE_FORMATS).join(", ")}.`);
    }
    const size = naturalSize(data, format);
    if (!size || !(size.width > 0) || !(size.height > 0)) {
      throw new DesignError(`Could not read the dimensions of this ${format} image: the file looks damaged.`);
    }

    const hash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
    const name = `img_${hash}.${format}`;
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, data);
    }
    return { name, format, mimeType: IMAGE_FORMATS[format], bytes: data.length, ...size };
  }

  private fileOf(name: string): string {
    if (!IMAGE_NAME.test(name)) throw new DesignError(`"${name}" is not an image name of the media library.`);
    return path.join(this.dir, name);
  }

  has(name: string): boolean {
    return IMAGE_NAME.test(name) && fs.existsSync(path.join(this.dir, name));
  }

  /** Échoue si un noeud désigne une image absente de la médiathèque. */
  requireStored(name: string): void {
    if (!this.has(name)) {
      throw new DesignError(
        `Image "${name}" is not in the media library. Import the picture with add_image, which returns the name to use.`
      );
    }
  }

  read(name: string): { data: Buffer; mimeType: string } {
    const file = this.fileOf(name);
    if (!fs.existsSync(file)) throw new DesignError(`Image "${name}" is missing from ${this.dir}.`);
    const format = path.extname(name).slice(1) as ImageFormat;
    return { data: fs.readFileSync(file), mimeType: IMAGE_FORMATS[format] };
  }

  /** L'image en data URI, pour un SVG ou un HTML qui doit se suffire à lui-même. */
  dataUri(name: string): string {
    const { data, mimeType } = this.read(name);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  }
}

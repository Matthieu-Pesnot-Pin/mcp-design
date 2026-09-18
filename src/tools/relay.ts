import fs from "fs";
import path from "path";

// Un fichier produit par ce MCP n'a aucun moyen d'atteindre la machine de l'agent quand
// le MCP tourne derrière mcp-http-gateway : le protocole n'offre au serveur aucune
// primitive pour y écrire. La convention du relais règle ça — dès qu'un outil déclare la
// paire `destination_path` / `destination_relay`, le relais retient la destination, pose
// `destination_relay`, et écrit lui-même les octets qu'on lui renvoie.
//
// Ici, on ne sait pas si un relais est dans la chaîne : `destination_relay` le dit. Posé,
// on renvoie le contenu ; absent, les deux machines n'en font qu'une et on écrit nous-même.

/** Plafond de ce qui peut être encodé dans une réponse d'outil. Le relais applique sa
 *  propre limite, configurable ; celle-ci n'existe que pour qu'un fichier démesuré
 *  échoue proprement ici plutôt qu'en épuisant la mémoire pendant l'encodage base64. */
const RELAY_MAX_BYTES = 32 * 1024 * 1024;

export const RELAY_SHAPE_DESCRIPTIONS = {
  destination_path:
    "ABSOLUTE path of the destination DIRECTORY on the agent machine. It is created if missing, and the file keeps the name given in filename",
  filename:
    "Name of the file to create, extension included (e.g. 'design.html'). Must not contain path separators",
  destination_overwrite: "Replace the destination file if it already exists. Defaults to false",
  destination_relay:
    "Filled in by the mcp-http-gateway relay, never by the agent. Signals that the destination lives on another machine and that the file content must travel in the response",
} as const;

export interface DeliveryTarget {
  destination_path: string;
  filename: string;
  destination_overwrite?: boolean;
  destination_relay?: boolean;
}

import type { ResourceBlock } from "./types.js";

type ContentBlock = { type: "text"; text: string } | ResourceBlock;

/**
 * Livre un fichier produit par le MCP, du bon côté de la chaîne.
 *
 * Renvoie les blocs de contenu à faire figurer dans le résultat de l'outil : un bloc
 * `resource` que le relais interceptera et retirera, ou une simple confirmation quand
 * l'écriture a eu lieu ici. Toute impossibilité est une erreur franche : mieux vaut un
 * fichier perdu qu'un fichier écrit sur la mauvaise machine.
 */
export function deliverFile(
  data: Buffer,
  mimeType: string,
  target: DeliveryTarget
): ContentBlock[] {
  const name = path.basename(target.filename);
  if (name !== target.filename || name === "." || name === "..") {
    throw new Error(
      `filename must be a bare file name, without path separators: ${target.filename}`
    );
  }
  if (data.length > RELAY_MAX_BYTES) {
    throw new Error(
      `File too large to transfer: ${data.length} bytes, the limit is ${RELAY_MAX_BYTES}.`
    );
  }

  // Le relais tourne sur la machine de l'agent et a retenu la destination : il attend les
  // octets, qu'il écrira lui-même. Écrire ici viserait le mauvais disque.
  if (target.destination_relay) {
    return [
      {
        type: "resource",
        resource: {
          uri: `file:///${name}`,
          name,
          mimeType,
          blob: data.toString("base64"),
        },
      },
    ];
  }

  // Pas de relais : le MCP tourne à côté de l'agent, son disque est le bon.
  if (!path.isAbsolute(target.destination_path)) {
    throw new Error(
      `destination_path must be an absolute directory path: ${target.destination_path}`
    );
  }
  if (
    fs.existsSync(target.destination_path) &&
    !fs.statSync(target.destination_path).isDirectory()
  ) {
    throw new Error(
      `destination_path must be a directory, but a file already exists there: ${target.destination_path}`
    );
  }
  const written = path.join(target.destination_path, name);
  if (!target.destination_overwrite && fs.existsSync(written)) {
    throw new Error(
      `Destination already exists: ${written}. Pass destination_overwrite to replace it.`
    );
  }
  fs.mkdirSync(target.destination_path, { recursive: true });
  fs.writeFileSync(written, data);

  return [{ type: "text", text: `File written to ${written} (${data.length} bytes).` }];
}

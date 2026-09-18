import type { DesignStore } from "../core/design-store.js";
import { EXPORT_FORMATS, exportDesign as render, type ExportFormat } from "../core/export.js";
import { deliverFile } from "./relay.js";
import { requireString, textResult, type FileToolResult } from "./types.js";

const MIME_BY_FORMAT: Record<string, string> = {
  html: "text/html",
  jsx: "text/jsx",
  svg: "image/svg+xml",
  json: "application/json",
  summary: "text/plain",
};

export function exportDesignTool(
  store: DesignStore,
  args: Record<string, unknown> | undefined
): FileToolResult {
  const id = requireString(args, "design_id");
  const format = (args?.format ?? "html") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    throw new Error(`Unknown format "${String(format)}". Expected one of: ${EXPORT_FORMATS.join(", ")}.`);
  }

  const design = store.get(id);
  const content = render(design, format);

  const destination = typeof args?.destination_path === "string" ? args.destination_path.trim() : "";
  if (!destination) {
    return textResult(content);
  }

  // Le fichier part vers la machine de l'agent : ici on ne fait que produire les octets,
  // `deliverFile` décide s'ils s'écrivent sur ce disque ou voyagent jusqu'au relais.
  const blocks = deliverFile(Buffer.from(content, "utf-8"), MIME_BY_FORMAT[format] ?? "text/plain", {
    destination_path: destination,
    filename: requireString(args, "filename"),
    destination_overwrite: args?.destination_overwrite === true,
    destination_relay: args?.destination_relay === true,
  });

  return {
    content: [
      {
        type: "text",
        text: `Design "${design.name}" exported as ${format} (${content.length} characters).`,
      },
      ...blocks,
    ],
  };
}

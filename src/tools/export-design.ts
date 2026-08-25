import fs from "fs";
import path from "path";
import type { DesignStore } from "../core/design-store.js";
import { EXPORT_FORMATS, exportDesign as render, type ExportFormat } from "../core/export.js";
import { requireString, textResult, type ToolResult } from "./types.js";

export function exportDesignTool(store: DesignStore, args: Record<string, unknown> | undefined): ToolResult {
  const id = requireString(args, "design_id");
  const format = (args?.format ?? "html") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    throw new Error(`Unknown format "${String(format)}". Expected one of: ${EXPORT_FORMATS.join(", ")}.`);
  }

  const design = store.get(id);
  const content = render(design, format);

  const outputPath = typeof args?.output_path === "string" ? args.output_path.trim() : "";
  if (outputPath) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    return textResult(`Design "${design.name}" exported as ${format} to ${target} (${content.length} characters).`);
  }

  return textResult(content);
}

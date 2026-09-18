/** Forme de réponse attendue par le SDK MCP pour un appel d'outil. */
export interface ToolResult {
  // Signature d'index exigée par le type de retour du SDK MCP.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

export function requireString(args: Record<string, unknown> | undefined, field: string): string {
  const value = args?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${field}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** Variante de ToolResult pour les outils qui renvoient une image (capture d'écran). */
export interface ImageToolResult {
  [key: string]: unknown;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | ResourceBlock
  >;
  isError?: boolean;
}

/** Bloc qu'un outil renvoie pour un fichier que le relais du gateway écrira chez l'agent. */
export interface ResourceBlock {
  type: "resource";
  resource: { uri: string; name: string; mimeType: string; blob: string };
}

/** Variante de ToolResult pour les outils qui peuvent livrer un fichier. */
export interface FileToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string } | ResourceBlock>;
  isError?: boolean;
}

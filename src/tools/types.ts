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

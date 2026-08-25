import path from "path";

/**
 * Répertoire des logs : MCP_LOG_DIR s'il est renseigné, sinon <racine>/.design-data/logs.
 * Lu depuis process.env uniquement (le .env du package est chargé après l'init du
 * logger), donc la variable doit venir de la config du client MCP.
 */
export function resolveLogDir(rootDir: string): string {
  const configured = process.env.MCP_LOG_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(rootDir, ".design-data", "logs");
}

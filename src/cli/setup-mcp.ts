import fs from "fs";
import path from "path";

const SERVER_NAME = "mcp-design";
const PACKAGE_NAME = "@imenam/mcp-design";

/** Slashes POSIX : évite les backslashes échappés dans le JSON, et Node les accepte sous Windows. */
function toPosixPath(dir: string): string {
  return dir.replace(/\\/g, "/");
}

/** "mcp-design" -> "Mcp-design" */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "mon_projet-web" -> "Mon Projet Web" */
function toDisplayName(folder: string): string {
  return folder.split(/[-_]+/).filter(Boolean).map(capitalize).join(" ");
}

/**
 * Valeurs volontairement vides : chaque variable est inactive tant qu'elle n'est
 * pas remplie (PROXY_URL vide = GUI désactivée), donc le fichier généré est
 * utilisable tel quel, jamais à moitié cassé.
 */
function buildServerEntry(codeRoot: string) {
  const folder = path.basename(codeRoot) || "design";
  return {
    command: "npx",
    args: ["-y", PACKAGE_NAME],
    env: {
      PROXY_URL: "http://localhost:",
      APP_GROUP: capitalize(folder),
      APP_NAME: `Design ${toDisplayName(folder)}`,
      APP_PATH: `/design-${folder}`,
      MCP_DESIGN_DATA_DIR: toPosixPath(path.join(codeRoot, ".design-data")),
      MCP_LOG_DIR: "",
    },
  };
}

const GENERATED_VARS = [
  ["PROXY_URL", "URL du proxy pour exposer la GUI (compléter le port)"],
  ["APP_GROUP", "groupe d'affichage dans le dashboard du proxy"],
  ["APP_NAME", "nom affiché de la GUI dans le dashboard du proxy"],
  ["APP_PATH", "chemin de montage de la GUI derrière le proxy"],
  ["MCP_DESIGN_DATA_DIR", "répertoire de stockage des designs (pré-rempli)"],
  ["MCP_LOG_DIR", "répertoire des logs (défaut : <data>/logs)"],
];

export interface SetupMcpOptions {
  cwd: string;
  force: boolean;
}

export function runSetupMcp({ cwd, force }: SetupMcpOptions): number {
  const target = path.join(cwd, ".mcp.json");

  let config: any = {};
  const exists = fs.existsSync(target);

  if (exists) {
    const raw = fs.readFileSync(target, "utf-8").trim();
    if (raw !== "") {
      try {
        config = JSON.parse(raw);
      } catch (err: any) {
        console.error(`Erreur : ${target} contient du JSON invalide (${err.message}).`);
        console.error("Corrigez le fichier ou supprimez-le, puis relancez la commande.");
        return 1;
      }
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      console.error(`Erreur : ${target} ne contient pas un objet JSON.`);
      return 1;
    }
  }

  if (typeof config.mcpServers !== "object" || config.mcpServers === null || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }

  const alreadyPresent = Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME);
  if (alreadyPresent && !force) {
    console.error(`Le serveur "${SERVER_NAME}" est déjà configuré dans ${target}.`);
    console.error("Relancez avec --force pour écraser cette entrée (les autres serveurs sont préservés).");
    return 1;
  }

  config.mcpServers[SERVER_NAME] = buildServerEntry(cwd);

  fs.writeFileSync(target, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const action = alreadyPresent ? "remplacée" : exists ? "ajoutée" : "créée";
  console.log(`Configuration ${SERVER_NAME} ${action} dans ${target}`);
  console.log("");
  console.log('À compléter dans le champ "env" :');
  for (const [name, description] of GENERATED_VARS) {
    console.log(`  ${name.padEnd(24)} ${description}`);
  }
  console.log("");
  console.log("Une variable laissée vide est simplement inactive.");

  return 0;
}

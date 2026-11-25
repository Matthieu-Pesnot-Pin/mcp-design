/**
 * Ce que `--migrate-to-manager` sait de mcp-design : ses variables et la copie
 * de son dossier de stockage (cf. `manager-bundle.ts`).
 *
 * La copie reprend les designs, la médiathèque et les remarques avec leurs
 * captures. Chaque design et le fichier des remarques sont copiés sous le
 * verrou qu'utilisent leurs écrivains, donc dans un état cohérent même serveur
 * lancé ; les captures sont copiées sous le verrou des remarques. Les journaux,
 * les fichiers temporaires et les verrous ne sont pas repris.
 */
import fs from "node:fs";
import path from "node:path";
import { APP_VERSION } from "../version.js";
import { withFileLock } from "../core/file-lock.js";
import { copyTree, runManagerExport, type ManagerExportSpec } from "./manager-bundle.js";

const SPECIAL_DIRECTORIES = new Set(["designs", "feedback", "logs"]);
const TRANSIENT_FILE = /\.(tmp|lock)$/;

function copyDesigns(source: string, target: string): void {
  const dir = path.join(source, "designs");
  if (!fs.existsSync(dir)) return;
  const out = path.join(target, "designs");
  fs.mkdirSync(out, { recursive: true });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    withFileLock(`${file}.lock`, `Design "${entry.name.slice(0, -".json".length)}"`, () => {
      // Un design supprimé entre la lecture du dossier et la prise du verrou n'est pas repris.
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(out, entry.name));
    });
  }
}

function copyFeedback(source: string, target: string): void {
  const dir = path.join(source, "feedback");
  if (!fs.existsSync(dir)) return;
  const out = path.join(target, "feedback");
  fs.mkdirSync(out, { recursive: true });
  const remarks = path.join(dir, "remarks.json");
  withFileLock(`${remarks}.lock`, "The remarks file", () => {
    copyTree(dir, out, (relative) => TRANSIENT_FILE.test(relative));
  });
}

/**
 * Les designs passent avant la médiathèque : une image est enregistrée avant le
 * design qui la référence, donc toute image citée par un design copié est déjà
 * présente quand la médiathèque est copiée à son tour.
 */
async function copyData(source: string, target: string): Promise<void> {
  copyDesigns(source, target);
  copyFeedback(source, target);
  copyTree(source, target, (relative, isDirectory) => {
    if (TRANSIENT_FILE.test(relative)) return true;
    return !relative.includes("/") && isDirectory && SPECIAL_DIRECTORIES.has(relative);
  });
}

const spec: ManagerExportSpec = {
  packageName: "@imenam/mcp-design",
  packageVersion: APP_VERSION,
  legacyStorageKeys: ["MCP_DESIGN_DATA_DIR", "MCP_DATA_DIR"],
  droppedKeys: ["GUI_NAME"],
  copyData,
};

export function runMigrateToManager(argv: string[], cwd: string): Promise<number> {
  return runManagerExport(argv, cwd, spec);
}

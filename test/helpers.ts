import fs from "fs";
import os from "os";
import path from "path";
import { DesignStore } from "../src/core/design-store.js";

/**
 * Chaque test travaille sur un répertoire de données neuf : MCP_DESIGN_DATA_DIR
 * est lu dans le constructeur du store, donc il doit être positionné avant.
 */
export function makeStore(): { store: DesignStore; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-test-"));
  const previous = process.env.MCP_DESIGN_DATA_DIR;
  process.env.MCP_DESIGN_DATA_DIR = dir;
  const store = new DesignStore(dir);

  return {
    store,
    dir,
    cleanup: () => {
      if (previous === undefined) delete process.env.MCP_DESIGN_DATA_DIR;
      else process.env.MCP_DESIGN_DATA_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

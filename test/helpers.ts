import fs from "fs";
import os from "os";
import path from "path";
import { DesignStore } from "../src/core/design-store.js";

/** Store sur un répertoire de données neuf, supprimé par `cleanup`. */
export function makeStore(): { store: DesignStore; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-test-"));
  const store = new DesignStore(dir);

  return {
    store,
    dir,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

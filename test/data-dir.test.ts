import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "../src/core/data-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "../src/index.js");

test("resolveDataDir throws when DATA_DIR is missing or blank", () => {
  assert.throws(() => resolveDataDir({}), /DATA_DIR is not set/);
  assert.throws(() => resolveDataDir({ DATA_DIR: "   " }), /DATA_DIR is not set/);
});

test("resolveDataDir resolves DATA_DIR and creates the folder", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-design-datadir-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "nested", "data");

  const dataDir = resolveDataDir({ DATA_DIR: `  ${target}  ` });

  assert.equal(dataDir, path.resolve(target));
  assert.ok(fs.statSync(dataDir).isDirectory());
});

test("the server refuses to start without DATA_DIR", () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DATA_DIR;
  delete env.PROXY_URL;
  delete env.APP_PORT;

  const result = spawnSync(process.execPath, [SERVER_ENTRY], { env, input: "", encoding: "utf-8", timeout: 15000 });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATA_DIR is not set/);
});

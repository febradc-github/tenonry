import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./docs.mjs";

export const script = (name) => path.join(repoRoot, "scripts", name);

// Runs a node script with optional stdin text; returns { status, stdout, stderr, json }.
export function runNode(file, args = [], { input, cwd, env } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

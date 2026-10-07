import { spawn, spawnSync } from "node:child_process";
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

// Like runNode, but without blocking the event loop, for tests that serve HTTP from the test process.
export function runNodeAsync(file, args = [], { input, cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      resolve({ status, stdout, stderr, json });
    });
    child.stdin.end(input ?? "");
  });
}

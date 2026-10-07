#!/usr/bin/env node
import path from "node:path";
import { readStdinJson } from "./lib/json.mjs";
import { readJson } from "./lib/json.mjs";
import { findProjectRoot, relResolved } from "./lib/paths.mjs";
import { loadRules, resolveOwner, ownerAllows } from "./lib/ownership.mjs";
import { isMain } from "./lib/main.mjs";

const PREFIX = "tenonry ownership guard:";

// Returns the message that blocks the edit, or null when the agent may edit the file.
export function verdict(input, agentName, env = process.env) {
  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof target !== "string" || target === "") return null;
  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return null;

  const relPath = relResolved(root, path.resolve(cwd, target));
  if (relPath === null) return `${PREFIX} ${target} is outside the project and must not be edited by agents.`;

  const activeRun = readJson(path.join(root, ".tenonry", "state.json"), {}).activeRun ?? null;
  const resolved = resolveOwner(loadRules(root, activeRun), relPath);
  if (resolved && ownerAllows(resolved.owner, agentName)) return null;
  if (!resolved) {
    return `${PREFIX} ${relPath} has no owner. Add a handoff with status needs_owner to your report and continue with your own files.`;
  }
  if (resolved.owner === "none") return `${PREFIX} ${relPath} is protected and must not be edited by agents.`;
  const owner = Array.isArray(resolved.owner) ? resolved.owner.join(", ") : resolved.owner;
  return `${PREFIX} ${relPath} is owned by ${owner}. Do not edit it. Add a handoff for it to your report (reason and suggestedOwner) and continue with your own files.`;
}

async function main() {
  const agentName = process.argv[2] ?? "";
  try {
    const message = verdict(await readStdinJson(), agentName);
    if (message) {
      process.stderr.write(message + "\n");
      return 2;
    }
    return 0;
  } catch {
    process.stderr.write("tenonry ownership guard: internal error, allowing\n");
    return 0;
  }
}

if (isMain(import.meta.url)) main().then((code) => { process.exitCode = code; });

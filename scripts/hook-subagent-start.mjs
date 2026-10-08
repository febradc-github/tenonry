#!/usr/bin/env node
import { readStdinJson, printResult } from "./lib/json.mjs";
import { findProjectRoot } from "./lib/paths.mjs";
import { loadConfig } from "./lib/config.mjs";
import { buildMap, receivesMap } from "./lib/map.mjs";
import { isMain } from "./lib/main.mjs";

// Gives Tenonry's code-facing agents the codebase map before their first turn (docs/03 section 8.6).
export function subagentContext(input, env = process.env) {
  if (!receivesMap(input?.agent_type)) return null;
  const root = findProjectRoot(input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return null;
  const { codebaseMap } = loadConfig(root);
  if (codebaseMap.enabled === false) return null;
  const map = buildMap(root, { maxChars: codebaseMap.maxChars });
  if (!map) return null;
  return { hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: map } };
}

async function main() {
  try {
    const output = subagentContext(await readStdinJson());
    if (output) printResult(output);
  } catch {
    // fail open
  }
}

if (isMain(import.meta.url)) main();

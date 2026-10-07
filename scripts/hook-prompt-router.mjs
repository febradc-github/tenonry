#!/usr/bin/env node
import { readStdinJson, printResult } from "./lib/json.mjs";
import { findProjectRoot } from "./lib/paths.mjs";
import { newRun } from "./lib/state.mjs";
import { currentModelFamily, runIntake } from "./lib/routing.mjs";
import { isMain } from "./lib/main.mjs";

const COMMAND_PREFIX = /^\s*\/tenonry:run\b/;
const SKILL_MARKER = "TENONRY_RUN_SKILL";
const EXPANDED_INPUT = /The user's input is: ([\s\S]*?)\n\s*\n## Rules/;
const PASSIVE_ARGUMENTS = new Set(["", "resume", "continue", "undo", "help", "status"]);

// The request text, or null when the prompt is not a new /tenonry:run request (decision D-039 covers
// the expanded-skill shape in case Claude Code hands the hook the skill body instead of the typed text).
export function extractRequest(prompt) {
  if (typeof prompt !== "string") return null;
  let request;
  if (COMMAND_PREFIX.test(prompt)) {
    request = prompt.replace(COMMAND_PREFIX, "").trim();
  } else if (prompt.includes(SKILL_MARKER)) {
    request = (EXPANDED_INPUT.exec(prompt)?.[1] ?? "").trim();
  } else {
    return null;
  }
  return PASSIVE_ARGUMENTS.has(request.toLowerCase()) ? null : request;
}

// Never blocks: any problem returns null and the run skill falls back to `new-run` plus `intake`.
export async function route(input, env = process.env) {
  const request = extractRequest(input?.prompt);
  if (request === null) return null;
  const root = findProjectRoot(input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return null;

  const family = currentModelFamily(input);
  const { runId } = newRun(root, request);
  const route = await runIntake(root, runId, request, family);
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `TENONRY_ROUTE run=${runId} clarify=${route.clarify} route=.tenonry/runs/${runId}/route.json`,
    },
  };
}

async function main() {
  try {
    const output = await route(await readStdinJson());
    if (output) printResult(output);
  } catch {
    // fail open
  }
}

if (isMain(import.meta.url)) main();

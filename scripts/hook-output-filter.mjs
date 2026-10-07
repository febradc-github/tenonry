#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readStdinJson, printResult } from "./lib/json.mjs";
import { findProjectRoot } from "./lib/paths.mjs";
import { loadConfig } from "./lib/config.mjs";
import { isMain } from "./lib/main.mjs";

const MAX_COMMAND_LENGTH = 500;
const SHELL_METACHARACTERS = /[;&|<>`\n]|\$\(/;
const BUILT_IN_PATTERNS = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|type-check|check|build)(\s|$)/,
  /^(npx|pnpm\s+exec|yarn|bunx)\s+(vitest|jest|tsc|eslint|playwright\s+test)(\s|$)/,
  /^(php\s+artisan\s+test|\.\/vendor\/bin\/(phpunit|pest|phpstan|pint))(\s|$)/,
  /^(pytest|python3?\s+-m\s+pytest|mypy|ruff\s+check)(\s|$)/,
  /^go\s+(test|vet|build)(\s|$)/,
  /^cargo\s+(test|check|build|clippy)(\s|$)/,
  /^(bundle\s+exec\s+(rspec|rubocop)|bin\/rails\s+test)(\s|$)/,
  /^mix\s+(test|compile)(\s|$)/,
  /^dotnet\s+(test|build)(\s|$)/,
  /^(mvn|\.\/gradlew|gradle)\s+/,
  /^(flutter\s+(test|analyze)|dart\s+(test|analyze))(\s|$)/,
];

function extraPatterns(config) {
  const patterns = [];
  for (const source of config.outputFilter.extraCommands) {
    try {
      patterns.push(new RegExp(source));
    } catch {
      // an invalid user regex is ignored
    }
  }
  return patterns;
}

export function labelFor(command) {
  return command
    .split(/\s+/)
    .slice(0, 2)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const quoteDouble = (text) => `"${text.replace(/(["\\$`])/g, "\\$1")}"`;

export function rewriteCommand(root, cwd, command) {
  const script = path.join(root, ".tenonry", "bin", "exec-filter.mjs");
  const b64 = Buffer.from(command, "utf8").toString("base64");
  return `node ${quoteDouble(script)} --label ${labelFor(command)} --cwd ${quoteDouble(cwd)} --b64 ${b64}`;
}

export function decide(input, env = process.env) {
  const toolInput = input?.tool_input;
  const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
  if (!command || command.length > MAX_COMMAND_LENGTH) return null;
  if (command.includes("exec-filter.mjs") || SHELL_METACHARACTERS.test(command)) return null;

  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);
  if (!root || !fs.existsSync(path.join(root, ".tenonry", "bin", "exec-filter.mjs"))) return null;

  const patterns = [...BUILT_IN_PATTERNS, ...extraPatterns(loadConfig(root))];
  if (!patterns.some((pattern) => pattern.test(command))) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "tenonry: verification command routed through output filter",
      updatedInput: { ...toolInput, command: rewriteCommand(root, cwd, command) },
    },
  };
}

async function main() {
  const input = await readStdinJson();
  const output = decide(input);
  if (output) printResult(output);
}

if (isMain(import.meta.url)) main().catch(() => {});

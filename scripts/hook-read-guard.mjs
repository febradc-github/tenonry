#!/usr/bin/env node
import path from "node:path";
import { readStdinJson, printResult } from "./lib/json.mjs";
import { findProjectRoot, rel } from "./lib/paths.mjs";
import { loadConfig } from "./lib/config.mjs";
import { isMain } from "./lib/main.mjs";
import { matchGlob } from "./lib/glob.mjs";

export const LOCKFILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "composer.lock", "Cargo.lock",
  "poetry.lock", "Gemfile.lock", "go.sum", "mix.lock", "pubspec.lock", "uv.lock",
];
const BUILD_DIRECTORIES = ["dist", "build", ".next", ".nuxt", ".output", ".svelte-kit", "out", "coverage", "target"];
const VENDORED_DIRECTORIES = ["node_modules", "vendor"];

// Returns { category, advice } for a project-relative path, or null when the read is fine.
export function classify(relPath, config) {
  if (config.readGuard.allow.some((glob) => matchGlob(glob, relPath))) return null;

  const segments = relPath.split("/");
  const base = segments.at(-1);
  const directories = segments.slice(0, -1);

  if (LOCKFILES.includes(base)) {
    return { category: "a lockfile", advice: "Read the manifest (package.json, composer.json, ...) or run the package manager's list command instead." };
  }
  // Decision D-016: library source inside node_modules and vendor may be read, even from a dist directory.
  const vendored = directories.some((segment) => VENDORED_DIRECTORIES.includes(segment));
  if (!vendored && directories.some((segment) => BUILD_DIRECTORIES.includes(segment))) {
    return { category: "build output", advice: "This is generated output. Read the source file instead." };
  }
  if (/\.min\.(js|css)$/.test(base)) return { category: "minified", advice: "Read the unminified source instead." };
  if (base.endsWith(".map")) return { category: "a source map", advice: "Source maps are generated. Read the source instead." };
  if (config.readGuard.extraDeny.some((glob) => matchGlob(glob, relPath))) {
    return { category: "denied by project settings", advice: "Blocked by project read guard settings." };
  }
  return null;
}

export function decide(input, env = process.env) {
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath === "") return null;
  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return null;

  const relPath = rel(root, path.resolve(cwd, filePath));
  if (!relPath) return null;
  const verdict = classify(relPath, loadConfig(root));
  if (!verdict) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `tenonry read guard: ${relPath} is ${verdict.category}. ${verdict.advice}`,
    },
  };
}

async function main() {
  const output = decide(await readStdinJson());
  if (output) printResult(output);
}

if (isMain(import.meta.url)) main().catch(() => {});

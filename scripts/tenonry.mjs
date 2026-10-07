#!/usr/bin/env node
import { parseArgs } from "./lib/args.mjs";
import { printResult } from "./lib/json.mjs";
import { findProjectRoot } from "./lib/paths.mjs";
import { COMMANDS } from "./lib/commands.mjs";
import { CliError } from "./lib/ctx.mjs";

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const command = COMMANDS[name];
  if (!command) {
    printResult({ ok: false, error: `unknown_command: ${name ?? ""}` });
    return 1;
  }
  const { positional, flags } = parseArgs(rest);
  const cwd = process.cwd();
  const root = findProjectRoot(process.env.CLAUDE_PROJECT_DIR || cwd) ?? findProjectRoot(cwd);
  if (command.needsProject !== false && !root) {
    printResult({ ok: false, error: "no_tenonry_project" });
    return 1;
  }
  try {
    const result = await command.run({ args: positional, flags, root, cwd });
    printResult(result.ok === undefined ? { ok: true, ...result } : result);
    return result.fatal ? 1 : 0;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    printResult({ ok: false, error: error.message });
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    printResult({ ok: false, error: String(error?.message ?? error) });
    process.exitCode = 1;
  },
);

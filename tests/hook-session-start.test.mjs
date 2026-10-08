import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { repoRoot } from "./helpers/docs.mjs";

test("session start prints the plugin root as additional context", () => {
  const result = runNode(script("hook-session-start.mjs"), [], { input: "{}" });
  assert.equal(result.status, 0);
  assert.deepEqual(result.json, {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `TENONRY_PLUGIN_ROOT=${repoRoot}` },
  });
});

test("session start runs without any stdin", () => {
  const result = runNode(script("hook-session-start.mjs"), []);
  assert.equal(result.status, 0);
  assert.match(result.json.hookSpecificOutput.additionalContext, /^TENONRY_PLUGIN_ROOT=\//);
});

test("hooks.json parses and references existing scripts", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks", "hooks.json"), "utf8"));
  const commands = Object.values(config.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.equal(commands.length, 5);
  for (const command of commands) {
    const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts\/[\w.-]+)/.exec(command);
    assert.ok(match, command);
    assert.ok(fs.existsSync(path.join(repoRoot, match[1])), match[1]);
  }
});

test("hooks.json uses the documented events, matchers, and second-based timeouts", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks", "hooks.json"), "utf8")).hooks;
  assert.deepEqual(Object.keys(config), ["SessionStart", "UserPromptSubmit", "SubagentStart", "PreToolUse"]);
  assert.deepEqual(config.SubagentStart.map((g) => g.matcher), ["^tenonry-"]);
  assert.deepEqual(config.PreToolUse.map((g) => g.matcher), ["Bash", "Read"]);
  for (const group of Object.values(config).flat()) {
    for (const hook of group.hooks) {
      assert.equal(hook.type, "command");
      assert.ok(hook.timeout > 0 && hook.timeout <= 15);
    }
  }
});

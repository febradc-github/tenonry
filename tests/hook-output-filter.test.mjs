import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { makeProject } from "./helpers/project.mjs";

const hook = script("hook-output-filter.mjs");

function run(root, command, extra = {}) {
  const input = { cwd: root, session_id: "s", tool_name: "Bash", tool_input: { command, description: "d", timeout: 5000, ...extra } };
  return runNode(hook, [], { input: JSON.stringify(input), cwd: root });
}

const rewritten = [
  "npm test",
  "pnpm exec vitest run",
  "php artisan test",
  "pytest -q",
  "go test ./...",
  "yarn lint",
  "./vendor/bin/pint --test",
  "cargo test",
  "mvn -q test",
  "flutter analyze",
];

for (const command of rewritten) {
  test(`rewrites ${command}`, () => {
    const root = makeProject();
    const result = run(root, command);
    assert.equal(result.status, 0);
    const out = result.json.hookSpecificOutput;
    assert.equal(out.hookEventName, "PreToolUse");
    assert.equal(out.permissionDecision, "allow");
    const updated = out.updatedInput.command;
    assert.ok(updated.startsWith(`node "${path.join(root, ".tenonry", "bin", "exec-filter.mjs")}" --label `));
    assert.ok(updated.includes(`--cwd "${root}"`));
    const b64 = /--b64 (\S+)$/.exec(updated)[1];
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), command);
  });
}

test("keeps the full original tool_input and changes only command", () => {
  const root = makeProject();
  const out = run(root, "npm test").json.hookSpecificOutput;
  assert.equal(out.updatedInput.description, "d");
  assert.equal(out.updatedInput.timeout, 5000);
  assert.deepEqual(Object.keys(out.updatedInput).sort(), ["command", "description", "timeout"]);
});

test("derives a label from the first two tokens", () => {
  const root = makeProject();
  const updated = run(root, "pnpm exec vitest run").json.hookSpecificOutput.updatedInput.command;
  assert.match(updated, /--label pnpm-exec /);
});

for (const command of ["npm test; rm -rf x", "npm test && npm run lint", "npm test | tee out", "npm test > out.txt", "npm test `id`", "npm test $(id)", "npm test\nls"]) {
  test(`skips commands with shell metacharacters: ${JSON.stringify(command)}`, () => {
    const result = run(makeProject(), command);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });
}

test("skips unknown commands and install commands", () => {
  const root = makeProject();
  for (const command of ["ls -la", "npm install", "git status", "cat package.json", "npm run dev"]) {
    assert.equal(run(root, command).stdout, "", command);
  }
});

test("skips commands that are already wrapped", () => {
  const root = makeProject();
  const wrapped = `node ${root}/.tenonry/bin/exec-filter.mjs --label x --cwd ${root} --b64 abc`;
  assert.equal(run(root, wrapped).stdout, "");
});

test("skips overly long commands", () => {
  const root = makeProject();
  assert.equal(run(root, "npm test " + "a".repeat(600)).stdout, "");
});

test("skips when the project has no .tenonry/config.json", () => {
  const dir = makeProject();
  const outside = path.join(dir, "..", path.basename(dir) + "-plain");
  const result = runNode(hook, [], { input: JSON.stringify({ cwd: outside, tool_input: { command: "npm test" } }) });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("skips when exec-filter has not been installed in the project", () => {
  const root = makeProject({ bin: false });
  assert.equal(run(root, "npm test").stdout, "");
});

test("honors config.outputFilter.extraCommands and ignores invalid regexes", () => {
  const root = makeProject({ config: { outputFilter: { maxLines: 120, extraCommands: ["^make check", "("] } } });
  assert.ok(run(root, "make check").json);
  assert.equal(run(root, "make clean").stdout, "");
});

test("fails open on invalid input", () => {
  for (const input of ["", "not json", "{}", '{"tool_input":{}}']) {
    const result = runNode(hook, [], { input });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  }
});

test("a rewritten command runs end to end through exec-filter", () => {
  const root = makeProject();
  const updated = run(root, "pytest -q").json.hookSpecificOutput.updatedInput.command;
  assert.match(updated, /exec-filter\.mjs/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runNode } from "./helpers/run.mjs";
import { makeProject } from "./helpers/project.mjs";
import { filterLines } from "../scripts/exec-filter.mjs";

function runFilter(root, command, label = "test-cmd") {
  const bin = path.join(root, ".tenonry", "bin", "exec-filter.mjs");
  return runNode(bin, ["--label", label, "--cwd", root, "--b64", Buffer.from(command).toString("base64")], { cwd: root });
}

test("preserves exit codes 0, 1, and 7", () => {
  const root = makeProject();
  for (const code of [0, 1, 7]) {
    const result = runFilter(root, `exit ${code}`);
    assert.equal(result.status, code);
    assert.match(result.stdout, new RegExp(`^\\[tenonry\\] test-cmd exit=${code} log=\\.tenonry/logs/exec/`));
  }
});

test("writes the full log to .tenonry/logs/exec", () => {
  const root = makeProject();
  const result = runFilter(root, "i=1; while [ $i -le 300 ]; do echo line-$i; i=$((i+1)); done");
  const logRel = /log=(\S+)/.exec(result.stdout)[1];
  const log = fs.readFileSync(path.join(root, logRel), "utf8");
  assert.equal(log.trimEnd().split("\n").length, 300);
  assert.ok(log.includes("line-1\n"));
});

test("success prints the header and the last 5 lines", () => {
  const root = makeProject();
  const result = runFilter(root, "for i in 1 2 3 4 5 6 7 8; do echo ok-$i; done");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.slice(1), ["ok-4", "ok-5", "ok-6", "ok-7", "ok-8"]);
});

test("failure prints failure lines plus the last 15 lines", () => {
  const root = makeProject();
  const script = [
    "i=1; while [ $i -le 100 ]; do echo noise-$i; i=$((i+1)); done",
    "echo 'FAIL tests/a.test.js'",
    "echo '  expected 1 got 2'",
    "i=1; while [ $i -le 40 ]; do echo tail-$i; i=$((i+1)); done",
    "exit 1",
  ].join("; ");
  const result = runFilter(root, script);
  assert.equal(result.status, 1);
  const lines = result.stdout.trimEnd().split("\n");
  assert.ok(lines.includes("FAIL tests/a.test.js"));
  assert.ok(lines.includes("  expected 1 got 2"));
  assert.ok(!lines.includes("noise-50"));
  assert.deepEqual(lines.slice(-15), Array.from({ length: 15 }, (_, i) => `tail-${26 + i}`));
});

test("failure output is capped at maxLines", () => {
  const root = makeProject({ config: { outputFilter: { maxLines: 40, extraCommands: [] } } });
  const result = runFilter(root, "i=1; while [ $i -le 500 ]; do echo \"Error number $i\"; i=$((i+1)); done; exit 3");
  assert.equal(result.status, 3);
  assert.ok(result.stdout.trimEnd().split("\n").length <= 40);
});

test("deduplicates repeated failure lines", () => {
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push("Error: same message");
  for (let i = 0; i < 30; i++) lines.push(`tail-${i}`);
  const filtered = filterLines(lines, 1, 120);
  assert.equal(filtered.filter((l) => l === "Error: same message").length, 1);
});

test("merges stderr into the output", () => {
  const root = makeProject();
  const result = runFilter(root, "echo to-stderr 1>&2; exit 2");
  assert.ok(result.stdout.includes("to-stderr"));
});

test("a missing command exits non-zero", () => {
  const root = makeProject();
  const result = runFilter(root, "definitely-not-a-command-xyz");
  assert.notEqual(result.status, 0);
});

test("a missing --b64 argument exits 2 with a message on stderr", () => {
  const root = makeProject();
  const result = runNode(path.join(root, ".tenonry", "bin", "exec-filter.mjs"), ["--label", "x"], { cwd: root });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing --b64/);
});

test("outside a Tenonry project the log goes to the temp directory", () => {
  const dir = makeProject({ bin: false });
  fs.rmSync(path.join(dir, ".tenonry"), { recursive: true });
  const script = path.join(makeProject(), ".tenonry", "bin", "exec-filter.mjs");
  const result = runNode(script, ["--label", "x", "--cwd", dir, "--b64", Buffer.from("echo hi").toString("base64")], { cwd: dir });
  assert.equal(result.status, 0);
  const log = /log=(\S+)/.exec(result.stdout)[1];
  assert.ok(path.isAbsolute(log));
  assert.ok(fs.existsSync(log));
});

test("strips ANSI color codes from printed output only", () => {
  const root = makeProject();
  const result = runFilter(root, "printf '\\033[31mred\\033[0m\\n'");
  assert.ok(result.stdout.includes("red"));
  assert.ok(!result.stdout.includes("\u001b"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { fixtureCopy, runInit, tempDir } from "./helpers/project.mjs";

const guard = script("hook-ownership-guard.mjs");

function edit(root, agent, file, tool = "Edit") {
  const target = path.isAbsolute(file) ? file : path.join(root, file);
  const input = { cwd: root, tool_name: tool, tool_input: tool === "NotebookEdit" ? { notebook_path: target } : { file_path: target } };
  return runNode(guard, [agent], { input: JSON.stringify(input), cwd: root });
}

function project() {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  return root;
}

test("allows an owned file", () => {
  const root = project();
  const result = edit(root, "tenonry-laravel", "app/Http/Controllers/HomeController.php");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("blocks another owner's file with the exact message", () => {
  const root = project();
  const result = edit(root, "tenonry-laravel", "app/Models/User.php");
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "tenonry ownership guard: app/Models/User.php is owned by tenonry-eloquent. Do not edit it. Add a handoff for it to your report (reason and suggestedOwner) and continue with your own files.\n",
  );
});

test("blocks protected files (owner none)", () => {
  const root = project();
  for (const file of [".env", "composer.lock", ".tenonry/config.json", ".claude/agents/tenonry-vue.md"]) {
    const result = edit(root, "tenonry-vue", file);
    assert.equal(result.status, 2, file);
    assert.equal(result.stderr, `tenonry ownership guard: ${file} is protected and must not be edited by agents.\n`);
  }
});

test("blocks unowned files with a needs_owner hint", () => {
  const root = project();
  const result = edit(root, "tenonry-laravel", "docs/guide.xyz");
  assert.equal(result.status, 2);
  assert.equal(
    result.stderr,
    "tenonry ownership guard: docs/guide.xyz has no owner. Add a handoff with status needs_owner to your report and continue with your own files.\n",
  );
});

test("shared files (owner *) are allowed for every agent", () => {
  const root = project();
  assert.equal(edit(root, "tenonry-vue", "composer.json").status, 0);
  assert.equal(edit(root, "tenonry-eloquent", ".gitignore").status, 0);
});

test("only the test author may edit tests", () => {
  const root = project();
  assert.equal(edit(root, "tenonry-test-author", "tests/Feature/ExampleTest.php").status, 0);
  assert.equal(edit(root, "tenonry-laravel", "tests/Feature/ExampleTest.php").status, 2);
});

test("core agents own their files", () => {
  const root = project();
  assert.equal(edit(root, "tenonry-planner", ".tenonry/runs/r-1/plan.md").status, 0);
  assert.equal(edit(root, "tenonry-art-director", ".tenonry/design-direction.md").status, 0);
  assert.equal(edit(root, "tenonry-planner", ".tenonry/design-direction.md").status, 2);
  assert.equal(edit(root, "tenonry-review-vue", ".tenonry/runs/r-1/reviews/T1.code.json").status, 0);
  assert.equal(edit(root, "tenonry-design-reviewer", ".tenonry/runs/r-1/reviews/T1-home-375.png").status, 0);
  assert.equal(edit(root, "tenonry-vue", ".tenonry/runs/r-1/reviews/T1.code.json").status, 2);
  assert.equal(edit(root, "tenonry-vue", ".tenonry/runs/r-1/reports/T1.json").status, 0);
});

test("honors run-scoped rules for the active run", () => {
  const root = project();
  fs.mkdirSync(path.join(root, ".tenonry", "runs", "r-1"), { recursive: true });
  fs.writeFileSync(path.join(root, ".tenonry", "state.json"), JSON.stringify({ activeRun: "r-1" }));
  fs.writeFileSync(
    path.join(root, ".tenonry", "runs", "r-1", "owner-rules.json"),
    JSON.stringify({ version: 1, rules: [{ glob: "src/new.xyz", owner: "tenonry-vue", priority: 950, source: "jev:r-1" }] }),
  );
  assert.equal(edit(root, "tenonry-vue", "src/new.xyz").status, 0);
  assert.equal(edit(root, "tenonry-laravel", "src/new.xyz").status, 2);
});

test("blocks paths outside the project", () => {
  const root = project();
  const result = edit(root, "tenonry-vue", "/etc/hosts");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is outside the project/);
});

test("checks notebook_path as well as file_path", () => {
  const root = project();
  assert.equal(edit(root, "tenonry-vue", ".env", "NotebookEdit").status, 2);
});

test("exits 0 when no project config exists, no path is given, or the input is invalid", () => {
  const plain = tempDir();
  const outside = runNode(guard, ["tenonry-vue"], { input: JSON.stringify({ cwd: plain, tool_input: { file_path: path.join(plain, ".env") } }) });
  assert.equal(outside.status, 0);
  const root = project();
  assert.equal(runNode(guard, ["tenonry-vue"], { input: JSON.stringify({ cwd: root, tool_input: {} }) }).status, 0);
  assert.equal(runNode(guard, ["tenonry-vue"], { input: "not json" }).status, 0);
  assert.equal(runNode(guard, ["tenonry-vue"], { input: "" }).status, 0);
});

test("works when run from the project's installed bin copy", () => {
  const root = project();
  const input = { cwd: root, tool_input: { file_path: path.join(root, "app/Models/User.php") } };
  const result = runNode(path.join(root, ".tenonry", "bin", "hook-ownership-guard.mjs"), ["tenonry-eloquent"], { input: JSON.stringify(input) });
  assert.equal(result.status, 0);
});

test("recognizes the project when the session path and the file path differ by a symlink", () => {
  const root = project();
  const link = path.join(tempDir(), "linked-project");
  fs.symlinkSync(root, link);
  const input = (agent, file) => runNode(guard, [agent], { input: JSON.stringify({ cwd: link, tool_input: { file_path: file } }) });
  assert.equal(input("tenonry-eloquent", path.join(root, "app/Models/User.php")).status, 0);
  const blocked = input("tenonry-laravel", path.join(root, "app/Models/User.php"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^tenonry ownership guard: app\/Models\/User\.php is owned by tenonry-eloquent\./);
  assert.equal(input("tenonry-eloquent", path.join(root, "app/Models/NotYetCreated.php")).status, 0, "new files resolve too");
  assert.equal(input("tenonry-vue", "/etc/hosts").status, 2, "paths outside stay outside");
});

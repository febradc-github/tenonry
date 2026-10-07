import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { makeProject } from "./helpers/project.mjs";

const hook = script("hook-read-guard.mjs");

function read(root, file, cwd = root) {
  const input = { cwd, tool_name: "Read", tool_input: { file_path: path.isAbsolute(file) ? file : path.join(root, file) } };
  return runNode(hook, [], { input: JSON.stringify(input), cwd: root });
}

function assertDenied(result, relPath, category, advice) {
  assert.equal(result.status, 0);
  const out = result.json.hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "deny");
  assert.equal(out.permissionDecisionReason, `tenonry read guard: ${relPath} is ${category}. ${advice}`);
}

test("denies lockfiles", () => {
  const root = makeProject();
  const advice = "Read the manifest (package.json, composer.json, ...) or run the package manager's list command instead.";
  assertDenied(read(root, "package-lock.json"), "package-lock.json", "a lockfile", advice);
  assertDenied(read(root, "api/composer.lock"), "api/composer.lock", "a lockfile", advice);
  assertDenied(read(root, "go.sum"), "go.sum", "a lockfile", advice);
});

test("denies build output directories", () => {
  const root = makeProject();
  for (const file of ["dist/app.js", "web/.next/server/page.js", "build/index.html", "coverage/lcov.info", "target/debug/x", "out/a.txt"]) {
    assertDenied(read(root, file), file, "build output", "This is generated output. Read the source file instead.");
  }
});

test("denies minified files and source maps", () => {
  const root = makeProject();
  assertDenied(read(root, "public/app.min.js"), "public/app.min.js", "minified", "Read the unminified source instead.");
  assertDenied(read(root, "public/app.min.css"), "public/app.min.css", "minified", "Read the unminified source instead.");
  assertDenied(read(root, "src/app.js.map"), "src/app.js.map", "a source map", "Source maps are generated. Read the source instead.");
});

test("allows normal source files and similarly named files", () => {
  const root = makeProject();
  for (const file of ["src/app.js", "app/Models/User.php", "README.md", "src/distance.ts", "src/builder/index.ts", "package.json"]) {
    const result = read(root, file);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "", file);
  }
});

test("allows library source inside node_modules and vendor, even under dist", () => {
  const root = makeProject();
  for (const file of ["node_modules/pkg/dist/index.js", "node_modules/pkg/src/a.ts", "vendor/laravel/framework/src/App.php"]) {
    assert.equal(read(root, file).stdout, "", file);
  }
});

test("honors readGuard.allow", () => {
  const root = makeProject({ config: { readGuard: { allow: ["dist/keep/**"], extraDeny: [] } } });
  assert.equal(read(root, "dist/keep/a.js").stdout, "");
  assert.notEqual(read(root, "dist/other/a.js").stdout, "");
});

test("honors readGuard.extraDeny", () => {
  const root = makeProject({ config: { readGuard: { allow: [], extraDeny: ["secrets/**"] } } });
  assertDenied(read(root, "secrets/a.txt"), "secrets/a.txt", "denied by project settings", "Blocked by project read guard settings.");
});

test("allows paths outside the project", () => {
  const root = makeProject();
  const result = read(root, "/etc/hosts");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("allows everything when the project has no config", () => {
  const root = makeProject();
  const result = runNode(hook, [], { input: JSON.stringify({ cwd: "/", tool_input: { file_path: "/package-lock.json" } }) });
  assert.equal(result.stdout, "");
  assert.ok(root);
});

test("fails open on invalid input", () => {
  for (const input of ["", "nope", "{}", '{"tool_input":{"file_path":5}}']) {
    const result = runNode(hook, [], { input });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  }
});

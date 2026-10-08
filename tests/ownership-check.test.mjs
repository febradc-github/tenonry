import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupScenario, contractFor } from "./helpers/scenario.mjs";
import { dispatchAnswers } from "./helpers/jev.mjs";

const easy = { dispatch: dispatchAnswers() };
const started = () => {
  const s = setupScenario({ jev: easy });
  s.cli("next", s.runId);
  return s;
};

test("clean when every change belongs to the task owner", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  const result = s.cli("ownership-check", s.runId, "T1");
  assert.deepEqual(result, { ok: true, files: ["app/Models/LoyaltyPoint.php"], violations: [] });
});

test("reports a violation in a tracked file and in a new untracked file", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  fs.appendFileSync(path.join(s.root, "app/Http/Controllers/HomeController.php"), "// edited\n");
  s.write("resources/js/Rogue.vue");
  s.write("docs/stray.xyz");
  s.write(".env", "SECRET=1\n");
  const result = s.cli("ownership-check", s.runId, "T1");
  assert.equal(result.ok, false);
  assert.deepEqual(result.files, ["app/Models/LoyaltyPoint.php"]);
  const byPath = Object.fromEntries(result.violations.map((v) => [v.path, v.owner]));
  assert.deepEqual(byPath, {
    "app/Http/Controllers/HomeController.php": "tenonry-laravel",
    "resources/js/Rogue.vue": "tenonry-vue",
    "docs/stray.xyz": "unowned",
  });
});

test("an ignored file such as .env never shows up", () => {
  const s = started();
  s.write(".env", "SECRET=1\n");
  assert.equal(s.cli("ownership-check", s.runId, "T1").ok, true);
});

test("paths owned by another running task are ignored", () => {
  const s = setupScenario({ jev: easy });
  const contract = contractFor(s.runId);
  contract.tasks[1].dependsOn = [];
  contract.tasks[2].dependsOn = [];
  s.writeContract(contract);
  s.cli("contract-check", s.runId);
  const { ready } = s.cli("next", s.runId);
  assert.equal(ready.length, 3);
  s.write("app/Models/LoyaltyPoint.php");
  s.write("app/Http/Controllers/LoyaltyController.php");
  s.write("resources/js/Pages/Loyalty.vue");
  const check = s.cli("ownership-check", s.runId, "T1");
  assert.equal(check.ok, true);
  assert.deepEqual(check.files, ["app/Models/LoyaltyPoint.php"]);
});

test("changes already dirty at baseline are not counted", () => {
  const s = setupScenario({ jev: easy });
  s.write("resources/js/Early.vue");
  s.cli("next", s.runId);
  assert.equal(s.cli("ownership-check", s.runId, "T1").ok, true);
});

test("revert-violations restores a tracked file and deletes a new one", () => {
  const s = started();
  const home = "app/Http/Controllers/HomeController.php";
  const original = fs.readFileSync(path.join(s.root, home), "utf8");
  s.write("app/Models/LoyaltyPoint.php");
  fs.appendFileSync(path.join(s.root, home), "// edited\n");
  s.write("resources/js/Rogue.vue");
  const result = s.cli("revert-violations", s.runId, "T1");
  assert.deepEqual(result.restored.sort(), [home, "resources/js/Rogue.vue"].sort());
  assert.deepEqual(result.failed, []);
  assert.equal(fs.readFileSync(path.join(s.root, home), "utf8"), original);
  assert.ok(!fs.existsSync(path.join(s.root, "resources/js/Rogue.vue")));
  assert.ok(fs.existsSync(path.join(s.root, "app/Models/LoyaltyPoint.php")), "the task's own file stays");
  assert.equal(s.cli("ownership-check", s.runId, "T1").ok, true);
});

test("revert-violations with no violations is a no-op", () => {
  const s = started();
  assert.deepEqual(s.cli("revert-violations", s.runId, "T1"), { ok: true, restored: [], failed: [] });
});

test("task-files returns the recorded changed files", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  s.cli("verify", s.runId, "T1");
  assert.deepEqual(s.cli("task-files", s.runId, "T1").files, ["app/Models/LoyaltyPoint.php"]);
});

test("0.6.0: a lockfile the package manager wrote goes with the task, like the manifest beside it", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  fs.appendFileSync(path.join(s.root, "composer.json"), "\n");
  s.write("composer.lock", "{}\n");
  const result = s.cli("ownership-check", s.runId, "T1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.sort(), ["app/Models/LoyaltyPoint.php", "composer.json", "composer.lock"]);
});

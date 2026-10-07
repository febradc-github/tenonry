import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { setupScenario, defaultVerify, FLAG } from "./helpers/scenario.mjs";
import { dispatchAnswers } from "./helpers/jev.mjs";

const easy = { dispatch: dispatchAnswers() };

function started(options = {}) {
  const s = setupScenario({ jev: easy, ...options });
  s.cli("next", s.runId);
  return s;
}

test("pass: runs the task's tests, records the attempt, and asks for review", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  s.flag(true);
  const result = s.cli("verify", s.runId, "T1");
  assert.equal(result.result, "pass");
  assert.equal(result.action, "review");
  assert.equal(result.delegation, null);
  assert.equal(result.feedback, "");
  assert.deepEqual(result.files, ["app/Models/LoyaltyPoint.php"]);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].name, "test");
  assert.equal(result.steps[0].exitCode, 0);
  assert.match(result.steps[0].command, /'tests\/Unit\/LoyaltyPointTest\.php'$/);
  assert.match(result.steps[0].log, /^\.tenonry\/logs\/exec\/.*T1-test\.log$/);

  const task = s.run().tasks.T1;
  assert.equal(task.status, "verifying");
  assert.deepEqual(task.changedFiles, ["app/Models/LoyaltyPoint.php"]);
  assert.equal(task.attempts[0].result, "pass");
  const outcome = s.log().find((l) => l.kind === "outcome");
  assert.deepEqual([outcome.task, outcome.model, outcome.attempt, outcome.result, outcome.runId], ["T1", "haiku", 1, "pass", s.runId]);
});

test("fail: resumes with filtered feedback and a fix-mode delegation", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  s.flag(false);
  const result = s.cli("verify", s.runId, "T1");
  assert.equal(result.result, "fail");
  assert.equal(result.action, "resume");
  assert.match(result.feedback, /\[test\] sh -c/);
  assert.match(result.feedback, /FAIL: spec not met/);
  assert.equal(
    result.delegation,
    [
      "TENONRY_TASK", `run: ${s.runId}`, "task: T1", "mode: fix",
      `contract: .tenonry/runs/${s.runId}/contract.json`, `plan: .tenonry/runs/${s.runId}/plan.md`,
      `report_to: .tenonry/runs/${s.runId}/reports/T1.json`, "feedback:",
      ...result.feedback.split("\n").map((l) => `  ${l}`),
    ].join("\n"),
  );
  const task = s.run().tasks.T1;
  assert.equal(task.status, "running");
  assert.equal(task.failuresOnTier, 1);
  assert.equal(s.log().find((l) => l.kind === "outcome").result, "fail");
});

test("two failures on a tier escalate to the next tier and the next call restarts there", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  assert.equal(s.cli("verify", s.runId, "T1").action, "resume");
  const second = s.cli("verify", s.runId, "T1");
  assert.equal(second.action, "respawn");
  let task = s.run().tasks.T1;
  assert.deepEqual([task.status, task.tier, task.failuresOnTier], ["pending", "sonnet", 0]);

  const [again] = s.cli("next", s.runId).ready;
  assert.deepEqual([again.task, again.model], ["T1", "sonnet"]);
  assert.equal(s.run().tasks.T1.attempts.length, 2);
  assert.equal(s.log().filter((l) => l.kind === "outcome").length, 2);
});

test("opus failing twice blocks the task", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  const outcomes = [];
  for (let i = 0; i < 6; i++) {
    const result = s.cli("verify", s.runId, "T1");
    outcomes.push(result.action);
    if (result.action === "respawn") s.cli("next", s.runId);
    if (result.action === "blocked") break;
  }
  assert.deepEqual(outcomes, ["resume", "respawn", "resume", "respawn", "resume", "blocked"]);
  const task = s.run().tasks.T1;
  assert.equal(task.status, "blocked");
  assert.equal(task.tier, "opus");
  assert.match(task.notes.at(-1), /^blocked: checks still failing on opus/);
});

test("the retry limit comes from config.limits", () => {
  const s = started({ config: { limits: { maxParallel: 3, maxTestRetriesPerTier: 1, maxDesignRounds: 3, maxCodeReviewRounds: 2, maxContractFixes: 2 } } });
  s.write("app/Models/LoyaltyPoint.php");
  assert.equal(s.cli("verify", s.runId, "T1").action, "respawn");
});

test("changedFiles contains only files the owner may change", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  s.write("resources/js/Other.vue");
  s.write("composer.json", "{}\n");
  s.flag(true);
  const result = s.cli("verify", s.runId, "T1");
  assert.deepEqual(result.files.sort(), ["app/Models/LoyaltyPoint.php", "composer.json"]);
});

test("tasks without tests skip the test step and record a note", () => {
  const s = setupScenario({ jev: easy });
  const run = s.run();
  run.tasks.T1.status = "done";
  run.tasks.T2.status = "done";
  fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
  s.cli("next", s.runId);
  s.write("resources/js/Pages/Loyalty.vue");
  const result = s.cli("verify", s.runId, "T3");
  assert.equal(result.result, "pass");
  assert.deepEqual(result.steps, [{ name: "test", skipped: true, reason: "no_tests" }]);
  assert.ok(s.run().tasks.T3.notes.includes("skipped test: no_tests"));
});

test("a missing testFiles template skips the test step", () => {
  const s = started({ verify: [{ ...defaultVerify()[0], testFiles: null }] });
  s.write("app/Models/LoyaltyPoint.php");
  const result = s.cli("verify", s.runId, "T1");
  assert.deepEqual(result.steps, [{ name: "test", skipped: true, reason: "no_test_template" }]);
  assert.equal(result.result, "pass");
});

test("with no verify configuration the step is skipped", () => {
  const s = started({ verify: [] });
  s.write("app/Models/LoyaltyPoint.php");
  assert.deepEqual(s.cli("verify", s.runId, "T1").steps, [{ name: "test", skipped: true, reason: "no_verify_config" }]);
});

test("typecheck failures count only when they mention the task's files", () => {
  const unrelated = started({ verify: [{ ...defaultVerify()[0], typecheck: `sh -c 'echo "error TS2304 in resources/js/Other.vue"; exit 1'` }] });
  unrelated.write("app/Models/LoyaltyPoint.php");
  unrelated.flag(true);
  const passed = unrelated.cli("verify", unrelated.runId, "T1");
  assert.equal(passed.result, "pass");
  assert.equal(passed.steps[1].name, "typecheck");
  assert.equal(passed.steps[1].exitCode, 1);
  assert.equal(passed.steps[1].scoped, true);

  const related = started({ verify: [{ ...defaultVerify()[0], typecheck: `sh -c 'echo "error: app/Models/LoyaltyPoint.php:3 bad type"; exit 1'` }] });
  related.write("app/Models/LoyaltyPoint.php");
  related.flag(true);
  const failed = related.cli("verify", related.runId, "T1");
  assert.equal(failed.result, "fail");
  assert.match(failed.feedback, /\[typecheck\]/);
  assert.match(failed.feedback, /bad type/);
});

test("lint output mentioning a test file of the task counts, relative to the package root", () => {
  const s = started({ verify: [{ ...defaultVerify()[0], lint: `sh -c 'echo "tests/Unit/LoyaltyPointTest.php: style"; exit 1'` }] });
  s.write("app/Models/LoyaltyPoint.php");
  s.flag(true);
  assert.equal(s.cli("verify", s.runId, "T1").result, "fail");
});

test("feedback is capped at outputFilter.maxLines", () => {
  const noisy = `sh -c 'i=1; while [ $i -le 400 ]; do echo "Error line $i"; i=$((i+1)); done; exit 1'`;
  const s = started({ verify: [{ ...defaultVerify()[0], test: noisy, testFiles: `${noisy} sh {files}` }], config: { outputFilter: { maxLines: 30, extraCommands: [] } } });
  s.write("app/Models/LoyaltyPoint.php");
  const { feedback } = s.cli("verify", s.runId, "T1");
  assert.ok(feedback.split("\n").length <= 30);
});

test("verify in a monorepo picks the entry for the task's package", () => {
  const s = started({
    verify: [
      { root: ".", ecosystem: "js", test: "false", testFiles: `sh -c 'exit 1'`, typecheck: null, lint: null },
      { root: ".", ecosystem: "php", test: "x", testFiles: `sh -c 'exit 0'`, typecheck: null, lint: null },
    ],
  });
  s.write("app/Models/LoyaltyPoint.php");
  assert.equal(s.cli("verify", s.runId, "T1").result, "pass", "the PHP entry matches the .php test");
});

test("FLAG path is gitignored so it never shows up as a change", () => {
  const s = started();
  s.flag(true);
  assert.equal(FLAG.startsWith(".tenonry/logs/"), true);
  assert.deepEqual(s.cli("verify", s.runId, "T1").files, []);
});

test("0.4.0: a task without listed files picks its verify entry from the files it changed", async () => {
  const { selectVerifyEntry } = await import("../scripts/lib/verify.mjs");
  const config = {
    verify: [
      { root: "apps/web", ecosystem: "js", test: "w", testFiles: null, typecheck: null, lint: null },
      { root: "apps/api", ecosystem: "js", test: "a", testFiles: null, typecheck: null, lint: null },
    ],
  };
  const quick = { id: "T1", files: [], tests: [] };
  assert.equal(selectVerifyEntry(config, quick, ["apps/api/src/app.module.ts"]).root, "apps/api");
  assert.equal(selectVerifyEntry(config, quick, ["apps/web/app/page.tsx"]).root, "apps/web");
  assert.equal(selectVerifyEntry(config, quick, []), null, "nothing changed and no root entry: nothing to run");
  assert.equal(selectVerifyEntry(config, { id: "T2", files: ["apps/web/a.ts"], tests: [] }, ["apps/api/b.ts"]).root, "apps/web", "listed files still win");
  const rootOnly = { verify: [{ root: ".", ecosystem: "php", test: "t", testFiles: null, typecheck: null, lint: null }] };
  assert.equal(selectVerifyEntry(rootOnly, quick, []).root, ".");
});

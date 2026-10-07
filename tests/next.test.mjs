import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { setupScenario, contractFor } from "./helpers/scenario.mjs";
import { dispatchAnswers } from "./helpers/jev.mjs";

const easy = { dispatch: dispatchAnswers() };

function independentTasks(s, count) {
  const contract = contractFor(s.runId);
  const owners = ["tenonry-eloquent", "tenonry-laravel", "tenonry-vue", "tenonry-php", "tenonry-html"];
  const files = ["database/a.php", "app/Http/Controllers/A.php", "resources/js/A.vue", "src/Helpers/A.php", "resources/views/a.blade.php"];
  contract.tasks = Array.from({ length: count }, (_, i) => ({
    id: `T${i + 1}`, title: `Task ${i + 1}`, owner: owners[i], summary: "s", files: [files[i]], dependsOn: [], acceptance: ["x"],
    tests: [], ui: false, newScreen: false, interfaces: [],
  }));
  contract.interfaces = [];
  s.writeContract(contract);
  assert.equal(s.cli("contract-check", s.runId).valid, true);
}

test("returns only tasks whose dependencies are done, in dependency order", () => {
  const s = setupScenario({ jev: easy });
  const first = s.cli("next", s.runId);
  assert.deepEqual(first.ready.map((r) => r.task), ["T1"]);
  assert.deepEqual(first.running, []);
  assert.equal(first.remaining, 3);

  const again = s.cli("next", s.runId);
  assert.deepEqual(again.ready, []);
  assert.deepEqual(again.running, ["T1"]);
  assert.equal(again.remaining, 3);

  const run = s.run();
  run.tasks.T1.status = "done";
  fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
  const afterDone = s.cli("next", s.runId);
  assert.deepEqual(afterDone.ready.map((r) => r.task), ["T2"]);
  assert.equal(afterDone.remaining, 2);
});

test("respects maxParallel and one active task per owner", () => {
  const s = setupScenario({ jev: easy, config: { limits: { maxParallel: 2, maxTestRetriesPerTier: 2, maxDesignRounds: 3, maxCodeReviewRounds: 2, maxContractFixes: 2 } } });
  independentTasks(s, 4);
  const first = s.cli("next", s.runId);
  assert.deepEqual(first.ready.map((r) => r.task), ["T1", "T2"]);
  const second = s.cli("next", s.runId);
  assert.deepEqual(second.ready, []);
  assert.deepEqual(second.running, ["T1", "T2"]);

  const same = setupScenario({ jev: easy });
  const contract = contractFor(same.runId);
  contract.tasks = [contract.tasks[0], { ...contract.tasks[0], id: "T2", title: "Second", files: ["app/Models/Second.php"], tests: [] }];
  contract.tasks[0].dependsOn = [];
  contract.interfaces = [];
  contract.tasks.forEach((t) => { t.interfaces = []; });
  same.writeContract(contract);
  assert.equal(same.cli("contract-check", same.runId).valid, true);
  assert.deepEqual(same.cli("next", same.runId).ready.map((r) => r.task), ["T1"]);
});

test("maps Jev answers to models and applies the owner's floor", () => {
  const s = setupScenario({ jev: easy });
  independentTasks(s, 3);
  const { ready } = s.cli("next", s.runId);
  const byTask = Object.fromEntries(ready.map((r) => [r.task, r]));
  assert.equal(byTask.T1.model, "haiku");
  assert.equal(byTask.T1.reason, "jev difficulty=0.30(c0.90) specified=0.92 blast=0.20(c0.90) -> haiku");
  assert.equal(byTask.T2.model, "haiku");
  assert.equal(byTask.T3.model, "sonnet", "vue has a sonnet floor");
  assert.equal(s.run().tasks.T3.tier, "sonnet");
  assert.equal(s.run().tasks.T1.tier, "haiku");
});

test("a hard task goes to opus and a risky one rounds up", () => {
  const hard = setupScenario({ jev: { dispatch: dispatchAnswers({ difficulty: 2.4, specified: 0.2 }) } });
  assert.equal(hard.cli("next", hard.runId).ready[0].model, "opus");
  const unsure = setupScenario({ jev: { dispatch: dispatchAnswers({ difficultyConfidence: 0.2 }) } });
  assert.equal(unsure.cli("next", unsure.runId).ready[0].model, "sonnet");
});

test("without Jev every task falls back to sonnet with the floor applied", () => {
  const s = setupScenario({ jev: easy });
  s.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  const first = s.cli("next", s.runId).ready[0];
  assert.equal(first.model, "sonnet");
  assert.equal(first.reason, "fallback disabled -> sonnet");
  assert.equal(s.log().filter((l) => l.kind === "dispatch").at(-1).fallbackReason, "disabled");
});

test("logs one dispatch decision per started task", () => {
  const s = setupScenario({ jev: easy });
  independentTasks(s, 2);
  s.cli("next", s.runId);
  const lines = s.log().filter((l) => l.kind === "dispatch");
  assert.deepEqual(lines.map((l) => [l.task, l.ok, l.decision.model]), [["T1", true, "haiku"], ["T2", true, "haiku"]]);
});

test("starting a task records the attempt and a git baseline", () => {
  const s = setupScenario({ jev: easy });
  s.write("app/Models/Dirty.php", "dirty\n");
  s.cli("next", s.runId);
  const task = s.run().tasks.T1;
  assert.equal(task.status, "running");
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0].model, "haiku");
  assert.match(task.baseline.head, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(task.baseline.files), ["app/Models/Dirty.php"]);
});

test("the delegation message is exactly the build message", () => {
  const s = setupScenario({ jev: easy });
  const [t1] = s.cli("next", s.runId).ready;
  assert.equal(
    t1.delegation,
    [
      "TENONRY_TASK",
      `run: ${s.runId}`,
      "task: T1",
      "mode: build",
      `contract: .tenonry/runs/${s.runId}/contract.json`,
      `plan: .tenonry/runs/${s.runId}/plan.md`,
      `report_to: .tenonry/runs/${s.runId}/reports/T1.json`,
    ].join("\n"),
  );
});

test("ui tasks get the design lines in their delegation", () => {
  const s = setupScenario({ jev: easy });
  independentTasks(s, 3);
  const contract = s.contract();
  contract.tasks[2].ui = true;
  s.writeContract(contract);
  const t3 = s.cli("next", s.runId).ready.find((r) => r.task === "T3");
  assert.equal(
    t3.delegation,
    [
      "TENONRY_TASK",
      `run: ${s.runId}`,
      "task: T3",
      "mode: build",
      `contract: .tenonry/runs/${s.runId}/contract.json`,
      `plan: .tenonry/runs/${s.runId}/plan.md`,
      "design_direction: .tenonry/design-direction.md",
      `design_brief: .tenonry/runs/${s.runId}/design-brief.md`,
      `report_to: .tenonry/runs/${s.runId}/reports/T3.json`,
    ].join("\n"),
  );
});

test("tasks that depend on a blocked task become blocked, transitively", () => {
  const s = setupScenario({ jev: easy });
  s.cli("next", s.runId);
  s.cli("block-task", s.runId, "T1", "--reason", "cannot build");
  const result = s.cli("next", s.runId);
  assert.deepEqual(result.ready, []);
  assert.deepEqual(result.running, []);
  assert.equal(result.remaining, 3, "blocked tasks still count as remaining");
  const tasks = s.run().tasks;
  assert.equal(tasks.T2.status, "blocked");
  assert.equal(tasks.T3.status, "blocked");
  assert.ok(tasks.T2.notes.includes("dependency T1 blocked"));
});

test("an escalated tier is reused without asking Jev again", () => {
  const s = setupScenario({ jev: easy });
  s.cli("next", s.runId);
  const before = s.log().length;
  const run = s.run();
  run.tasks.T1.status = "pending";
  run.tasks.T1.tier = "opus";
  fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
  const [t1] = s.cli("next", s.runId).ready;
  assert.equal(t1.model, "opus");
  assert.equal(t1.reason, "escalation tier opus");
  assert.equal(s.log().length, before, "no new Jev decision");
  assert.equal(s.run().tasks.T1.attempts.length, 2);
});

test("an unknown run is a usage error", () => {
  const s = setupScenario({ jev: easy });
  const result = s.cli.raw("next", "r-nope");
  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /run_not_found/);
  assert.equal(s.cli.raw("next").status, 1);
});

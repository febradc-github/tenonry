import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupScenario, contractFor } from "./helpers/scenario.mjs";
import { dispatchAnswers, directIntake, quickIntake, riskAnswers } from "./helpers/jev.mjs";
import { git } from "./helpers/project.mjs";

const SCORES = { ux: 8, visual: 8, content: 8, accessibility: 8, performance: 8, responsive: 8, innovation: 8 };

// Plays the orchestrator and the specialists against the real CLI, following skills/run/SKILL.md step 7 and later.
function drive(s, { failFirstVerifyOf = [] } = {}) {
  const events = [];
  const failures = new Set(failFirstVerifyOf);
  for (let guard = 0; guard < 20; guard++) {
    const { ready, running } = s.cli("next", s.runId);
    if (ready.length === 0 && running.length === 0) break;
    for (const item of ready) {
      const def = s.contract().tasks.find((t) => t.id === item.task);
      events.push(`build ${item.task} ${item.model}`);
      for (const file of def.files) s.write(file, `// ${item.task}\n`);
      s.report(item.task, { task: item.task, agent: item.agent, status: "done", filesChanged: def.files, summary: "done", handoffs: [], contractIssues: [] });
      s.flag(!failures.has(item.task));
      let verified = s.cli("verify", s.runId, item.task);
      while (verified.action === "resume") {
        events.push(`fix ${item.task}`);
        failures.delete(item.task);
        s.flag(true);
        verified = s.cli("verify", s.runId, item.task);
      }
      assert.equal(verified.action, "review", `${item.task} reaches review`);
      assert.equal(s.cli("ownership-check", s.runId, item.task).ok, true);
      const plan = s.cli("review-plan", s.runId, item.task);
      for (const reviewer of plan.reviewers) {
        if (reviewer.kind === "code") s.review(item.task, "code", { task: item.task, reviewer: reviewer.agent, round: 1, verdict: "pass", findings: [], summary: "ok" });
        else s.review(item.task, "design", { task: item.task, reviewer: reviewer.agent, round: 1, rendered: true, scores: SCORES, weighted: 8, verdict: "pass", findings: [], screenshots: [], summary: "ok" });
      }
      const status = s.cli("review-status", s.runId, item.task);
      assert.equal(status.action, "checkpoint");
      const done = s.cli("checkpoint", s.runId, item.task);
      events.push(`done ${item.task} ${done.sha ? "committed" : done.skipped}`);
    }
  }
  return events;
}

test("a whole run: dependencies, a fix loop, reviews, commits, final gate, report, status, and undo", () => {
  const s = setupScenario({ jev: { dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  s.cli("phase", s.runId, "building");
  const startCommits = Number(git(s.root, "rev-list", "--count", "HEAD"));

  const events = drive(s, { failFirstVerifyOf: ["T2"] });
  assert.deepEqual(events, [
    "build T1 haiku", "done T1 committed",
    "build T2 haiku", "fix T2", "done T2 committed",
    "build T3 sonnet", "done T3 committed",
  ]);
  assert.equal(Number(git(s.root, "rev-list", "--count", "HEAD")), startCommits + 3);
  assert.deepEqual(git(s.root, "log", "-3", "--format=%s", "--reverse").split("\n"), [
    "tenonry(T1): Points model", "tenonry(T2): Points API", "tenonry(T3): Loyalty page",
  ]);
  assert.equal(git(s.root, "status", "--porcelain"), "", "the working tree is clean after the run");
  assert.deepEqual(Object.values(s.run().tasks).map((t) => t.status), ["done", "done", "done"]);

  s.cli("phase", s.runId, "final-gate");
  s.flag(true);
  const gate = s.cli("final-gate", s.runId);
  assert.equal(gate.result, "pass");

  const report = s.cli("report", s.runId);
  assert.equal(report.summary.done, 3);
  assert.deepEqual(report.summary.attention, []);
  assert.equal(s.run().phase, "done");
  assert.match(s.cli("status").display, /Finished/);
  assert.match(fs.readFileSync(path.join(s.root, report.path), "utf8"), /\| T2 Points API \| tenonry-laravel \| haiku \| 1 \| code pass \|/);

  const undone = s.cli("undo");
  assert.equal(undone.ok, true);
  assert.equal(undone.reverted.length, 3);
  assert.ok(!fs.existsSync(path.join(s.root, "resources/js/Pages/Loyalty.vue")));
  assert.equal(git(s.root, "status", "--porcelain"), "");
});

test("a task that keeps failing escalates, then blocks its dependents, and the run still reports", () => {
  const s = setupScenario({ jev: { dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  const tiers = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const { ready } = s.cli("next", s.runId);
    if (ready.length === 0) break;
    tiers.push(ready[0].model);
    s.write("app/Models/LoyaltyPoint.php");
    s.flag(false);
    let result = s.cli("verify", s.runId, "T1");
    while (result.action === "resume") result = s.cli("verify", s.runId, "T1");
    if (result.action === "blocked") break;
  }
  assert.deepEqual(tiers, ["haiku", "sonnet", "opus"]);
  assert.equal(s.run().tasks.T1.status, "blocked");

  const after = s.cli("next", s.runId);
  assert.deepEqual([after.ready, after.running], [[], []]);
  assert.equal(after.remaining, 3);
  assert.deepEqual(Object.values(s.run().tasks).map((t) => t.status), ["blocked", "blocked", "blocked"]);

  const report = s.cli("report", s.runId);
  assert.equal(report.summary.done, 0);
  assert.equal(report.summary.attention.length, 3);
  assert.match(report.summary.attention[0], /^T1 blocked: checks still failing on opus/);
  assert.match(report.summary.attention[1], /^T2 blocked: dependency T1 blocked/);
});

test("a recovered run resumes where it stopped", () => {
  const s = setupScenario({ jev: { dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  s.cli("next", s.runId);
  assert.equal(s.run().tasks.T1.status, "running");
  assert.deepEqual(s.cli("recover", s.runId).recovered, ["T1"]);
  const [again] = s.cli("next", s.runId).ready;
  assert.equal(again.task, "T1");
  assert.equal(s.run().tasks.T1.attempts.length, 2, "the lost attempt is kept");
  s.cli("recover", s.runId);
  const events = drive(s);
  assert.deepEqual(events.filter((e) => e.startsWith("done")), ["done T1 committed", "done T2 committed", "done T3 committed"]);
});

test("a direct run: no planner, plan.md from the brief, then the usual contract, build, review, and commit", () => {
  const s = setupScenario({ contract: false, jev: { intake: directIntake(), dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  // skills/run/SKILL.md steps 2 to 6, with the test author played by the test.
  assert.equal(s.cli("intake", s.runId).plan, "no");
  s.cli("write-brief", s.runId);
  s.cli("phase", s.runId, "planning");
  assert.equal(s.cli("direct-plan", s.runId).ui, "no");
  s.cli("phase", s.runId, "contract");
  const [task] = contractFor(s.runId).tasks;
  s.writeContract(contractFor(s.runId, { interfaces: [], tasks: [task] }));
  assert.equal(s.cli("contract-check", s.runId).valid, true);
  s.cli("phase", s.runId, "building");

  const [first] = s.cli("next", s.runId).ready;
  assert.match(first.delegation, new RegExp(`^plan: \\.tenonry/runs/${s.runId}/plan\\.md$`, "m"), "builders are pointed at the plan file that direct-plan wrote");
  assert.match(fs.readFileSync(path.join(s.root, ".tenonry", "runs", s.runId, "plan.md"), "utf8"), /^---\nui: no\ndirect: yes\n---\n# Direct run\n/);
  s.cli("recover", s.runId);

  assert.deepEqual(drive(s), ["build T1 haiku", "done T1 committed"]);
  s.cli("phase", s.runId, "final-gate");
  s.flag(true);
  assert.equal(s.cli("final-gate", s.runId).result, "pass");
  const report = s.cli("report", s.runId);
  assert.equal(report.summary.done, 1);
  assert.deepEqual(report.summary.attention, []);
  assert.deepEqual(s.log().filter((line) => line.kind === "intake").map((line) => line.decision.plan), ["no"]);
});

test("0.4.0: a quick run: no planner, no test author, one task, the usual checks, review, commit, and undo", () => {
  const s = setupScenario({ contract: false, jev: { intake: quickIntake(), dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  // skills/run/SKILL.md steps 2 to 6, as the orchestrator runs them for lane: quick.
  assert.equal(s.cli("intake", s.runId).lane, "quick");
  s.cli("write-brief", s.runId);
  s.cli("phase", s.runId, "planning");
  assert.equal(s.cli("direct-plan", s.runId).ui, "no");
  assert.deepEqual(s.cli("design-check", s.runId), { ok: true, design: "skip", reason: "no_ui", ui: "no" });
  s.cli("phase", s.runId, "contract");
  assert.equal(s.cli("quick-contract", s.runId).ok, true);
  s.cli("phase", s.runId, "building");

  const { ready } = s.cli("next", s.runId);
  assert.deepEqual(ready.map((item) => [item.task, item.agent, item.title]), [["T1", "tenonry-laravel", "add loyalty points"]]);
  // The builder finds the file itself; the contract lists none.
  s.write("app/Http/Controllers/HomeController.php", "<?php // renamed\n");
  s.report("T1", { task: "T1", agent: "tenonry-laravel", status: "done", filesChanged: ["app/Http/Controllers/HomeController.php"], summary: "done", handoffs: [], contractIssues: [] });
  const verified = s.cli("verify", s.runId, "T1");
  assert.deepEqual([verified.result, verified.action], ["pass", "review"]);
  assert.deepEqual(verified.files, ["app/Http/Controllers/HomeController.php"]);
  assert.deepEqual(verified.steps, [{ name: "test", skipped: true, reason: "no_tests" }]);
  assert.equal(s.cli("ownership-check", s.runId, "T1").ok, true);

  const plan = s.cli("review-plan", s.runId, "T1");
  assert.deepEqual(plan.reviewers.map((r) => [r.agent, r.kind, r.model]), [["tenonry-review-laravel", "code", "haiku"]]);
  assert.match(plan.reviewers[0].delegation, /files:\n {2}- app\/Http\/Controllers\/HomeController\.php\n/);
  s.review("T1", "code", { task: "T1", reviewer: "tenonry-review-laravel", round: 1, verdict: "pass", findings: [], summary: "ok" });
  assert.equal(s.cli("review-status", s.runId, "T1").action, "checkpoint");
  assert.ok(s.cli("checkpoint", s.runId, "T1").sha);
  assert.equal(git(s.root, "log", "-1", "--format=%s"), "tenonry(T1): add loyalty points");

  s.cli("phase", s.runId, "final-gate");
  s.flag(true);
  assert.equal(s.cli("final-gate", s.runId).result, "pass", "the project's own suite still gates the run");
  const report = s.cli("report", s.runId);
  assert.equal(report.summary.done, 1);
  assert.match(fs.readFileSync(path.join(s.root, report.path), "utf8"), /- T1: skipped test: no_tests/);
  assert.deepEqual(s.log().filter((l) => l.kind !== "outcome").map((l) => l.kind), ["intake", "quick", "dispatch", "risk"]);
  assert.equal(s.cli("undo").reverted.length, 1);
});

test("0.4.0: a quick task that needs another owner's file hands off like any other task", () => {
  const s = setupScenario({ contract: false, jev: { intake: quickIntake(), dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.3) } });
  s.cli("intake", s.runId);
  s.cli("quick-contract", s.runId);
  s.cli("phase", s.runId, "building");
  s.cli("next", s.runId);
  s.report("T1", {
    task: "T1", agent: "tenonry-laravel", status: "needs_owner", filesChanged: [], summary: "needs the model",
    handoffs: [{ path: "app/Models/User.php", reason: "The constant lives on the model.", suggestedOwner: "tenonry-eloquent" }], contractIssues: [],
  });
  assert.deepEqual(s.cli("handoff", s.runId, "T1").created, ["T2"]);
  const contract = s.contract();
  assert.deepEqual([contract.tasks[1].owner, contract.tasks[1].files], ["tenonry-eloquent", ["app/Models/User.php"]]);
  assert.deepEqual(contract.tasks[0].dependsOn, ["T2"]);
  assert.equal(s.cli("contract-check", s.runId).valid, true, "the grown contract is still a valid quick contract");
  assert.deepEqual(s.cli("next", s.runId).ready.map((item) => item.task), ["T2"]);
});

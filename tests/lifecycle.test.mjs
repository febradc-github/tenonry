import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupScenario, defaultVerify } from "./helpers/scenario.mjs";
import { dispatchAnswers } from "./helpers/jev.mjs";
import { git } from "./helpers/project.mjs";

const easy = { dispatch: dispatchAnswers() };

function started(options = {}) {
  const s = setupScenario({ jev: easy, ...options });
  s.cli("next", s.runId);
  return s;
}

test("checkpoint commits exactly the task's files with the right message", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  s.write("resources/js/Rogue.vue");
  fs.appendFileSync(path.join(s.root, "README.md"), "unrelated\n");
  const before = git(s.root, "rev-list", "--count", "HEAD");
  const result = s.cli("checkpoint", s.runId, "T1");
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  assert.equal(git(s.root, "log", "-1", "--format=%s"), "tenonry(T1): Points model");
  assert.equal(git(s.root, "show", "--name-only", "--format=", "HEAD"), "app/Models/LoyaltyPoint.php");
  assert.equal(Number(git(s.root, "rev-list", "--count", "HEAD")), Number(before) + 1);
  assert.ok(git(s.root, "status", "--porcelain").includes("resources/js/Rogue.vue"), "other files stay uncommitted");
  const task = s.run().tasks.T1;
  assert.deepEqual([task.status, task.commit], ["done", result.sha]);
});

test("checkpoint skips cleanly when nothing changed and still marks the task done", () => {
  const s = started();
  const result = s.cli("checkpoint", s.runId, "T1");
  assert.deepEqual(result, { ok: true, skipped: "nothing_changed" });
  assert.equal(s.run().tasks.T1.status, "done");
  assert.equal(s.run().tasks.T1.commit, null);
});

test("checkpoint keeps done_with_findings", () => {
  const s = started();
  s.write("app/Models/LoyaltyPoint.php");
  const run = s.run();
  run.tasks.T1.status = "done_with_findings";
  fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
  assert.ok(s.cli("checkpoint", s.runId, "T1").sha);
  assert.equal(s.run().tasks.T1.status, "done_with_findings");
});

test("a rejecting git hook is respected: skipped with a note, status still updates", () => {
  const s = started();
  fs.writeFileSync(path.join(s.root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'lint says no' >&2\nexit 1\n", { mode: 0o755 });
  s.write("app/Models/LoyaltyPoint.php");
  const result = s.cli("checkpoint", s.runId, "T1");
  assert.equal(result.skipped, "commit_failed");
  assert.match(result.error, /lint says no/);
  const task = s.run().tasks.T1;
  assert.equal(task.status, "done");
  assert.equal(task.commit, null);
  assert.match(task.notes.at(-1), /^skipped checkpoint: commit failed/);
});

test("checkpoint outside a git repository skips", () => {
  const s = started();
  fs.rmSync(path.join(s.root, ".git"), { recursive: true });
  assert.equal(s.cli("checkpoint", s.runId, "T1").skipped, "not_a_git_repo");
  assert.equal(s.run().tasks.T1.status, "done");
});

test("owner: ownership rules answer first", () => {
  const s = setupScenario({ contract: false });
  assert.deepEqual(s.cli("owner", "app/Models/Order.php", "--run", s.runId), { ok: true, owner: "tenonry-eloquent", source: "rules" });
  assert.equal(s.cli("owner", ".env", "--run", s.runId).owner, "none");
  assert.equal(s.cli("owner", "composer.json", "--run", s.runId).owner, "*");
  assert.equal(s.log().filter((l) => l.kind === "owner").length, 0, "no Jev call when rules decide");
});

const flutter = (jev) => setupScenario({ fixture: "flutter-app", contract: false, verify: [], jev });
const ownerAnswer = (choice, confidence) => ({ owner: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } });

test("owner: Jev answers for an unowned file and the answer becomes a run rule", () => {
  const s = flutter({ owner: ownerAnswer("tenonry-flutter", 0.9) });
  const result = s.cli("owner", "bin/tool.dart", "--run", s.runId, "--purpose", "a CLI helper");
  assert.deepEqual(result, { ok: true, owner: "tenonry-flutter", source: "jev", confidence: 0.9 });
  const rules = JSON.parse(fs.readFileSync(`${s.runDir}/owner-rules.json`, "utf8")).rules;
  assert.deepEqual(rules, [{ glob: "bin/tool.dart", owner: "tenonry-flutter", priority: 950, source: `jev:${s.runId}` }]);
  assert.deepEqual(s.cli("owner", "bin/tool.dart", "--run", s.runId), { ok: true, owner: "tenonry-flutter", source: "rules" });
  const logged = s.log().find((l) => l.kind === "owner");
  assert.equal(logged.decision.accepted, true);
});

test("owner: low Jev confidence falls back to the extension heuristic", () => {
  const s = flutter({ owner: ownerAnswer("tenonry-flutter", 0.2) });
  const result = s.cli("owner", "bin/tool.dart", "--run", s.runId);
  assert.deepEqual(result, { ok: true, owner: "tenonry-flutter", source: "heuristic" });
  assert.equal(JSON.parse(fs.readFileSync(`${s.runDir}/owner-rules.json`, "utf8")).rules[0].source, `heuristic:${s.runId}`);
});

test("owner: no Jev and no matching extension means none", () => {
  const s = flutter({});
  s.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  assert.deepEqual(s.cli("owner", "notes.xyz", "--run", s.runId), { ok: true, owner: null, source: "none" });
  assert.deepEqual(s.cli("owner", "Makefile", "--run", s.runId), { ok: true, owner: null, source: "none" });
  assert.ok(!fs.existsSync(`${s.runDir}/owner-rules.json`));
  assert.equal(s.cli("owner", "bin/tool.dart", "--run", s.runId).source, "heuristic");
});

test("owner: the heuristic prefers a generic extension glob over a specific one", () => {
  const s = setupScenario({ contract: false });
  s.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  // `.ts` is not owned by any laravel-vue rule except the nodejs generic glob, which already owns it.
  assert.equal(s.cli("owner", "src/util/x.ts", "--run", s.runId).source, "rules");
  assert.equal(s.cli("owner", "src/util/x.ts", "--run", s.runId).owner, "tenonry-nodejs");
});

test("owner needs --run and a path", () => {
  const s = setupScenario({ contract: false });
  assert.equal(s.cli.raw("owner", "a.txt").status, 1);
  assert.equal(s.cli.raw("owner", "--run", s.runId).status, 1);
});

test("handoff creates follow-up tasks and re-queues the original", () => {
  const s = started();
  s.report("T1", {
    task: "T1", agent: "tenonry-eloquent", status: "needs_owner", filesChanged: [], summary: "needs more",
    handoffs: [
      { path: "app/Http/Resources/PointResource.php", reason: "Expose balance.", suggestedOwner: "tenonry-laravel" },
      { path: "resources/js/Pages/Balance.vue", reason: "Show balance.", suggestedOwner: null },
      { path: "resources/js/Pages/Other.vue", reason: "Show more.", suggestedOwner: null },
      { path: ".env", reason: "Needs a key.", suggestedOwner: null },
      { path: "app/Models/Another.php", reason: "Own file.", suggestedOwner: null },
      { path: "composer.json", reason: "Dependency.", suggestedOwner: null },
    ],
    contractIssues: [],
  });
  const result = s.cli("handoff", s.runId, "T1");
  assert.deepEqual(result.created, ["T4", "T5"]);
  assert.deepEqual(result.unresolved, [".env"]);

  const contract = s.contract();
  const [laravel, vue] = contract.tasks.slice(3);
  assert.deepEqual(laravel, {
    id: "T4", title: "Support T1: PointResource.php", owner: "tenonry-laravel", summary: "Needed by T1: Expose balance.",
    files: ["app/Http/Resources/PointResource.php"], dependsOn: [], acceptance: ["Provides what T1 needs: Expose balance."],
    tests: [], ui: false, newScreen: false, interfaces: [],
  });
  assert.equal(vue.owner, "tenonry-vue");
  assert.equal(vue.ui, true);
  assert.deepEqual(vue.files, ["resources/js/Pages/Balance.vue", "resources/js/Pages/Other.vue"]);
  assert.equal(vue.summary, "Needed by T1: Show balance.; Show more.");
  assert.deepEqual(contract.tasks[0].dependsOn, ["T4", "T5"]);

  const run = s.run();
  assert.deepEqual([run.tasks.T1.status, run.tasks.T1.tier], ["pending", "haiku"]);
  assert.equal(run.tasks.T4.status, "pending");
  assert.ok(run.tasks.T1.notes.includes("handoff for .env has no resolvable owner"));
  assert.equal(s.cli("contract-check", s.runId).valid, true);

  const next = s.cli("next", s.runId);
  assert.deepEqual(next.ready.map((r) => r.task), ["T4", "T5"], "follow-ups run before the re-queued task");
});

test("handoff with an unowned path asks the owner logic and adds a run rule", () => {
  const s = started();
  s.report("T1", { task: "T1", status: "needs_owner", handoffs: [{ path: "docs/guide.xyz", reason: "Docs." }] });
  const result = s.cli("handoff", s.runId, "T1");
  assert.deepEqual(result, { ok: true, created: [], unresolved: ["docs/guide.xyz"] });
  assert.equal(s.run().tasks.T1.status, "pending", "re-queued so it retries without that path");
  s.cli("next", s.runId);
  assert.deepEqual(s.cli("handoff", s.runId, "T1").created, []);
  const task = s.run().tasks.T1;
  assert.equal(task.status, "blocked", "a second fruitless handoff blocks the task instead of looping");
  assert.match(task.notes.at(-1), /^blocked: handoffs could not be resolved/);
});

test("handoff without a report does nothing", () => {
  const s = started();
  assert.deepEqual(s.cli("handoff", s.runId, "T1"), { ok: true, created: [], unresolved: [] });
});

test("reset-task and block-task update the task", () => {
  const s = started();
  s.cli("verify", s.runId, "T1");
  const reset = s.cli("reset-task", s.runId, "T1");
  assert.deepEqual([reset.status, reset.failuresOnTier, reset.tier, reset.id], ["pending", 0, "haiku", "T1"]);
  const blocked = s.cli("block-task", s.runId, "T1", "--reason", "cannot proceed");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.notes.at(-1), "blocked: cannot proceed");
  assert.equal(s.cli.raw("block-task", s.runId, "T1").status, 1);
  assert.equal(s.cli.raw("reset-task", s.runId, "T9").status, 1);
});

function allDone(s) {
  const run = s.run();
  for (const task of Object.values(run.tasks)) task.status = "done";
  fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
}

test("final-gate passes when every command passes", () => {
  const s = setupScenario({ jev: easy });
  allDone(s);
  s.flag(true);
  const result = s.cli("final-gate", s.runId);
  assert.equal(result.result, "pass");
  assert.deepEqual(result.reopened, []);
  assert.equal(result.steps[0].name, "test");
  assert.deepEqual(s.run().finalGate.result, "pass");
});

test("final-gate fails strictly and reopens tasks whose tests fail, once", () => {
  const s = setupScenario({ jev: easy, verify: [{ ...defaultVerify()[0], lint: "sh -c 'exit 0'" }] });
  allDone(s);
  s.flag(false);
  const first = s.cli("final-gate", s.runId);
  assert.equal(first.result, "fail");
  assert.deepEqual(first.reopened, ["T1", "T2"], "T3 has no tests");
  const run = s.run();
  assert.equal(run.finalGateReopened, true);
  assert.deepEqual([run.tasks.T1.status, run.tasks.T1.tier, run.tasks.T3.status], ["pending", null, "done"]);
  assert.ok(run.tasks.T1.notes.includes("reopened: final gate tests failed"));

  const second = s.cli("final-gate", s.runId);
  assert.equal(second.result, "fail");
  assert.deepEqual(second.reopened, []);
  assert.equal(s.run().finalGate.result, "fail");
  assert.equal(s.run().tasks.T1.status, "pending");
});

test("final-gate failing on lint alone reopens nothing but still fails", () => {
  const s = setupScenario({ jev: easy, verify: [{ ...defaultVerify()[0], lint: "sh -c 'echo style problem; exit 1'" }] });
  allDone(s);
  s.flag(true);
  const result = s.cli("final-gate", s.runId);
  assert.equal(result.result, "fail");
  assert.deepEqual(result.reopened, []);
  assert.equal(result.steps.find((x) => x.name === "lint").exitCode, 1);
  assert.equal(s.run().finalGateReopened, true);
});

test("final-gate without testFiles templates never reopens", () => {
  const s = setupScenario({ jev: easy, verify: [{ ...defaultVerify()[0], testFiles: null }] });
  allDone(s);
  s.flag(false);
  const result = s.cli("final-gate", s.runId);
  assert.equal(result.result, "fail");
  assert.deepEqual(result.reopened, []);
  assert.equal(s.run().finalGateReopened, false);
});

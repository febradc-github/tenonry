import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupScenario } from "./helpers/scenario.mjs";
import { dispatchAnswers, directIntake, quickIntake, answerIntake, riskAnswers, writeFixture, BASE_ANSWERS } from "./helpers/jev.mjs";
import { git, makeProject } from "./helpers/project.mjs";
import { runNode } from "./helpers/run.mjs";

const easy = { dispatch: dispatchAnswers() };
const saveRun = (s, run) => fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
const SECTIONS = ["# Tenonry report", "## Request", "## Outcome", "## Tasks", "## Unresolved review findings", "## Blocked tasks", "## Final gate", "## Jev usage", "## Skipped steps", "## Logs"];

test("new-run creates a run with a fallback route", () => {
  const s = setupScenario({ contract: false });
  const second = s.cli("new-run", "--prompt", "second request");
  assert.match(second.runId, /^r-/);
  assert.equal(second.runDir, `.tenonry/runs/${second.runId}`);
  const route = JSON.parse(fs.readFileSync(path.join(s.root, second.runDir, "route.json"), "utf8"));
  assert.deepEqual(route, {
    runId: second.runId, createdAt: route.createdAt, prompt: "second request", jev: "fallback", fallbackReason: "no_hook", answers: {},
    clarify: "auto", plan: "yes", lane: "build", contractModel: "opus", design: "yes", difficulty: null, difficultyConfidence: null, taskType: null, ui: null, mainModel: { current: "unknown", notice: false },
  });
  assert.equal(JSON.parse(fs.readFileSync(`${s.runDir}/run.json`, "utf8")).phase, "stopped", "the previous unfinished run is stopped");
});

test("new-run reads --prompt-file and keeps the text verbatim", () => {
  const s = setupScenario({ contract: false });
  const file = path.join(s.root, ".tenonry", "request.txt");
  fs.writeFileSync(file, "line one\nline two with \"quotes\" and $dollars\n");
  const { runId } = s.cli("new-run", "--prompt-file", file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry/runs", runId, "run.json"), "utf8")).prompt, "line one\nline two with \"quotes\" and $dollars");
  assert.equal(s.cli.raw("new-run").status, 1);
});

test("intake rewrites route.json from Jev for a run made by new-run", () => {
  const s = setupScenario({ contract: false, jev: { intake: { ...BASE_ANSWERS.intake, ambiguity: { type: "noul", noul: 0.9 } } } });
  const route = s.cli("intake", s.runId);
  assert.equal(route.jev, "ok");
  assert.equal(route.clarify, "yes");
  assert.equal(route.plan, "yes");
  assert.equal(route.prompt, "add loyalty points");
  assert.equal(route.taskType, "feature");
  const { ok, ...printed } = route;
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${s.runDir}/route.json`, "utf8")), printed);
});

test("intake keeps the main model recorded by the hook and falls back without Jev", () => {
  const s = setupScenario({ contract: false });
  const file = `${s.runDir}/route.json`;
  const route = JSON.parse(fs.readFileSync(file, "utf8"));
  route.mainModel = { current: "haiku", notice: true };
  fs.writeFileSync(file, JSON.stringify(route));
  s.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  const rerouted = s.cli("intake", s.runId);
  assert.equal(rerouted.jev, "fallback");
  assert.equal(rerouted.fallbackReason, "disabled");
  assert.equal(rerouted.clarify, "auto");
  assert.equal(rerouted.plan, "yes");
  assert.deepEqual(rerouted.mainModel, { current: "haiku", notice: true });
  assert.equal(s.cli.raw("intake", "r-nope").status, 1);
});

const DIRECT_INTRO =
  "No planner ran for this request. Jev judged it small and clear enough to build without a separate plan, so the brief below is the whole specification. Build exactly what it asks, completely, and nothing more.";

test("direct-plan writes plan.md from the brief when Jev routed the run past planning", () => {
  const s = setupScenario({ contract: false, jev: { intake: directIntake() } });
  assert.equal(s.cli("intake", s.runId).plan, "no");
  s.cli("write-brief", s.runId);
  const result = s.cli("direct-plan", s.runId);
  assert.deepEqual(result, { ok: true, path: `.tenonry/runs/${s.runId}/plan.md`, ui: "no" });
  const plan = fs.readFileSync(`${s.runDir}/plan.md`, "utf8");
  assert.equal(plan, `---\nui: no\ndirect: yes\n---\n# Direct run\n\n${DIRECT_INTRO}\n\n# Request\n\nadd loyalty points\n`);
  assert.deepEqual(s.cli("direct-plan", s.runId), result, "running it again is harmless");
  assert.equal(fs.readFileSync(`${s.runDir}/plan.md`, "utf8"), plan);
  assert.equal(s.run().phase, "intake", "it never moves the phase by itself");
});

test("direct-plan sets ui from the intake answer, at the threshold and through the config", () => {
  for (const [ui, expected] of [[0.49, "no"], [0.5, "yes"], [0.9, "yes"]]) {
    const s = setupScenario({ contract: false, jev: { intake: directIntake({ ui }) } });
    s.cli("intake", s.runId);
    assert.equal(s.cli("direct-plan", s.runId).ui, expected, String(ui));
    assert.match(fs.readFileSync(`${s.runDir}/plan.md`, "utf8"), new RegExp(`^---\\nui: ${expected}\\ndirect: yes\\n---\\n`));
  }
  const s = setupScenario({ contract: false, jev: { intake: directIntake({ ui: 0.6 }) } });
  const config = JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry/config.json"), "utf8"));
  config.routing.thresholds.planning.minUi = 0.7;
  s.setConfig(config);
  s.cli("intake", s.runId);
  assert.equal(s.cli("direct-plan", s.runId).ui, "no");
});

test("direct-plan keeps a clarified brief as written and works without a brief file", () => {
  const s = setupScenario({ contract: false, jev: { intake: directIntake() } });
  s.cli("intake", s.runId);
  assert.equal(s.cli("direct-plan", s.runId).ok, true);
  assert.ok(fs.readFileSync(`${s.runDir}/plan.md`, "utf8").endsWith(`${DIRECT_INTRO}\n\n# Request\n\nadd loyalty points\n`), "a missing brief falls back to the request");
  const brief = "# Request\nadd loyalty points\n\n# Clarified requirements\n- Points never expire.\n\n# Assumptions\n- One point per $1.\n";
  fs.writeFileSync(`${s.runDir}/brief.md`, `${brief}\n\n`);
  s.cli("direct-plan", s.runId);
  assert.ok(fs.readFileSync(`${s.runDir}/plan.md`, "utf8").endsWith(`${DIRECT_INTRO}\n\n${brief}`));
});

test("direct-plan refuses whenever a plan is required and writes nothing", () => {
  const planned = setupScenario({ contract: false, jev: { intake: BASE_ANSWERS.intake } });
  assert.deepEqual(planned.cli("direct-plan", planned.runId), { ok: false, reason: "plan_required" }, "the route written by new-run plans");
  assert.equal(planned.cli("intake", planned.runId).plan, "yes");
  const refused = planned.cli.raw("direct-plan", planned.runId);
  assert.equal(refused.status, 0, "a refusal is a result, not an error");
  assert.deepEqual(refused.json, { ok: false, reason: "plan_required" });

  const file = `${planned.runDir}/route.json`;
  const { plan, ...older } = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(plan, "yes");
  fs.writeFileSync(file, JSON.stringify(older));
  assert.deepEqual(planned.cli("direct-plan", planned.runId), { ok: false, reason: "plan_required" }, "a route.json from before 0.3.0 plans");
  fs.rmSync(file);
  assert.deepEqual(planned.cli("direct-plan", planned.runId), { ok: false, reason: "plan_required" }, "so does a missing route.json");
  assert.ok(!fs.existsSync(`${planned.runDir}/plan.md`));

  assert.equal(planned.cli.raw("direct-plan", "r-nope").status, 1);
  assert.equal(planned.cli.raw("direct-plan").status, 1);
});

const plan = (s, ui) => fs.writeFileSync(`${s.runDir}/plan.md`, `---\nui: ${ui}\nnew_screens: []\nlayers: [frontend]\n---\n# Plan\n`);
const direction = (s) => s.write(".tenonry/design-direction.md", "# Design direction\n");
const setRoute = (s, patch) => {
  const file = `${s.runDir}/route.json`;
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...patch }));
};

test("0.4.0: design-check skips when the plan has no ui and never writes a brief", () => {
  const s = setupScenario({ contract: false });
  plan(s, "no");
  direction(s);
  setRoute(s, { design: "no" });
  assert.deepEqual(s.cli("design-check", s.runId), { ok: true, design: "skip", reason: "no_ui", ui: "no" });
  assert.ok(!fs.existsSync(`${s.runDir}/design-brief.md`));
  assert.equal(s.run().phase, "intake", "it never moves the phase by itself");
});

test("0.4.0: design-check runs the art director in create mode until a design direction exists, whatever Jev said", () => {
  const s = setupScenario({ contract: false });
  plan(s, "yes");
  setRoute(s, { design: "no" });
  assert.deepEqual(s.cli("design-check", s.runId), { ok: true, design: "run", mode: "create", ui: "yes" });
  assert.ok(!fs.existsSync(`${s.runDir}/design-brief.md`));
});

test("0.4.0: design-check runs the art director in extend mode when new design is needed", () => {
  const s = setupScenario({ contract: false });
  plan(s, "yes");
  direction(s);
  assert.deepEqual(s.cli("design-check", s.runId), { ok: true, design: "run", mode: "extend", ui: "yes" }, "the route from new-run says design: yes");
  const { design, ...older } = JSON.parse(fs.readFileSync(`${s.runDir}/route.json`, "utf8"));
  fs.writeFileSync(`${s.runDir}/route.json`, JSON.stringify(older));
  assert.equal(s.cli("design-check", s.runId).design, "run", "a route.json from before 0.4.0 designs");
});

test("0.4.0: design-check writes the no-new-design brief when Jev says the existing look is enough", () => {
  const s = setupScenario({ contract: false });
  plan(s, "yes");
  direction(s);
  setRoute(s, { design: "no" });
  const result = s.cli("design-check", s.runId);
  assert.deepEqual(result, { ok: true, design: "skip", reason: "no_new_design", ui: "yes", brief: `.tenonry/runs/${s.runId}/design-brief.md` });
  const brief = fs.readFileSync(`${s.runDir}/design-brief.md`, "utf8");
  assert.match(brief, /^# Design brief: no new design\n\nNo art director ran for this request\./);
  assert.match(brief, /^- Profile: `product`$/m, "the design reviewer can read a profile from it");
  assert.match(brief, /^## Review focus$/m);
  assert.ok(brief.includes(".tenonry/design-direction.md"));
  assert.deepEqual(s.cli("design-check", s.runId), result, "running it again is harmless");
});

test("0.4.0: design-check never overwrites a brief the art director wrote", () => {
  const s = setupScenario({ contract: false });
  plan(s, "yes");
  direction(s);
  setRoute(s, { design: "no" });
  fs.writeFileSync(`${s.runDir}/design-brief.md`, "# Design brief: Loyalty\n\n## Loyalty page\n");
  assert.deepEqual(s.cli("design-check", s.runId), { ok: true, design: "skip", reason: "already_designed", ui: "yes" });
  assert.equal(fs.readFileSync(`${s.runDir}/design-brief.md`, "utf8"), "# Design brief: Loyalty\n\n## Loyalty page\n");
});

test("0.4.0: design-check reads ui from a direct plan and fails clearly without a plan", () => {
  const s = setupScenario({ contract: false, jev: { intake: directIntake({ ui: 0.9, newDesign: 0.1 }) } });
  assert.equal(s.cli.raw("design-check", s.runId).json.error, "plan_not_found");
  s.cli("intake", s.runId);
  s.cli("direct-plan", s.runId);
  direction(s);
  assert.equal(s.cli("design-check", s.runId).reason, "no_new_design");
  assert.equal(s.cli.raw("design-check", "r-nope").status, 1);
});

test("0.4.0: intake records the lane, the contract model, and the design decision", () => {
  const quick = setupScenario({ contract: false, jev: { intake: quickIntake() } });
  const route = quick.cli("intake", quick.runId);
  assert.deepEqual([route.lane, route.plan, route.contractModel, route.design], ["quick", "no", "sonnet", "no"]);
  const question = setupScenario({ contract: false, jev: { intake: answerIntake() } });
  assert.equal(question.cli("intake", question.runId).lane, "answer");
  assert.equal(question.cli("phase", question.runId, "done").phase, "done", "an answered run is closed without tasks");
  assert.match(question.cli("status").display, /Finished\n.*\nTasks: 0 done/);
});

test("0.4.0: quick-contract writes a one-task contract for the specialist Jev picks", () => {
  const s = setupScenario({ contract: false, jev: { intake: quickIntake() } });
  s.cli("intake", s.runId);
  const result = s.cli("quick-contract", s.runId);
  assert.deepEqual(result, { ok: true, owner: "tenonry-laravel", source: "jev", tasks: 1, path: `.tenonry/runs/${s.runId}/contract.json` });
  const contract = s.contract();
  assert.deepEqual(contract, {
    version: 1, runId: s.runId, title: "add loyalty points", summary: "add loyalty points", quick: true, interfaces: [],
    tasks: [{
      id: "T1", title: "add loyalty points", owner: "tenonry-laravel", summary: "add loyalty points", files: [], dependsOn: [],
      acceptance: ["The change the request describes is made completely, and nothing else changes."], tests: [], ui: false, newScreen: false, interfaces: [],
    }],
    notes: contract.notes,
  });
  assert.match(contract.notes, /^Quick change: Jev judged this a small mechanical change, so no test author ran and no new tests were written\./);
  const summary = fs.readFileSync(`${s.runDir}/contract.md`, "utf8");
  assert.match(summary, /^# Contract: add loyalty points\n/);
  assert.match(summary, /\| T1 \| tenonry-laravel \| add loyalty points \| - \|/);
  assert.deepEqual(Object.keys(s.run().tasks), ["T1"]);
  assert.equal(s.run().tasks.T1.owner, "tenonry-laravel");
  assert.equal(s.run().contractFixes, 0);
  assert.deepEqual(s.cli("contract-check", s.runId).errors, [], "the written contract is valid");
  assert.equal(s.log().find((line) => line.kind === "quick").decision.owner, "tenonry-laravel");
  assert.deepEqual(s.cli("quick-contract", s.runId), { ...result, source: "existing" }, "running it again reuses the contract");
});

test("0.4.0: quick-contract shortens a long request into the task title", () => {
  const s = setupScenario({ contract: false, jev: { intake: quickIntake() } });
  const request = `\n  Rename   the constant MAX_POINTS to MAX_LOYALTY_POINTS everywhere it is used in the loyalty module, please.\nKeep the value.`;
  const { runId } = s.cli("new-run", "--prompt", request);
  s.cli("intake", runId);
  assert.equal(s.cli("quick-contract", runId).ok, true);
  const contract = JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry/runs", runId, "contract.json"), "utf8"));
  assert.equal(contract.title, "Rename the constant MAX_POINTS to MAX_LOYALTY_POINTS everywhere it is", "cut at a word boundary");
  assert.ok(contract.title.length <= 72);
  assert.equal(contract.tasks[0].summary, request.trim());
});

test("0.4.0: quick-contract hands back to the test author whenever it cannot be sure", () => {
  const notQuick = setupScenario({ contract: false, jev: { intake: directIntake() } });
  assert.deepEqual(notQuick.cli("quick-contract", notQuick.runId), { ok: false, reason: "not_quick" }, "the route written by new-run is not quick");
  notQuick.cli("intake", notQuick.runId);
  const refused = notQuick.cli.raw("quick-contract", notQuick.runId);
  assert.deepEqual([refused.status, refused.json], [0, { ok: false, reason: "not_quick" }]);

  const unsure = setupScenario({ contract: false, jev: { intake: quickIntake(), quick: { owner: { type: "choice", choice: "tenonry-laravel", confidence: 0.49 } } } });
  unsure.cli("intake", unsure.runId);
  assert.deepEqual(unsure.cli("quick-contract", unsure.runId), { ok: false, reason: "no_owner" }, "Jev is not sure who owns the change");

  const down = setupScenario({ contract: false, jev: { intake: quickIntake() } });
  down.cli("intake", down.runId);
  down.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  assert.deepEqual(down.cli("quick-contract", down.runId), { ok: false, reason: "no_owner" }, "Jev is unavailable");

  for (const s of [notQuick, unsure, down]) {
    assert.ok(!fs.existsSync(`${s.runDir}/contract.json`));
    assert.deepEqual(s.run().tasks, {});
  }

  const authored = setupScenario({ jev: { intake: quickIntake() } });
  authored.cli("intake", authored.runId);
  assert.deepEqual(authored.cli("quick-contract", authored.runId), { ok: false, reason: "contract_exists" }, "a test author's contract is never replaced");
  assert.equal(authored.contract().tasks.length, 3);
  assert.equal(authored.cli.raw("quick-contract", "r-nope").status, 1);
});

test("0.4.0: with one active specialist quick-contract needs no Jev call", () => {
  const s = setupScenario({ fixture: "go-api", contract: false, jev: { intake: quickIntake(), quick: undefined } });
  const active = JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry/config.json"), "utf8")).activeSpecialists;
  assert.deepEqual(active, ["go"]);
  s.cli("intake", s.runId);
  assert.deepEqual(s.cli("quick-contract", s.runId), { ok: true, owner: "tenonry-go", source: "only", tasks: 1, path: `.tenonry/runs/${s.runId}/contract.json` });
  assert.equal(s.log().filter((line) => line.kind === "quick").length, 0);
});

test("status displays a mixed run exactly", () => {
  const s = setupScenario({ jev: easy });
  const run = s.run();
  run.phase = "building";
  Object.assign(run.tasks.T1, { status: "done", tier: "haiku" });
  Object.assign(run.tasks.T2, { status: "reviewing", tier: "sonnet" });
  saveRun(s, run);
  const { display, run: returned } = s.cli("status");
  assert.equal(returned.id, s.runId);
  assert.equal(
    display,
    [
      `Tenonry run ${s.runId}: Building`,
      "Request: add loyalty points",
      "Tasks: 1 done, 1 in progress, 1 waiting, 0 blocked",
      "  T1  done          tenonry-eloquent   haiku   Points model",
      "  T2  in progress   tenonry-laravel    sonnet  Points API",
      "  T3  waiting       tenonry-vue        -       Loyalty page",
      "Next: Working on T2.",
    ].join("\n"),
  );
  assert.equal(s.cli("status", s.runId).display, display);
});

test("status words, counts, and the next line for other situations", () => {
  const s = setupScenario({ jev: easy });
  const run = s.run();
  run.prompt = "x".repeat(150);
  Object.assign(run.tasks.T1, { status: "done_with_findings", tier: "opus" });
  Object.assign(run.tasks.T2, { status: "blocked" });
  Object.assign(run.tasks.T3, { status: "pending" });
  run.phase = "contract";
  saveRun(s, run);
  const lines = s.cli("status").display.split("\n");
  assert.equal(lines[0], `Tenonry run ${s.runId}: Writing the contract and tests`);
  assert.equal(lines[1], `Request: ${"x".repeat(100)}`);
  assert.equal(lines[2], "Tasks: 1 done, 0 in progress, 1 waiting, 1 blocked");
  assert.match(lines[3], /^  T1  done, with notes {2}tenonry-eloquent {3}opus {4}Points model$/);
  assert.match(lines[4], /^  T2  blocked/);
  assert.equal(lines.at(-1), "Next: Type /tenonry:run to continue.");

  run.phase = "done";
  saveRun(s, run);
  assert.match(s.cli("status").display, /: Finished\n/);
  assert.match(s.cli("status").display, /Next: Finished\. Undo with \/tenonry:run undo\.$/);
  run.phase = "stopped";
  saveRun(s, run);
  assert.match(s.cli("status").display, /Next: Start a new request with/);
});

test("status with no runs", () => {
  const root = makeProject();
  const result = runNode(path.join(root, ".tenonry", "bin", "tenonry.mjs"), ["status"], { cwd: root });
  assert.equal(result.json.display, "No Tenonry runs yet. Start one with /tenonry:run <what you want>.");
  assert.equal(result.json.run, null);
});

test("status of a run before any tasks exist", () => {
  const s = setupScenario({ contract: false });
  assert.match(s.cli("status").display, /^Tenonry run .*: Clarifying the request\nRequest: add loyalty points\nTasks: 0 done, 0 in progress, 0 waiting, 0 blocked\nNext: Type/);
});

test("recover moves running, verifying, and reviewing tasks back to pending without losing attempts", () => {
  const s = setupScenario({ jev: easy });
  const run = s.run();
  Object.assign(run.tasks.T1, { status: "running", tier: "sonnet", failuresOnTier: 1, attempts: [{ model: "haiku", result: "fail" }, { model: "sonnet" }] });
  Object.assign(run.tasks.T2, { status: "verifying", tier: "haiku" });
  Object.assign(run.tasks.T3, { status: "reviewing", tier: "sonnet" });
  saveRun(s, run);
  assert.deepEqual(s.cli("recover", s.runId).recovered, ["T1", "T2", "T3"]);
  const after = s.run().tasks;
  assert.deepEqual([after.T1.status, after.T1.tier, after.T1.failuresOnTier, after.T1.attempts.length], ["pending", "sonnet", 1, 2]);
  assert.equal(after.T3.status, "pending");

  Object.assign(run.tasks.T1, { status: "done" });
  Object.assign(run.tasks.T2, { status: "blocked" });
  Object.assign(run.tasks.T3, { status: "pending" });
  saveRun(s, run);
  assert.deepEqual(s.cli("recover", s.runId).recovered, []);
  assert.deepEqual(Object.values(s.run().tasks).map((t) => t.status), ["done", "blocked", "pending"]);
});

test("phase validates the phase name", () => {
  const s = setupScenario({ contract: false });
  assert.equal(s.cli("phase", s.runId, "building").phase, "building");
  assert.equal(s.run().phase, "building");
  assert.equal(s.cli.raw("phase", s.runId, "dancing").status, 1);
});

test("notice-shown and restart-pending update state.json", () => {
  const s = setupScenario({ contract: false });
  const read = () => JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry", "state.json"), "utf8"));
  assert.equal(s.cli("notice-shown", "jevKeyMissing").notices.jevKeyMissing, true);
  assert.equal(read().notices.jevKeyMissing, true);
  assert.equal(s.cli("restart-pending", "true").restartPending, true);
  assert.equal(read().restartPending, true);
  assert.equal(read().activeRun, s.runId, "other state is kept");
  assert.equal(s.cli("restart-pending", "false").restartPending, false);
  assert.equal(read().restartPending, false);
});

function committedRun() {
  const s = setupScenario({ jev: easy });
  for (const [task, file] of [["T1", "app/Models/LoyaltyPoint.php"], ["T2", "app/Http/Controllers/LoyaltyController.php"]]) {
    const run = s.run();
    if (task === "T2") run.tasks.T1.status = "done";
    saveRun(s, run);
    s.cli("next", s.runId);
    s.write(file, `<?php // ${task}\n`);
    assert.ok(s.cli("checkpoint", s.runId, task).sha);
  }
  return s;
}

test("undo reverts the run's commits newest first as new revert commits", () => {
  const s = committedRun();
  const shas = [s.run().tasks.T1.commit, s.run().tasks.T2.commit];
  const before = Number(git(s.root, "rev-list", "--count", "HEAD"));
  const result = s.cli("undo");
  assert.deepEqual(result, { ok: true, reverted: [shas[1], shas[0]], runId: s.runId });
  assert.equal(Number(git(s.root, "rev-list", "--count", "HEAD")), before + 2, "history only grows");
  assert.ok(!fs.existsSync(path.join(s.root, "app/Models/LoyaltyPoint.php")));
  assert.ok(!fs.existsSync(path.join(s.root, "app/Http/Controllers/LoyaltyController.php")));
  assert.match(git(s.root, "log", "-1", "--format=%s"), /^Revert "tenonry\(T1\): Points model"/);
  assert.equal(s.run().undone, true);
  assert.equal(s.run().phase, "stopped");
});

test("undo accepts an explicit run id", () => {
  const s = committedRun();
  assert.equal(s.cli("undo", s.runId).reverted.length, 2);
});

test("undo refuses with uncommitted changes outside .tenonry and ignores Tenonry's own files", () => {
  const s = committedRun();
  fs.appendFileSync(path.join(s.root, "app/Models/User.php"), "// local edit\n");
  s.write("notes.txt");
  const refused = s.cli("undo");
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "uncommitted_changes");
  assert.deepEqual(refused.files.sort(), ["app/Models/User.php", "notes.txt"]);
  assert.equal(s.run().undone, false);

  git(s.root, "checkout", "--", "app/Models/User.php");
  fs.rmSync(path.join(s.root, "notes.txt"));
  fs.appendFileSync(path.join(s.root, ".gitignore"), "# local\n");
  fs.writeFileSync(path.join(s.root, ".claude", "agents", "tenonry-extra.md"), "x\n");
  fs.appendFileSync(path.join(s.root, ".tenonry", "ownership.json"), " ");
  assert.equal(s.cli("undo").ok, true);
});

test("undo stops cleanly on a conflict and leaves the repository usable", () => {
  const s = committedRun();
  s.write("app/Models/LoyaltyPoint.php", "<?php // edited by someone else\n");
  git(s.root, "add", "-A");
  git(s.root, "commit", "-q", "-m", "user edit");
  const before = git(s.root, "rev-parse", "HEAD");
  const result = s.cli("undo");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "conflict");
  assert.deepEqual(result.reverted, [s.run().tasks.T2.commit]);
  assert.equal(result.stoppedAt, s.run().tasks.T1.commit);
  assert.equal(git(s.root, "status", "--porcelain").split("\n").filter((l) => l && !l.startsWith("??")).length, 0, "no unmerged files remain");
  assert.ok(!fs.existsSync(path.join(s.root, ".git", "REVERT_HEAD")));
  assert.notEqual(git(s.root, "rev-parse", "HEAD"), before, "the first revert was kept");
  assert.equal(s.run().undone, false);
});

test("undo of a run without commits, or with no runs, succeeds with nothing reverted", () => {
  const s = setupScenario({ jev: easy });
  assert.deepEqual(s.cli("undo", s.runId), { ok: true, reverted: [], runId: s.runId });
  assert.deepEqual(s.cli("undo"), { ok: true, reverted: [], runId: null });
});

test("undo outside a git repository reports it", () => {
  const s = committedRun();
  fs.rmSync(path.join(s.root, ".git"), { recursive: true });
  assert.deepEqual(s.cli("undo"), { ok: false, reason: "not_a_git_repo" });
});

test("undo marks an unfinished run as stopped before reverting", () => {
  const s = committedRun();
  const run = s.run();
  run.phase = "building";
  saveRun(s, run);
  s.cli("undo");
  assert.equal(s.run().phase, "stopped");
});

test("report writes every section, in order, and returns the summary", () => {
  const s = committedRun();
  const run = s.run();
  Object.assign(run.tasks.T3, { status: "blocked", tier: "sonnet", notes: ["blocked: could not build the page"] });
  run.tasks.T1.reviews = { code: "pass", design: null };
  run.tasks.T2.notes.push("skipped test: no_tests");
  run.finalGate = { result: "pass" };
  saveRun(s, run);
  const result = s.cli("report", s.runId);
  assert.equal(result.path, `.tenonry/runs/${s.runId}/report.md`);
  const md = fs.readFileSync(path.join(s.root, result.path), "utf8");
  let cursor = -1;
  for (const heading of SECTIONS) {
    const at = md.indexOf(heading);
    assert.ok(at > cursor, `${heading} appears after the previous section`);
    cursor = at;
  }
  assert.match(md, /^# Tenonry report: Loyalty points\n\nRun: r-/);
  assert.match(md, /- done: 2\n- blocked: 1/);
  assert.match(md, /\| T1 Points model \| tenonry-eloquent \| haiku \| 1 \| code pass \| [0-9a-f]{7} \|/);
  assert.match(md, /- T3: could not build the page/);
  assert.match(md, /Result: pass/);
  assert.match(md, /- T2: skipped test: no_tests/);
  assert.match(md, /- Decisions: 2\n- Fallbacks: 0\n- Total cost: \$0/);

  assert.deepEqual(result.summary, {
    done: 2,
    total: 3,
    tasks: [
      { id: "T1", title: "Points model", status: "done" },
      { id: "T2", title: "Points API", status: "done" },
      { id: "T3", title: "Loyalty page", status: "blocked" },
    ],
    attention: ["T3 blocked: could not build the page"],
    tryIt: "composer run dev (http://127.0.0.1:8000)",
    jevCost: 0,
  });
  assert.equal(s.run().phase, "done");
});

test("report: tryIt falls back from the preview to the test command, then to null; stopped stays stopped", () => {
  const s = committedRun();
  s.setConfig({ preview: null });
  assert.match(s.cli("report", s.runId).summary.tryIt, /^sh -c 'echo "FAIL: spec not met"/);
  s.setConfig({ verify: [] });
  assert.equal(s.cli("report", s.runId).summary.tryIt, null);
  const run = s.run();
  run.phase = "stopped";
  saveRun(s, run);
  s.cli("report", s.runId);
  assert.equal(s.run().phase, "stopped");
});

test("report lists unresolved findings and a failed final gate under attention", () => {
  const s = setupScenario({ jev: easy });
  const run = s.run();
  Object.assign(run.tasks.T1, { status: "done_with_findings", unresolved: ["- [major] a.php:1 problem -> fix"], reviews: { code: "fail", design: null } });
  run.finalGate = { result: "fail" };
  saveRun(s, run);
  const result = s.cli("report", s.runId);
  assert.deepEqual(result.summary.attention, ["T1 has 1 unresolved review notes", "the final checks failed"]);
  const md = fs.readFileSync(path.join(s.root, result.path), "utf8");
  assert.match(md, /### T1\n- \[major\] a\.php:1 problem -> fix/);
  assert.match(md, /Result: fail/);
});

function writeLog(s, lines) {
  fs.mkdirSync(path.join(s.root, ".tenonry", "logs"), { recursive: true });
  fs.writeFileSync(path.join(s.root, ".tenonry", "logs", "jev-decisions.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const dispatchLine = (i, model, difficulty, ok = true) => ({
  ts: "t", runId: "r-1", task: `T${i}`, kind: "dispatch", ok,
  fallbackReason: ok ? null : "timeout", answers: ok ? { difficulty: { type: "score", score: difficulty, confidence: 0.9 } } : null,
  decision: { model, reason: "x" }, latencyMs: 1, cost: 0.00001,
});
const outcomeLine = (i, result, attempt = 1) => ({ ts: "t", runId: "r-1", task: `T${i}`, kind: "outcome", model: "x", attempt, result });

test("calibrate reports enoughData false under 20 dispatch decisions", () => {
  const s = setupScenario({ contract: false });
  assert.deepEqual(s.cli("calibrate"), { ok: true, enoughData: false, decisions: 0, needed: 20 });
  writeLog(s, Array.from({ length: 19 }, (_, i) => dispatchLine(i, "haiku", 0.2)));
  assert.equal(s.cli("calibrate").enoughData, false);
});

test("calibrate groups first-attempt outcomes by model and difficulty bucket and suggests changes", () => {
  const s = setupScenario({ contract: false });
  const lines = [];
  let n = 0;
  const add = (model, difficulty, results) => {
    for (const result of results) {
      n += 1;
      lines.push(dispatchLine(n, model, difficulty), outcomeLine(n, result), outcomeLine(n, "pass", 2));
    }
  };
  add("haiku", 0.2, ["pass", "fail", "fail", "pass", "fail"]);
  add("haiku", 0.7, ["pass", "pass"]);
  add("sonnet", 1.8, ["pass", "pass", "pass", "pass", "pass", "pass"]);
  add("sonnet", 0.3, ["fail"]);
  add("opus", 2.7, ["fail", "fail", "pass", "fail", "fail"]);
  lines.push(dispatchLine(99, "sonnet", 0, false));
  lines.push(...Array.from({ length: 3 }, (_, i) => dispatchLine(200 + i, "haiku", 0.1)));
  writeLog(s, lines);

  const result = s.cli("calibrate");
  assert.equal(result.enoughData, true);
  assert.equal(result.decisions, 23);
  assert.equal(result.joined, 19);
  assert.deepEqual(result.byModel.haiku, { count: 7, passRate: 0.57 });
  assert.deepEqual(result.byModel.sonnet, { count: 7, passRate: 0.86 });
  assert.deepEqual(result.byModel.opus, { count: 5, passRate: 0.2 });
  assert.deepEqual(result.buckets.find((b) => b.model === "haiku" && b.bucket === "[0, 0.5)"), { model: "haiku", bucket: "[0, 0.5)", count: 5, passRate: 0.4 });
  assert.deepEqual(result.buckets.find((b) => b.model === "haiku" && b.bucket === "[0.5, 1.5)"), { model: "haiku", bucket: "[0.5, 1.5)", count: 2, passRate: 1 });
  assert.deepEqual(result.buckets.find((b) => b.model === "sonnet" && b.bucket === "[1.5, 2.5)"), { model: "sonnet", bucket: "[1.5, 2.5)", count: 6, passRate: 1 });
  assert.deepEqual(result.buckets.find((b) => b.model === "opus"), { model: "opus", bucket: "[2.5, 3]", count: 5, passRate: 0.2 });
  assert.deepEqual(result.suggestions, [
    "Haiku passed 0.57 of first attempts: lower routing.thresholds.haiku.maxDifficulty from 0.6 to 0.4.",
    "Sonnet passed 1 of first attempts at difficulty 1.5 and above: raise routing.thresholds.opus.minDifficulty from 2 to 2.25.",
    "Opus passed only 0.2 of first attempts: review contracts for over-scoped tasks.",
  ]);
  const config = JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry", "config.json"), "utf8"));
  assert.equal(config.routing.thresholds.haiku.maxDifficulty, 0.6, "calibrate never edits the config");
});

test("calibrate makes no suggestions when the pass rates are healthy", () => {
  const s = setupScenario({ contract: false });
  const lines = [];
  for (let i = 1; i <= 20; i++) lines.push(dispatchLine(i, "haiku", 0.2), outcomeLine(i, "pass"));
  writeLog(s, lines);
  const result = s.cli("calibrate");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.byModel.haiku.passRate, 1);
  assert.equal(result.byModel.opus.passRate, null);
});

test("commands outside a Tenonry project fail with a JSON error", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "plain-"));
  const root = makeProject();
  const result = runNode(path.join(root, ".tenonry", "bin", "tenonry.mjs"), ["status"], { cwd: dir, env: { CLAUDE_PROJECT_DIR: "" } });
  assert.equal(result.status, 1);
  assert.deepEqual(result.json, { ok: false, error: "no_tenonry_project" });
});

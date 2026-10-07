import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setupScenario } from "./helpers/scenario.mjs";
import { dispatchAnswers, riskAnswers } from "./helpers/jev.mjs";

const SCORES = { ux: 8, visual: 8, content: 8, accessibility: 8, performance: 8, responsive: 8, innovation: 8 };

function reviewing({ risk = riskAnswers(0.1, 0.4), ui = false, config, dispatch = dispatchAnswers(), newScreen = true } = {}) {
  const s = setupScenario({ jev: { dispatch, risk }, config });
  if (ui) {
    const run = s.run();
    run.tasks.T1.status = "done";
    run.tasks.T2.status = "done";
    fs.writeFileSync(`${s.runDir}/run.json`, JSON.stringify(run));
    if (!newScreen) {
      const contract = s.contract();
      contract.tasks[2].newScreen = false;
      s.writeContract(contract);
    }
  }
  s.cli("next", s.runId);
  const task = ui ? "T3" : "T1";
  s.write(ui ? "resources/js/Pages/Loyalty.vue" : "app/Models/LoyaltyPoint.php");
  s.flag(true);
  assert.equal(s.cli("verify", s.runId, task).result, "pass");
  return { s, task };
}

const codeReview = (task, findings = [], extra = {}) => ({ task, reviewer: "x", round: 1, verdict: "pass", findings, summary: "ok", ...extra });
const designReview = (task, scores = SCORES, findings = [], extra = {}) => ({ task, reviewer: "tenonry-design-reviewer", round: 1, rendered: true, scores, weighted: 99, verdict: "pass", findings, summary: "ok", ...extra });

test("review-plan: sonnet code reviewer for a low-risk change, with the exact delegation", async () => {
  const { s, task } = reviewing({ dispatch: dispatchAnswers({ difficulty: 1.2, specified: 0.5 }) });
  const plan = s.cli("review-plan", s.runId, task);
  assert.equal(plan.reviewers.length, 1);
  const [code] = plan.reviewers;
  assert.deepEqual([code.agent, code.kind, code.model], ["tenonry-review-eloquent", "code", "sonnet"]);
  assert.equal(
    code.delegation,
    [
      "TENONRY_REVIEW", `run: ${s.runId}`, "task: T1", "kind: code", "round: 1", `contract: .tenonry/runs/${s.runId}/contract.json`,
      "files:", "  - app/Models/LoyaltyPoint.php", `write_to: .tenonry/runs/${s.runId}/reviews/T1.code.json`,
    ].join("\n"),
  );
  const saved = s.run().tasks.T1;
  assert.equal(saved.status, "reviewing");
  assert.deepEqual(saved.reviewRounds, { design: 0, code: 1 });
  assert.deepEqual(s.log().find((l) => l.kind === "risk").decision, { model: "sonnet", risky: 0.1, blastRadius: 0.4, visualChange: null });
});

test("0.4.0: an easy, contained, low-risk task that passed first time gets a haiku code review", () => {
  const { s, task } = reviewing();
  assert.equal(s.run().tasks.T1.difficulty, 0.3, "next records the dispatch difficulty");
  const plan = s.cli("review-plan", s.runId, task);
  assert.deepEqual(plan.reviewers.map((r) => [r.agent, r.kind, r.model]), [["tenonry-review-eloquent", "code", "haiku"]]);
  assert.equal(plan.risk.model, "haiku");

  const boundary = reviewing({ dispatch: dispatchAnswers({ difficulty: 0.6 }), risk: riskAnswers(0.2, 0.5, 0.5) });
  assert.equal(boundary.s.cli("review-plan", boundary.s.runId, boundary.task).reviewers[0].model, "haiku", "the limits are inclusive");
});

test("0.4.0: anything short of trivial keeps the sonnet code review", () => {
  const model = (options) => {
    const { s, task } = reviewing(options);
    return s.cli("review-plan", s.runId, task).reviewers[0].model;
  };
  assert.equal(model({ dispatch: dispatchAnswers({ difficulty: 0.61, specified: 0.5 }) }), "sonnet", "not an easy task");
  assert.equal(model({ risk: riskAnswers(0.21, 0.4) }), "sonnet", "some risk");
  assert.equal(model({ risk: riskAnswers(0.1, 0.51) }), "sonnet", "not contained");
  assert.equal(model({ risk: riskAnswers(0.1, 0.4, 0.49) }), "sonnet", "Jev is unsure how far the change reaches");
  assert.equal(model({ risk: riskAnswers(0.5, 0.2) }), "opus", "a risky change is still reviewed on opus, however easy");
  assert.equal(model({ config: { routing: { thresholds: { codeReviewHaiku: { maxDifficulty: -1 } } } } }), "sonnet", "the knob turns the lighter review off");
});

test("0.4.0: no haiku review after a failed attempt, in a second round, or when the difficulty is unknown", () => {
  const failed = setupScenario({ jev: { dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.4) } });
  failed.cli("next", failed.runId);
  failed.write("app/Models/LoyaltyPoint.php");
  failed.flag(false);
  assert.equal(failed.cli("verify", failed.runId, "T1").action, "resume");
  failed.flag(true);
  assert.equal(failed.cli("verify", failed.runId, "T1").result, "pass");
  assert.equal(failed.cli("review-plan", failed.runId, "T1").reviewers[0].model, "sonnet", "the builder needed a second try");

  const { s, task } = reviewing();
  assert.equal(s.cli("review-plan", s.runId, task).reviewers[0].model, "haiku");
  s.review(task, "code", codeReview(task, [{ severity: "major", file: "a.php", line: 1, problem: "p", fix: "f" }], { verdict: "fail" }));
  assert.equal(s.cli("review-status", s.runId, task).action, "fix");
  assert.equal(s.cli("verify", s.runId, task).result, "pass");
  assert.equal(s.cli("review-plan", s.runId, task).reviewers[0].model, "sonnet", "a fix round is reviewed on sonnet");

  const unknown = setupScenario({ jev: { risk: riskAnswers(0.1, 0.4), dispatch: undefined } });
  unknown.cli("next", unknown.runId);
  assert.equal(unknown.run().tasks.T1.difficulty, null);
  unknown.write("app/Models/LoyaltyPoint.php");
  unknown.flag(true);
  unknown.cli("verify", unknown.runId, "T1");
  assert.equal(unknown.cli("review-plan", unknown.runId, "T1").reviewers[0].model, "sonnet");
});

test("0.4.0: a ui task that does not change layout or styling skips the design reviewer", () => {
  const { s, task } = reviewing({ ui: true, newScreen: false, risk: riskAnswers(0.1, 0.4, 0.9, 0.1), dispatch: dispatchAnswers({ difficulty: 1.2, specified: 0.5 }) });
  const plan = s.cli("review-plan", s.runId, task);
  assert.deepEqual(plan.reviewers.map((r) => [r.agent, r.kind, r.model]), [["tenonry-review-vue", "code", "sonnet"]]);
  assert.match(plan.reviewers[0].delegation, /design_brief: /, "the code reviewer still checks the UI rules");
  const saved = s.run().tasks[task];
  assert.equal(saved.visualReview, false);
  assert.deepEqual(saved.plannedReviews, ["code"]);
  assert.deepEqual(saved.reviewRounds, { design: 0, code: 1 });
  assert.deepEqual(saved.notes.filter((n) => n.includes("design review")), ["skipped design review: the change does not alter layout or styling"]);
  assert.equal(s.log().find((l) => l.kind === "risk").decision.visualChange, 0.1);

  s.review(task, "code", codeReview(task));
  const status = s.cli("review-status", s.runId, task);
  assert.deepEqual([status.overall, status.action, status.design], ["pass", "checkpoint", null]);
  s.cli("checkpoint", s.runId, task);
  assert.equal(s.run().tasks[task].status, "done");
  const report = fs.readFileSync(`${s.runDir}/../../../${s.cli("report", s.runId).path}`, "utf8");
  assert.match(report, /- T3: skipped design review: the change does not alter layout or styling/);
});

test("0.4.0: the design reviewer still runs for a visual change, a new screen, and without Jev", () => {
  const kinds = (options, env) => {
    const { s, task } = reviewing({ ui: true, ...options });
    if (env) s.cli.env = env;
    const planned = s.cli("review-plan", s.runId, task).reviewers.map((r) => r.kind);
    return { planned, saved: s.run().tasks[task] };
  };
  assert.deepEqual(kinds({ newScreen: false, risk: riskAnswers(0.1, 0.4, 0.9, 0.5) }).planned, ["code", "design"], "at the threshold");
  const fresh = kinds({ newScreen: true, risk: riskAnswers(0.1, 0.4, 0.9, 0.0) });
  assert.deepEqual(fresh.planned, ["code", "design"], "a new screen is always looked at");
  assert.equal(fresh.saved.visualReview, true);
  assert.equal(kinds({ newScreen: false, risk: riskAnswers(0.1, 0.4, 0.9, 0.0) }, { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" }).planned.join(), "code,design", "no Jev, no skip");
  assert.deepEqual(kinds({ newScreen: false, risk: riskAnswers(0.1, 0.4, 0.9, 0.2), config: { routing: { thresholds: { design: { minVisualChange: 0 } } } } }).planned, ["code", "design"], "the knob turns the skip off");
});

test("0.4.0: the design review decision is made once per task and kept in later rounds", () => {
  const { s, task } = reviewing({ ui: true, newScreen: false, risk: riskAnswers(0.1, 0.4, 0.9, 0.9) });
  assert.deepEqual(s.cli("review-plan", s.runId, task).reviewers.map((r) => r.kind), ["code", "design"]);
  s.cli.env = { TENONRY_JEV_FIXTURE: s.env.TENONRY_JEV_FIXTURE };
  fs.writeFileSync(s.env.TENONRY_JEV_FIXTURE, JSON.stringify({ dispatch: dispatchAnswers(), risk: riskAnswers(0.1, 0.4, 0.9, 0.0) }));
  assert.deepEqual(s.cli("review-plan", s.runId, task).reviewers.map((r) => r.kind), ["code", "design"], "a low answer in round two does not drop the reviewer");
  assert.equal(s.log().filter((l) => l.kind === "risk").at(-1).decision.visualChange, null, "the question is not asked again");
});

test("review-plan: opus when risky or wide, and opus when Jev is unavailable", () => {
  const risky = reviewing({ risk: riskAnswers(0.9, 0.2) });
  assert.equal(risky.s.cli("review-plan", risky.s.runId, risky.task).reviewers[0].model, "opus");
  const wide = reviewing({ risk: riskAnswers(0.1, 1.5) });
  assert.equal(wide.s.cli("review-plan", wide.s.runId, wide.task).reviewers[0].model, "opus");
  const down = reviewing();
  down.s.cli.env = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "1" };
  const plan = down.s.cli("review-plan", down.s.runId, down.task);
  assert.equal(plan.reviewers[0].model, "opus");
  assert.equal(plan.risk.fallback, true);
});

test("review-plan: ui tasks also get an opus design reviewer with preview details", () => {
  const { s, task } = reviewing({ ui: true });
  const plan = s.cli("review-plan", s.runId, task);
  assert.deepEqual(plan.reviewers.map((r) => [r.agent, r.kind, r.model]), [
    ["tenonry-review-vue", "code", "haiku"],
    ["tenonry-design-reviewer", "design", "opus"],
  ]);
  const design = plan.reviewers[1].delegation;
  assert.equal(
    design,
    [
      "TENONRY_REVIEW", `run: ${s.runId}`, "task: T3", "kind: design", "round: 1", `contract: .tenonry/runs/${s.runId}/contract.json`,
      "files:", "  - resources/js/Pages/Loyalty.vue", "design_direction: .tenonry/design-direction.md",
      `design_brief: .tenonry/runs/${s.runId}/design-brief.md`, "preview_command: composer run dev", "preview_url: http://127.0.0.1:8000",
      "preview_cwd: .", "login: none", `write_to: .tenonry/runs/${s.runId}/reviews/T3.design.json`,
    ].join("\n"),
  );
  assert.equal(
    plan.reviewers[0].delegation,
    [
      "TENONRY_REVIEW", `run: ${s.runId}`, "task: T3", "kind: code", "round: 1", `contract: .tenonry/runs/${s.runId}/contract.json`,
      "files:", "  - resources/js/Pages/Loyalty.vue", "design_direction: .tenonry/design-direction.md",
      `design_brief: .tenonry/runs/${s.runId}/design-brief.md`, `write_to: .tenonry/runs/${s.runId}/reviews/T3.code.json`,
    ].join("\n"),
    "F9: a code review of a ui task carries the design lines but no preview or login lines",
  );
  assert.deepEqual(s.run().tasks.T3.reviewRounds, { design: 1, code: 1 });
});

test("review-plan omits preview details as none and removes stale review files", () => {
  const { s, task } = reviewing({ ui: true });
  s.setConfig({ preview: null });
  s.review(task, "code", codeReview(task));
  const plan = s.cli("review-plan", s.runId, task);
  assert.match(plan.reviewers[1].delegation, /preview_command: none\npreview_url: none\npreview_cwd: none\nlogin: none\n/);
  assert.ok(!fs.existsSync(`${s.runDir}/reviews/${task}.code.json`));
});

test("review-status: a passing code review checkpoints", () => {
  const { s, task } = reviewing();
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task, [{ severity: "minor", file: "a.php", line: 1, rule: "C2", problem: "name", fix: "rename" }]));
  const status = s.cli("review-status", s.runId, task);
  assert.equal(status.overall, "pass");
  assert.equal(status.action, "checkpoint");
  assert.equal(status.code.status, "pass");
  assert.equal(status.design, null);
  assert.equal(status.delegation, null);
});

test("review-status: blocking or major findings fail and produce fix feedback", () => {
  const { s, task } = reviewing();
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task, [
    { severity: "major", file: "app/Models/LoyaltyPoint.php", line: 14, rule: "C3", problem: "Fillable allows user_id.", fix: "Remove user_id." },
    { severity: "minor", file: "app/Models/LoyaltyPoint.php", line: 2, rule: "C2", problem: "Vague name.", fix: "Rename." },
  ], { verdict: "pass" }));
  const status = s.cli("review-status", s.runId, task);
  assert.equal(status.overall, "fail");
  assert.equal(status.action, "fix");
  assert.equal(status.feedback, "- [major] app/Models/LoyaltyPoint.php:14 Fillable allows user_id. -> Remove user_id.");
  assert.match(status.delegation, /^TENONRY_TASK\n[\s\S]*mode: fix[\s\S]*feedback:\n  - \[major\] app\/Models/);
  assert.equal(s.run().tasks.T1.status, "running");
});

test("review-status: a missing or invalid review file is an error and fails the round", () => {
  const { s, task } = reviewing();
  s.cli("review-plan", s.runId, task);
  const missing = s.cli("review-status", s.runId, task);
  assert.equal(missing.code.status, "error");
  assert.equal(missing.overall, "fail");
  assert.equal(missing.action, "fix");

  s.cli("review-plan", s.runId, task);
  s.write(`.tenonry/runs/${s.runId}/reviews/${task}.code.json`, "{ nope");
  assert.equal(s.cli("review-status", s.runId, task).code.status, "error");
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", { findings: [{ severity: "huge" }] });
  assert.equal(s.cli("review-status", s.runId, task).code.status, "error");
});

test("review-status: code round limit ends in done_with_findings", () => {
  const { s, task } = reviewing();
  const failing = codeReview(task, [{ severity: "blocking", file: "a.php", line: 1, rule: "C1", problem: "Bug.", fix: "Fix." }]);
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", failing);
  assert.equal(s.cli("review-status", s.runId, task).action, "fix");
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", failing);
  const last = s.cli("review-status", s.runId, task);
  assert.equal(last.action, "checkpoint");
  assert.equal(last.overall, "fail");
  const saved = s.run().tasks.T1;
  assert.equal(saved.status, "done_with_findings");
  assert.deepEqual(saved.unresolved, ["- [blocking] a.php:1 Bug. -> Fix."]);
});

test("review-status: design weighted score is recomputed and the pass rule applied", () => {
  const { s, task } = reviewing({ ui: true });
  const plan = () => s.cli("review-plan", s.runId, task);
  plan();
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, SCORES));
  const pass = s.cli("review-status", s.runId, task);
  assert.equal(pass.overall, "pass");
  assert.equal(pass.design.status, "pass");
  assert.equal(pass.design.weighted, 8);

  plan();
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, { ...SCORES, visual: 6, innovation: 6 }, [], { weighted: 9.9 }));
  const low = s.cli("review-status", s.runId, task);
  assert.equal(low.design.weighted, 7.3, "the reviewer's own figure is ignored");
  assert.equal(low.design.status, "fail");
  assert.match(low.feedback, /^- \[design\] showcase weighted score 7\.3/);

  plan();
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, { ...SCORES, ux: 5, innovation: 10, visual: 10, performance: 10 }));
  const floor = s.cli("review-status", s.runId, task);
  assert.ok(floor.design.weighted >= 7.5);
  assert.equal(floor.design.status, "fail", "a criterion below 6 fails");

  plan();
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, SCORES, [{ severity: "blocking", criterion: "accessibility", file: "resources/js/Pages/Loyalty.vue", problem: "No focus ring.", fix: "Add one." }]));
  const blocking = s.cli("review-status", s.runId, task);
  assert.equal(blocking.design.status, "fail");
  assert.match(blocking.feedback, /- \[blocking\] resources\/js\/Pages\/Loyalty\.vue No focus ring\. -> Add one\./);
});

test("F7: an unrendered design review never passes on guessed scores: checkpoint, then done_with_findings", () => {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, SCORES, [], { rendered: false, unrenderedReason: "needs_login" }));
  const status = s.cli("review-status", s.runId, task);
  assert.deepEqual(status.design, { status: "unrendered", rendered: false, unrenderedReason: "needs_login" });
  assert.equal(status.overall, "pass");
  assert.equal(status.action, "checkpoint");
  assert.equal(status.delegation, null);
  assert.equal(status.feedback, "");
  assert.equal(s.run().tasks[task].status, "reviewing", "review-status leaves the final status to checkpoint");

  assert.ok(s.cli("checkpoint", s.runId, task).sha);
  const saved = s.run().tasks[task];
  assert.equal(saved.status, "done_with_findings");
  assert.equal(saved.reviews.design, "unrendered");
  assert.equal(saved.unrenderedReason, "needs_login");
});

const UNRENDERED_NOTES = {
  needs_login: "Design for T3 was not visually checked: the screen needs a signed-in user. Add TENONRY_PREVIEW_USER and TENONRY_PREVIEW_PASSWORD (a local test account) to .env.",
  browser_missing: "Design for T3 was not visually checked: the review browser is not installed. Run: npx @playwright/mcp@0.0.83 install-browser chrome",
  preview_failed: "Design for T3 was not visually checked: the preview server did not start. See .tenonry/logs/preview.log.",
  no_preview: 'Design for T3 was not visually checked: no preview command was detected. Set "preview" in .tenonry/config.json.',
  "the page crashed on load": "Design for T3 was not visually checked: the page crashed on load.",
};

for (const [reason, note] of Object.entries(UNRENDERED_NOTES)) {
  test(`F7: the report carries exactly one attention note for an unrendered review (${reason})`, () => {
    const { s, task } = reviewing({ ui: true });
    s.cli("review-plan", s.runId, task);
    s.review(task, "code", codeReview(task));
    s.review(task, "design", { task, rendered: false, unrenderedReason: reason, scores: SCORES, findings: [] });
    assert.equal(s.cli("review-status", s.runId, task).action, "checkpoint");
    s.cli("checkpoint", s.runId, task);
    const report = s.cli("report", s.runId);
    assert.deepEqual(report.summary.attention, [note]);
    assert.equal(report.summary.tasks.find((t) => t.id === task).status, "done_with_findings");
    const md = fs.readFileSync(`${s.root}/${report.path}`, "utf8");
    assert.ok(md.includes(`- ${note}`));
    assert.match(md, /code pass, design unrendered/);
  });
}

test("F7: an unrendered review without a reason, scores, or findings still counts as unrendered", () => {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", { task, rendered: false });
  const status = s.cli("review-status", s.runId, task);
  assert.deepEqual(status.design, { status: "unrendered", rendered: false, unrenderedReason: null });
  s.cli("checkpoint", s.runId, task);
  assert.deepEqual(s.cli("report", s.runId).summary.attention, ["Design for T3 was not visually checked: no reason was given."]);
});

test("F7: an unrendered design review never starts a fix round, but a failing code review still does", () => {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task, [{ severity: "major", file: "a.vue", line: 3, problem: "p", fix: "f" }]));
  s.review(task, "design", designReview(task, { ...SCORES, visual: 1 }, [{ severity: "blocking", criterion: "visual", problem: "guess", fix: "guess" }], { rendered: false, unrenderedReason: "preview_failed" }));
  const status = s.cli("review-status", s.runId, task);
  assert.equal(status.overall, "fail");
  assert.equal(status.action, "fix");
  assert.equal(status.feedback, "- [major] a.vue:3 p -> f", "feedback holds only the code finding, never guessed design findings");
});

test("F7: a later rendered review clears the unrendered state", () => {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", { task, rendered: false, unrenderedReason: "browser_missing" });
  s.cli("review-status", s.runId, task);
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task));
  assert.equal(s.cli("review-status", s.runId, task).design.status, "pass");
  s.cli("checkpoint", s.runId, task);
  const saved = s.run().tasks[task];
  assert.deepEqual([saved.status, saved.unrenderedReason], ["done", null]);
});

test("F7: a rendered showcase review exactly at the pass boundary still passes", () => {
  const { s, task } = reviewing({ ui: true });
  const boundary = { ux: 8, visual: 8, content: 7, accessibility: 7, performance: 8, responsive: 7, innovation: 7 };
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, boundary, [], { profile: "showcase" }));
  const status = s.cli("review-status", s.runId, task);
  assert.deepEqual(status.design, { status: "pass", profile: "showcase", weighted: 7.5, rendered: true, findings: 0 });
  assert.equal(status.overall, "pass");
});

test("review-status: design rounds allow three tries before done_with_findings", () => {
  const { s, task } = reviewing({ ui: true });
  const weak = designReview(task, { ...SCORES, visual: 5 });
  const actions = [];
  for (let round = 0; round < 3; round++) {
    s.cli("review-plan", s.runId, task);
    s.review(task, "code", codeReview(task));
    s.review(task, "design", weak);
    actions.push(s.cli("review-status", s.runId, task).action);
  }
  assert.deepEqual(actions, ["fix", "fix", "checkpoint"]);
  assert.equal(s.run().tasks.T3.status, "done_with_findings");
});

test("review-status: both reviewers must pass", () => {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task, [{ severity: "major", file: "a.vue", line: 3, problem: "p", fix: "f" }]));
  s.review(task, "design", designReview(task));
  const status = s.cli("review-status", s.runId, task);
  assert.equal(status.code.status, "fail");
  assert.equal(status.design.status, "pass");
  assert.equal(status.overall, "fail");
});

test("F6: design delegations say login: available when preview credentials exist, and never contain them", () => {
  const { s, task } = reviewing({ ui: true });
  const secrets = ["reviewer@example.test", "local-secret-pw-91"];
  fs.writeFileSync(`${s.root}/.env`, `TENONRY_PREVIEW_USER=${secrets[0]}\nTENONRY_PREVIEW_PASSWORD=${secrets[1]}\nTENONRY_PREVIEW_LOGIN_URL=/sign-in\n`);
  const plan = s.cli("review-plan", s.runId, task);
  const [code, design] = plan.reviewers;
  assert.match(design.delegation, /\npreview_cwd: \.\nlogin: available\nwrite_to: /);
  assert.ok(!code.delegation.includes("login:"), "code reviews carry no login line");
  assert.deepEqual(s.cli("preview-credentials"), { ok: true, available: true, loginUrl: "http://127.0.0.1:8000/sign-in", user: secrets[0], password: secrets[1] });

  const haystack = [JSON.stringify(plan)];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(full);
      else haystack.push(fs.readFileSync(full, "utf8"));
    }
  };
  collect(`${s.root}/.tenonry/logs`);
  collect(`${s.root}/.tenonry/runs`);
  haystack.push(fs.readFileSync(`${s.root}/.tenonry/state.json`, "utf8"));
  for (const secret of secrets) assert.ok(!haystack.some((text) => text.includes(secret)), "credentials never reach a delegation, log, or run file");
});

test("F6: design delegations say login: none with only one credential value", () => {
  const { s, task } = reviewing({ ui: true });
  fs.writeFileSync(`${s.root}/.env`, "TENONRY_PREVIEW_USER=someone\n");
  assert.match(s.cli("review-plan", s.runId, task).reviewers[1].delegation, /\nlogin: none\n/);
});

test("F9: code review delegations carry design lines only for ui tasks", () => {
  const ui = reviewing({ ui: true });
  const uiCode = ui.s.cli("review-plan", ui.s.runId, ui.task).reviewers.find((r) => r.kind === "code").delegation;
  assert.match(uiCode, /\ndesign_direction: \.tenonry\/design-direction\.md\ndesign_brief: \.tenonry\/runs\/r-[^/]+\/design-brief\.md\nwrite_to: /);
  assert.ok(!/preview_|login:/.test(uiCode));

  const backend = reviewing();
  const backendCode = backend.s.cli("review-plan", backend.s.runId, backend.task).reviewers[0].delegation;
  assert.ok(!/design_|preview_|login:/.test(backendCode));
});

// F10: showcase and product scoring profiles.
const PRODUCT_SCORES = { ux: 8, visual: 7, content: 7, accessibility: 8, performance: 8, responsive: 8, innovation: 5 };

function designStatus(scores, extra) {
  const { s, task } = reviewing({ ui: true });
  s.cli("review-plan", s.runId, task);
  s.review(task, "code", codeReview(task));
  s.review(task, "design", designReview(task, scores, [], extra));
  return s.cli("review-status", s.runId, task);
}

test("F10: a product screen passes at 7.50 with innovation 5", () => {
  const status = designStatus(PRODUCT_SCORES, { profile: "product" });
  assert.deepEqual(status.design, { status: "pass", profile: "product", weighted: 7.5, rendered: true, findings: 0 });
  assert.equal(status.overall, "pass");
});

test("F10: the same scores fail as a showcase page because innovation is below 6", () => {
  const status = designStatus(PRODUCT_SCORES, { profile: "showcase" });
  assert.equal(status.design.status, "fail");
  assert.equal(status.design.profile, "showcase");
  assert.equal(status.design.weighted, 7.15);
  assert.match(status.feedback, /^- \[design\] showcase weighted score 7\.15 \(needs 7\.5, every criterion at least 6\)/);
});

test("F10: a product screen with innovation 4 fails, and other criteria still need 6", () => {
  const low = designStatus({ ...PRODUCT_SCORES, innovation: 4, ux: 10, performance: 10 }, { profile: "product" });
  assert.ok(low.design.weighted >= 7.5);
  assert.equal(low.design.status, "fail");
  assert.match(low.feedback, /product weighted score .* every criterion at least 6, innovation at least 5\)/);
  const weakContent = designStatus({ ...PRODUCT_SCORES, content: 5, ux: 10, performance: 10 }, { profile: "product" });
  assert.equal(weakContent.design.status, "fail");
});

test("F10: a missing or unknown profile is judged with showcase weights", () => {
  for (const extra of [{}, { profile: "landing" }, { profile: null }]) {
    const status = designStatus(PRODUCT_SCORES, extra);
    assert.deepEqual([status.design.profile, status.design.weighted, status.design.status], ["showcase", 7.15, "fail"]);
  }
});

test("F10: both weight tables sum to 1.00 and match the shipped rubric", async () => {
  const { DESIGN_PROFILES, weightedScore } = await import("../scripts/lib/review.mjs");
  for (const [profile, weights] of Object.entries(DESIGN_PROFILES)) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 100) / 100, 1, profile);
    assert.equal(weightedScore({ ux: 10, visual: 10, content: 10, accessibility: 10, performance: 10, responsive: 10, innovation: 10 }, profile), 10);
  }
  const rubric = fs.readFileSync(new URL("../library/rubrics/design.md", import.meta.url), "utf8");
  for (const [criterion, showcase] of Object.entries(DESIGN_PROFILES.showcase)) {
    const product = DESIGN_PROFILES.product[criterion];
    assert.ok(rubric.includes(`| ${criterion} | ${showcase.toFixed(2)} | ${product.toFixed(2)} |`), `table row for ${criterion}`);
    assert.match(rubric, new RegExp(`^### ${criterion}: .* \\(weight: showcase ${showcase.toFixed(2)}, product ${product.toFixed(2)}\\)$`, "m"));
  }
  assert.ok(!/\(weight \d/.test(rubric), "no single-weight heading remains");
});

test("F10: the art director sets a profile for every screen in the brief", () => {
  const text = fs.readFileSync(new URL("../library/core/art-director.md", import.meta.url), "utf8");
  assert.ok(
    text.includes(
      "- Purpose and primary action\n- Profile: `showcase` (marketing, landing, and storytelling pages judged as award work) or `product` (screens where people get work done: forms, tables, dashboards, settings)\n",
    ),
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupScenario, contractFor } from "./helpers/scenario.mjs";

function withContract(mutate) {
  const s = setupScenario({ contract: false });
  const contract = contractFor(s.runId);
  mutate(contract, s);
  s.writeContract(contract);
  return { s, result: s.cli("contract-check", s.runId) };
}

function assertInvalid(mutate, pattern) {
  const { s, result } = withContract(mutate);
  assert.equal(result.valid, false, "contract should be invalid");
  assert.ok(result.errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(result.errors)}`);
  assert.equal(result.contractFixes, 1);
  assert.deepEqual(Object.keys(s.run().tasks), [], "tasks are not added for an invalid contract");
}

test("a valid contract passes, adds pending tasks, and warns about nothing blocking", () => {
  const { s, result } = withContract(() => {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.contractFixes, 0);
  assert.deepEqual(result.warnings, ["T3: no tests"]);
  const tasks = s.run().tasks;
  assert.deepEqual(Object.keys(tasks), ["T1", "T2", "T3"]);
  for (const task of Object.values(tasks)) assert.equal(task.status, "pending");
  assert.equal(tasks.T2.owner, "tenonry-laravel");
});

test("rule 1: invalid JSON, wrong version, or wrong runId", () => {
  const s = setupScenario({ contract: false });
  s.write(`.tenonry/runs/${s.runId}/contract.json`, "{not json");
  const broken = s.cli("contract-check", s.runId);
  assert.equal(broken.valid, false);
  assert.match(broken.errors[0], /not valid JSON/);
  assertInvalid((c) => { c.version = 2; }, /version must be 1/);
  assertInvalid((c) => { c.runId = "r-other"; }, /runId must be/);
});

test("rule 2: no tasks, bad ids, duplicate ids", () => {
  assertInvalid((c) => { c.tasks = []; }, /no tasks/);
  assertInvalid((c) => { c.tasks[0].id = "task-1"; }, /id must match/);
  assertInvalid((c) => { c.tasks[1].id = "T1"; c.tasks[2].dependsOn = []; c.tasks[1].dependsOn = []; }, /duplicate task id/);
});

test("rule 3: owner not an active builder specialist", () => {
  assertInvalid((c) => { c.tasks[0].owner = "tenonry-django"; }, /not an active builder/);
  assertInvalid((c) => { c.tasks[0].owner = "tenonry-planner"; }, /not an active builder/);
  assertInvalid((c) => { c.tasks[0].owner = "tenonry-test-author"; }, /not an active builder/);
  assertInvalid((c) => { c.tasks[0].owner = "tenonry-review-vue"; }, /not an active builder/);
  assertInvalid((c) => { c.tasks[0].owner = "tenonry-design-reviewer"; }, /not an active builder/);
});

test("rule 4: empty files, unsafe paths, and files the owner does not own", () => {
  assertInvalid((c) => { c.tasks[0].files = []; }, /files must not be empty/);
  assertInvalid((c) => { c.tasks[0].files = ["/etc/passwd"]; }, /normalized relative path/);
  assertInvalid((c) => { c.tasks[0].files = ["../outside.php"]; }, /normalized relative path/);
  assertInvalid((c) => { c.tasks[0].files = ["./app/Models/A.php"]; }, /normalized relative path/);
  assertInvalid((c) => { c.tasks[0].files = ["resources/js/a.vue"]; }, /resources\/js\/a\.vue is owned by tenonry-vue, not tenonry-eloquent/);
  assertInvalid((c) => { c.tasks[0].files = ["docs/readme.xyz"]; }, /docs\/readme\.xyz is owned by unowned/);
  assertInvalid((c) => { c.tasks[0].files = [".env"]; }, /\.env is owned by none/);
});

test("rule 5: a file listed in two tasks", () => {
  assertInvalid((c) => { c.tasks[1].files.push("app/Models/LoyaltyPoint.php"); c.tasks[1].owner = "tenonry-eloquent"; }, /listed in both T1 and T2/);
});

test("rule 6: unknown dependency and cycles", () => {
  assertInvalid((c) => { c.tasks[0].dependsOn = ["T9"]; }, /unknown task T9/);
  assertInvalid((c) => { c.tasks[0].dependsOn = ["T3"]; }, /dependency cycle/);
});

test("rule 7: tests must be owned by the test author and exist", () => {
  assertInvalid((c) => { c.tasks[0].tests = ["tests/Unit/Missing.php"]; }, /does not exist on disk/);
  assertInvalid((c) => { c.tasks[0].tests = ["app/Models/User.php"]; }, /not owned by tenonry-test-author/);
});

test("rule 8: unknown agents in interfaces and unknown interface references", () => {
  assertInvalid((c) => { c.interfaces[0].provider = "tenonry-django"; }, /tenonry-django is not an active agent/);
  assertInvalid((c) => { c.interfaces[0].consumers = ["tenonry-ghost"]; }, /tenonry-ghost is not an active agent/);
  assertInvalid((c) => { c.tasks[0].interfaces = ["GET /nope"]; }, /unknown interface GET \/nope/);
});

test("rule 9: ui true on a backend owner", () => {
  assertInvalid((c) => { c.tasks[0].ui = true; }, /not a frontend or 3d specialist/);
});

test("warnings: no tests, more than 12 files, newScreen without ui", () => {
  const { result } = withContract((c) => {
    c.tasks[0].tests = [];
    c.tasks[0].files = Array.from({ length: 13 }, (_, i) => `app/Models/M${i}.php`);
    c.tasks[2].ui = false;
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.includes("T1: no tests"));
  assert.ok(result.warnings.some((w) => w.startsWith("T1: 13 files")));
  assert.ok(result.warnings.includes("T3: newScreen is true but ui is false"));
});

test("a missing contract file is invalid and counts as a fix attempt", () => {
  const s = setupScenario({ contract: false });
  const result = s.cli("contract-check", s.runId);
  assert.equal(result.valid, false);
  assert.equal(result.contractFixes, 1);
  assert.equal(s.cli("contract-check", s.runId).contractFixes, 2);
});

test("re-checking after a fix adds new tasks and keeps existing task state", () => {
  const s = setupScenario();
  s.cli("next", s.runId);
  const contract = s.contract();
  contract.tasks.push({
    id: "T4", title: "More", owner: "tenonry-eloquent", summary: "s", files: ["app/Models/Extra.php"], dependsOn: [],
    acceptance: ["x"], tests: [], ui: false, newScreen: false, interfaces: [],
  });
  s.writeContract(contract);
  assert.equal(s.cli("contract-check", s.runId).valid, true);
  const tasks = s.run().tasks;
  assert.equal(tasks.T1.status, "running");
  assert.equal(tasks.T4.status, "pending");
});

test("run-scoped owner rules count when checking ownership", () => {
  const s = setupScenario({ contract: false });
  assert.equal(s.cli("owner", "docs/new.vue", "--run", s.runId).owner, "tenonry-vue");
  const contract = contractFor(s.runId);
  contract.tasks[2].files.push("docs/new.vue");
  s.writeContract(contract);
  assert.equal(s.cli("contract-check", s.runId).valid, true);
});

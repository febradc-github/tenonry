import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState, newRun, loadRun, saveRun, listRunIds, setNotice, patchState, updateTask, newTask } from "../scripts/lib/state.mjs";
import { makeProject } from "./helpers/project.mjs";

test("state defaults and notices", () => {
  const root = makeProject();
  assert.deepEqual(readState(root), { activeRun: null, restartPending: false, notices: { jevKeyMissing: false } });
  setNotice(root, "jevKeyMissing");
  assert.equal(readState(root).notices.jevKeyMissing, true);
  patchState(root, { restartPending: true });
  assert.equal(readState(root).restartPending, true);
  assert.equal(readState(root).notices.jevKeyMissing, true);
});

test("newRun creates the run directory, run.json, and sets the active run", () => {
  const root = makeProject();
  const { runId, runDir } = newRun(root, "add points");
  assert.match(runId, /^r-\d{8}-\d{6}-[0-9a-f]{4}$/);
  for (const dir of ["reports", "reviews"]) assert.ok(fs.statSync(path.join(runDir, dir)).isDirectory());
  const run = loadRun(root, runId);
  assert.deepEqual(run, {
    id: runId, createdAt: run.createdAt, prompt: "add points", phase: "intake", contractFixes: 0, finalGate: null,
    finalGateReopened: false, undone: false, tasks: {},
  });
  assert.equal(readState(root).activeRun, runId);
  assert.deepEqual(listRunIds(root), [runId]);
});

test("a new run stops the previous unfinished run but leaves a done run alone", () => {
  const root = makeProject();
  const first = newRun(root, "one").runId;
  const second = newRun(root, "two").runId;
  assert.equal(loadRun(root, first).phase, "stopped");
  assert.equal(readState(root).activeRun, second);

  const done = loadRun(root, second);
  done.phase = "done";
  saveRun(root, done);
  const third = newRun(root, "three").runId;
  assert.equal(loadRun(root, second).phase, "done");
  assert.notEqual(third, second);
});

test("run ids are unique and sortable", () => {
  const root = makeProject();
  const ids = Array.from({ length: 5 }, (_, i) => newRun(root, `r${i}`).runId);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(listRunIds(root), [...ids].sort());
});

test("updateTask patches known tasks and rejects unknown ones", () => {
  const run = { tasks: { T1: newTask({ owner: "tenonry-x" }) } };
  assert.equal(run.tasks.T1.status, "pending");
  assert.deepEqual(run.tasks.T1.reviewRounds, { design: 0, code: 0 });
  updateTask(run, "T1", { status: "running", tier: "haiku" });
  assert.equal(run.tasks.T1.status, "running");
  assert.throws(() => updateTask(run, "T9", {}), /unknown task T9/);
});

test("loadRun returns null for a missing run", () => {
  assert.equal(loadRun(makeProject(), "r-none"), null);
});

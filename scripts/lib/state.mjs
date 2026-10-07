import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./json.mjs";
import { runDir } from "./paths.mjs";

const DEFAULT_STATE = { activeRun: null, restartPending: false, notices: { jevKeyMissing: false } };
export const statePath = (root) => path.join(root, ".tenonry", "state.json");
export const runFile = (root, runId) => path.join(runDir(root, runId), "run.json");

export function readState(root) {
  const stored = readJson(statePath(root), {});
  return { ...DEFAULT_STATE, ...stored, notices: { ...DEFAULT_STATE.notices, ...stored.notices } };
}

export function writeState(root, state) {
  writeJsonAtomic(statePath(root), state);
}

export function patchState(root, patch) {
  const state = readState(root);
  Object.assign(state, patch);
  writeState(root, state);
  return state;
}

export function setNotice(root, name, value = true) {
  const state = readState(root);
  state.notices[name] = value;
  writeState(root, state);
  return state;
}

function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  return `r-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

export function loadRun(root, runId) {
  return readJson(runFile(root, runId), null);
}

export function saveRun(root, run) {
  writeJsonAtomic(runFile(root, run.id), run);
}

export function listRunIds(root) {
  try {
    return fs.readdirSync(path.join(root, ".tenonry", "runs")).filter((name) => name.startsWith("r-")).sort();
  } catch {
    return [];
  }
}

// Creates the run directory and run.json; a previous unfinished active run becomes `stopped`.
export function newRun(root, prompt) {
  const state = readState(root);
  if (state.activeRun) {
    const previous = loadRun(root, state.activeRun);
    if (previous && previous.phase !== "done" && previous.phase !== "stopped") {
      previous.phase = "stopped";
      saveRun(root, previous);
    }
  }
  const runId = newRunId();
  const dir = runDir(root, runId);
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reviews"), { recursive: true });
  saveRun(root, {
    id: runId,
    createdAt: new Date().toISOString(),
    prompt,
    phase: "intake",
    contractFixes: 0,
    finalGate: null,
    finalGateReopened: false,
    undone: false,
    tasks: {},
  });
  state.activeRun = runId;
  writeState(root, state);
  return { runId, runDir: dir };
}

export function newTask(patch) {
  return {
    status: "pending",
    owner: null,
    tier: null,
    failuresOnTier: 0,
    attempts: [],
    reviewRounds: { design: 0, code: 0 },
    baseline: null,
    changedFiles: [],
    commit: null,
    notes: [],
    ...patch,
  };
}

export function updateTask(run, taskId, patch) {
  const task = run.tasks[taskId];
  if (!task) throw new Error(`unknown task ${taskId}`);
  Object.assign(task, patch);
  return task;
}

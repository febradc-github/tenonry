import { loadContext, taskDefinition, runTask, layerOf, specialistOf, FINISHED, ACTIVE, CliError } from "./ctx.mjs";
import { loadRules, resolveOwner, ownerAllows } from "./ownership.mjs";
import { decideWithJev } from "./jev.mjs";
import { dispatchQuestions, mapDispatch, fallbackDispatch, applyFloor } from "./routing.mjs";
import { buildMessage } from "./delegation.mjs";
import * as git from "./git.mjs";

export const PHASES = ["intake", "planning", "design", "contract", "building", "final-gate", "done", "stopped"];
const IGNORED_PREFIX = ".tenonry/runs/";

// Files changed since the task's baseline that its owner may change (docs/03 section 6.2 step 1).
export function attributedFiles(ctx, taskId) {
  const task = runTask(ctx, taskId);
  const owner = taskDefinition(ctx, taskId).owner;
  const rules = loadRules(ctx.root, ctx.runId);
  return git
    .diffSince(ctx.root, task.baseline)
    .filter((file) => !file.startsWith(IGNORED_PREFIX))
    .filter((file) => ownerAllows(resolveOwner(rules, file)?.owner, owner));
}

function blockDependents(ctx) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of ctx.contract.tasks) {
      const task = ctx.run.tasks[def.id];
      if (!task || task.status !== "pending") continue;
      const blocker = (def.dependsOn ?? []).find((id) => ctx.run.tasks[id]?.status === "blocked");
      if (!blocker) continue;
      task.status = "blocked";
      task.notes.push(`dependency ${blocker} blocked`);
      changed = true;
    }
  }
}

function dispatchState(ctx, def) {
  const referenced = new Set(def.interfaces ?? []);
  return {
    task: {
      title: def.title,
      summary: def.summary ?? "",
      acceptance: def.acceptance ?? [],
      files: def.files,
      owner: def.owner,
      layer: layerOf(ctx, def.owner),
    },
    interfaces: (ctx.contract.interfaces ?? []).filter((i) => referenced.has(i.name)).map((i) => i.definition),
    hasTests: (def.tests ?? []).length > 0,
    fileCount: def.files.length,
  };
}

async function chooseModel(ctx, def) {
  const task = ctx.run.tasks[def.id];
  if (task.tier) return { model: task.tier, reason: `escalation tier ${task.tier}` };
  const floor = specialistOf(ctx, def.owner)?.modelFloor ?? "haiku";
  const thresholds = ctx.config.routing.thresholds;
  const result = await decideWithJev({
    root: ctx.root,
    kind: "dispatch",
    runId: ctx.runId,
    task: def.id,
    state: dispatchState(ctx, def),
    questions: dispatchQuestions(),
    map: (answers) => mapDispatch(answers, thresholds, floor),
    fallback: (reason) => fallbackDispatch(reason, floor),
    timeoutMs: ctx.config.routing.timeoutMs,
  });
  return result.decision;
}

export async function next(root, runId) {
  const ctx = loadContext(root, runId, { contract: true });
  blockDependents(ctx);
  const tasks = ctx.run.tasks;
  const active = ctx.contract.tasks.filter((def) => ACTIVE.includes(tasks[def.id]?.status));
  const busyOwners = new Set(active.map((def) => def.owner));
  const slots = Math.max(0, ctx.config.limits.maxParallel - active.length);

  const candidates = [];
  for (const def of ctx.contract.tasks) {
    if (candidates.length >= slots) break;
    const task = tasks[def.id];
    if (!task || task.status !== "pending" || busyOwners.has(def.owner)) continue;
    if (!(def.dependsOn ?? []).every((id) => FINISHED.includes(tasks[id]?.status))) continue;
    candidates.push(def);
    busyOwners.add(def.owner);
  }

  const baseline = candidates.length > 0 ? git.snapshot(root) : null;
  const ready = [];
  for (const def of candidates) {
    const { model, reason } = await chooseModel(ctx, def);
    const task = tasks[def.id];
    task.status = "running";
    task.tier = model;
    task.attempts.push({ model, startedAt: new Date().toISOString() });
    task.baseline = baseline;
    ready.push({ task: def.id, title: def.title, agent: def.owner, model, reason, delegation: buildMessage(runId, def) });
  }
  ctx.save();

  return {
    ready,
    running: active.map((def) => def.id),
    remaining: Object.values(tasks).filter((t) => !FINISHED.includes(t.status)).length,
  };
}

export function recover(root, runId) {
  const ctx = loadContext(root, runId);
  const recovered = [];
  for (const [id, task] of Object.entries(ctx.run.tasks)) {
    if (!ACTIVE.includes(task.status)) continue;
    task.status = "pending";
    recovered.push(id);
  }
  ctx.save();
  return { recovered };
}

export function setPhase(root, runId, phase) {
  if (!PHASES.includes(phase)) throw new CliError(`unknown_phase: ${phase}`);
  const ctx = loadContext(root, runId);
  ctx.run.phase = phase;
  ctx.save();
  return { phase };
}

export function resetTask(root, runId, taskId) {
  const ctx = loadContext(root, runId);
  const task = runTask(ctx, taskId);
  task.status = "pending";
  task.failuresOnTier = 0;
  ctx.save();
  return { id: taskId, ...task };
}

export function blockTask(root, runId, taskId, reason) {
  const ctx = loadContext(root, runId);
  const task = runTask(ctx, taskId);
  task.status = "blocked";
  task.notes.push(`blocked: ${reason}`);
  ctx.save();
  return { id: taskId, ...task };
}

export function taskFiles(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  return { files: runTask(ctx, taskId).changedFiles };
}

// Docs/03 section 6.3: attribute each changed path to this task, another running task, or a violation.
export function ownershipCheck(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const task = runTask(ctx, taskId);
  const owner = taskDefinition(ctx, taskId).owner;
  const rules = loadRules(root, runId);
  const otherOwners = ctx.contract.tasks.filter((def) => def.id !== taskId && ACTIVE.includes(ctx.run.tasks[def.id]?.status)).map((def) => def.owner);

  const files = [];
  const violations = [];
  for (const file of git.diffSince(root, task.baseline).filter((f) => !f.startsWith(IGNORED_PREFIX))) {
    const resolved = resolveOwner(rules, file);
    if (ownerAllows(resolved?.owner, owner)) files.push(file);
    else if (otherOwners.some((other) => ownerAllows(resolved?.owner, other))) continue;
    else violations.push({ path: file, owner: resolved ? (Array.isArray(resolved.owner) ? resolved.owner.join(", ") : resolved.owner) : "unowned" });
  }
  return { ok: violations.length === 0, files, violations };
}

export function revertViolations(root, runId, taskId) {
  const { violations } = ownershipCheck(root, runId, taskId);
  const ctx = loadContext(root, runId);
  const baseline = runTask(ctx, taskId).baseline;
  const restored = [];
  const failed = [];
  for (const { path: file } of violations) {
    const result = git.restore(root, file, baseline);
    if (result.restored) restored.push(file);
    else failed.push({ path: file, reason: result.reason });
  }
  return { restored, failed };
}

export function checkpoint(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const def = taskDefinition(ctx, taskId);
  const task = runTask(ctx, taskId);
  const finish = (result) => {
    // A design review that never rendered the page is a finding in itself (docs/03 section 6.5).
    const unreviewed = task.reviews?.design === "unrendered";
    if (task.status !== "done_with_findings") task.status = unreviewed ? "done_with_findings" : "done";
    ctx.save();
    return result;
  };
  if (!git.isGitRepo(root)) return finish({ skipped: "not_a_git_repo" });

  task.changedFiles = attributedFiles(ctx, taskId);
  if (task.changedFiles.length === 0) return finish({ skipped: "nothing_changed" });

  const committed = git.commit(root, task.changedFiles, `tenonry(${taskId}): ${def.title}`);
  if (committed.error) {
    task.notes.push(`skipped checkpoint: commit failed: ${committed.error}`.slice(0, 500));
    return finish({ skipped: "commit_failed", error: committed.error });
  }
  task.commit = committed.sha;
  return finish({ sha: committed.sha });
}

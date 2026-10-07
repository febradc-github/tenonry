import fs from "node:fs";
import path from "node:path";
import { loadRules, resolveOwner, ownerAllows, isBuilderAgent } from "./ownership.mjs";
import { loadConfig } from "./config.mjs";
import { loadCatalog } from "./catalog.mjs";
import { contractPath, specialistOf, isUiLayer } from "./ctx.mjs";
import { loadRun, saveRun, newTask } from "./state.mjs";

const MAX_FILES_WARNING = 12;

function isSafeRelativePath(file) {
  return typeof file === "string" && file !== "" && !path.posix.isAbsolute(file) && !/^[A-Za-z]:/.test(file) && !file.split("/").includes("..") && path.posix.normalize(file) === file;
}

function describeOwner(resolved) {
  if (!resolved) return "unowned";
  return Array.isArray(resolved.owner) ? resolved.owner.join(", ") : String(resolved.owner);
}

function findCycle(tasks) {
  const edges = new Map(tasks.map((t) => [t.id, (t.dependsOn ?? []).filter((d) => tasks.some((x) => x.id === d))]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "active") return [...trail.slice(trail.indexOf(id)), id];
    state.set(id, "active");
    for (const next of edges.get(id)) {
      const cycle = visit(next, [...trail, id]);
      if (cycle) return cycle;
    }
    state.set(id, "done");
    return null;
  };
  for (const id of edges.keys()) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return null;
}

function checkTaskShape(task, index, errors) {
  const label = task && typeof task.id === "string" ? task.id : `tasks[${index}]`;
  if (typeof task !== "object" || task === null) {
    errors.push(`${label}: task must be an object`);
    return false;
  }
  if (typeof task.id !== "string" || !/^T[0-9]+$/.test(task.id)) errors.push(`${label}: id must match ^T[0-9]+$`);
  if (!Array.isArray(task.files)) errors.push(`${label}: files must be an array`);
  return true;
}

// Implements docs/03 section 4.5. Pure with respect to run.json; see syncRunTasks for the bookkeeping.
export function validateContract(root, runId, contract, { config = loadConfig(root), catalog = loadCatalog() } = {}) {
  const errors = [];
  const warnings = [];
  if (typeof contract !== "object" || contract === null) return { valid: false, errors: ["contract is not a JSON object"], warnings };
  if (contract.version !== 1) errors.push("version must be 1");
  if (contract.runId !== runId) errors.push(`runId must be ${runId}`);

  const tasks = Array.isArray(contract.tasks) ? contract.tasks : [];
  if (tasks.length === 0) errors.push("the contract has no tasks");

  const rules = loadRules(root, runId);
  const ids = new Set();
  const fileOwners = new Map();
  const interfaceNames = new Set((contract.interfaces ?? []).map((i) => i?.name));
  const agents = new Set(config.agents);

  tasks.forEach((task, index) => {
    if (!checkTaskShape(task, index, errors)) return;
    const label = task.id;
    if (ids.has(task.id)) errors.push(`${label}: duplicate task id`);
    ids.add(task.id);

    if (!agents.has(task.owner) || !isBuilderAgent(String(task.owner))) {
      errors.push(`${label}: owner ${task.owner} is not an active builder specialist`);
    }
    const files = Array.isArray(task.files) ? task.files : [];
    if (files.length === 0) errors.push(`${label}: files must not be empty`);
    for (const file of files) {
      if (!isSafeRelativePath(file)) {
        errors.push(`${label}: ${JSON.stringify(file)} is not a normalized relative path inside the project`);
        continue;
      }
      const resolved = resolveOwner(rules, file);
      if (!resolved || !ownerAllows(resolved.owner, task.owner)) {
        errors.push(`${label}: ${file} is owned by ${describeOwner(resolved)}, not ${task.owner}`);
      }
      if (fileOwners.has(file) && fileOwners.get(file) !== task.id) errors.push(`${file} is listed in both ${fileOwners.get(file)} and ${task.id}`);
      fileOwners.set(file, task.id);
    }
    for (const test of task.tests ?? []) {
      if (!isSafeRelativePath(test)) {
        errors.push(`${label}: test path ${JSON.stringify(test)} is not a normalized relative path inside the project`);
        continue;
      }
      if (resolveOwner(rules, test)?.owner !== "tenonry-test-author") errors.push(`${label}: test ${test} is not owned by tenonry-test-author`);
      if (!fs.existsSync(path.join(root, test))) errors.push(`${label}: test ${test} does not exist on disk`);
    }
    for (const name of task.interfaces ?? []) {
      if (!interfaceNames.has(name)) errors.push(`${label}: unknown interface ${name}`);
    }
    if (task.ui === true && !isUiLayer(specialistOf({ catalog }, String(task.owner))?.layer)) {
      errors.push(`${label}: ui is true but ${task.owner} is not a frontend or 3d specialist`);
    }
    if ((task.tests ?? []).length === 0) warnings.push(`${label}: no tests`);
    if (files.length > MAX_FILES_WARNING) warnings.push(`${label}: ${files.length} files is large; consider splitting`);
    if (task.newScreen === true && task.ui !== true) warnings.push(`${label}: newScreen is true but ui is false`);
  });

  for (const task of tasks) {
    for (const dependency of task?.dependsOn ?? []) {
      if (!ids.has(dependency)) errors.push(`${task.id}: dependsOn unknown task ${dependency}`);
    }
  }
  const cycle = findCycle(tasks.filter((t) => t && typeof t.id === "string"));
  if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);

  for (const entry of contract.interfaces ?? []) {
    for (const agent of [entry?.provider, ...(entry?.consumers ?? [])].filter((a) => a !== undefined)) {
      if (!agents.has(agent)) errors.push(`interface ${entry?.name}: ${agent} is not an active agent`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

// Adds contract tasks missing from run.json as pending; existing task state is kept.
export function syncRunTasks(run, contract) {
  let added = 0;
  for (const task of contract.tasks) {
    if (run.tasks[task.id]) continue;
    run.tasks[task.id] = newTask({ owner: task.owner });
    added += 1;
  }
  return added;
}

export function checkContract(root, runId) {
  const run = loadRun(root, runId);
  if (!run) return { valid: false, errors: [`run not found: ${runId}`], warnings: [], contractFixes: 0 };
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath(root, runId), "utf8"));
  } catch {
    contract = undefined;
  }
  const result =
    contract === undefined
      ? { valid: false, errors: ["contract.json is missing or is not valid JSON"], warnings: [] }
      : validateContract(root, runId, contract);
  if (result.valid) {
    syncRunTasks(run, contract);
  } else {
    run.contractFixes += 1;
  }
  saveRun(root, run);
  return { ...result, contractFixes: run.contractFixes, tasks: Object.keys(run.tasks).length };
}

import path from "node:path";
import { readJson, writeJsonAtomic } from "./json.mjs";
import { loadConfig } from "./config.mjs";
import { loadCatalog } from "./catalog.mjs";
import { loadRun, saveRun } from "./state.mjs";
import { runDir } from "./paths.mjs";

export class CliError extends Error {}

export const contractPath = (root, runId) => path.join(runDir(root, runId), "contract.json");
export const reportPath = (root, runId, taskId) => path.join(runDir(root, runId), "reports", `${taskId}.json`);
export const reviewPath = (root, runId, taskId, kind) => path.join(runDir(root, runId), "reviews", `${taskId}.${kind}.json`);
export const relRunPath = (runId, ...parts) => [".tenonry", "runs", runId, ...parts].join("/");

export const readContract = (root, runId) => readJson(contractPath(root, runId), null);
export const writeContract = (root, runId, contract) => writeJsonAtomic(contractPath(root, runId), contract);

export const FINISHED = ["done", "done_with_findings"];
export const ACTIVE = ["running", "verifying", "reviewing"];

// Loads everything a task command needs. `run` is mutable; call ctx.save() to persist it.
export function loadContext(root, runId, { contract = false } = {}) {
  if (!runId) throw new CliError("missing_run_id");
  const run = loadRun(root, runId);
  if (!run) throw new CliError(`run_not_found: ${runId}`);
  const config = loadConfig(root);
  const catalog = loadCatalog();
  const ctx = {
    root,
    runId,
    run,
    config,
    catalog,
    contract: contract ? readContract(root, runId) : null,
    save: () => saveRun(root, run),
  };
  if (contract && !ctx.contract) throw new CliError("contract_not_found");
  return ctx;
}

export function taskDefinition(ctx, taskId) {
  const task = ctx.contract?.tasks?.find((t) => t.id === taskId);
  if (!task) throw new CliError(`unknown_task: ${taskId}`);
  return task;
}

export function runTask(ctx, taskId) {
  const task = ctx.run.tasks[taskId];
  if (!task) throw new CliError(`unknown_task: ${taskId}`);
  return task;
}

export const specialistId = (agentName) => agentName.replace(/^tenonry-/, "");
export const specialistOf = (ctx, agentName) => ctx.catalog.find((spec) => spec.id === specialistId(agentName)) ?? null;
export const layerOf = (ctx, agentName) => specialistOf(ctx, agentName)?.layer ?? null;
export const isUiLayer = (layer) => layer === "frontend" || layer === "3d";
export const taskCountBy = (run, statuses) => Object.values(run.tasks).filter((t) => statuses.includes(t.status)).length;

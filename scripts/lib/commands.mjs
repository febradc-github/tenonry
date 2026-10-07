import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./json.mjs";
import { catalogPath, checkCatalog } from "./catalog.mjs";
import { CliError } from "./ctx.mjs";
import { newRun, patchState, setNotice } from "./state.mjs";
import { runIntake, readRoute } from "./routing.mjs";
import { checkContract } from "./contract.mjs";
import * as tasks from "./tasks.mjs";
import { verify, finalGate } from "./verify.mjs";
import { reviewPlan, reviewStatus } from "./review.mjs";
import { ownerCommand, handoff } from "./owner.mjs";
import { report, status, calibrate } from "./report.mjs";
import { undo } from "./undo.mjs";
import { previewStart, previewStop, previewCredentials } from "./preview.mjs";
import { loadRun } from "./state.mjs";
import { runDir } from "./paths.mjs";
import { directPlan, designCheck, quickContract, requestBrief } from "./direct.mjs";

function need(value, name) {
  if (value === undefined || value === "") throw new CliError(`missing_argument: ${name}`);
  return value;
}

function catalogCheck({ flags }) {
  const file = flags.file || catalogPath();
  if (!file) return { ok: false, error: "catalog_not_found" };
  return { ...checkCatalog(readJson(file)), file };
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function promptFrom(flags) {
  if (flags["prompt-stdin"]) {
    const prompt = readStdin().replace(/\r?\n$/, "");
    if (prompt.trim() === "") throw new CliError("empty_prompt");
    return prompt;
  }
  if (flags["prompt-file"]) return fs.readFileSync(flags["prompt-file"], "utf8").replace(/\s+$/, "");
  return need(flags.prompt, "--prompt, --prompt-stdin, or --prompt-file");
}

const relPath = (root, file) => path.relative(root, file).split(path.sep).join("/");

function newRunCommand({ root, flags }) {
  const prompt = promptFrom(flags);
  const { runId, runDir: dir } = newRun(root, prompt);
  writeJsonAtomic(path.join(dir, "route.json"), {
    runId,
    createdAt: new Date().toISOString(),
    prompt,
    jev: "fallback",
    fallbackReason: "no_hook",
    answers: {},
    clarify: "auto",
    plan: "yes",
    lane: "build",
    contractModel: "opus",
    design: "yes",
    difficulty: null,
    difficultyConfidence: null,
    taskType: null,
    ui: null,
    mainModel: { current: "unknown", notice: false },
  });
  return { runId, runDir: relPath(root, dir) };
}

// The run's request as brief.md, or the clarified brief from standard input (docs/03 section 6).
function writeBrief({ root, args, flags }) {
  const runId = need(args[0], "run");
  const run = loadRun(root, runId);
  if (!run) throw new CliError(`run_not_found: ${runId}`);
  let content;
  if (flags.stdin) {
    const text = readStdin();
    if (text.trim() === "") throw new CliError("empty_brief");
    content = text.replace(/(\r?\n)+$/, "") + "\n";
  } else {
    content = requestBrief(root, runId, run);
  }
  const file = path.join(runDir(root, runId), "brief.md");
  fs.writeFileSync(file, content);
  return { path: relPath(root, file) };
}

async function intakeCommand({ root, args }) {
  const runId = need(args[0], "run");
  const run = loadRun(root, runId);
  if (!run) throw new CliError(`run_not_found: ${runId}`);
  const family = readRoute(root, runId)?.mainModel?.current ?? "unknown";
  return runIntake(root, runId, run.prompt, family);
}

const ownerPath = ({ args, flags, root }) => ownerCommand(root, need(flags.run, "--run"), need(args[0], "path"), flags.purpose ?? "");

// Each command receives { args, flags, root, cwd } and returns the one JSON object to print.
export const COMMANDS = {
  "catalog-check": { run: catalogCheck, needsProject: false },
  "new-run": { run: newRunCommand },
  "write-brief": { run: writeBrief },
  "direct-plan": { run: ({ root, args }) => directPlan(root, need(args[0], "run")) },
  "design-check": { run: ({ root, args }) => designCheck(root, need(args[0], "run")) },
  "quick-contract": { run: ({ root, args }) => quickContract(root, need(args[0], "run")) },
  intake: { run: intakeCommand },
  status: { run: ({ root, args }) => status(root, args[0]) },
  undo: { run: ({ root, args }) => undo(root, args[0]) },
  "notice-shown": { run: ({ root, args }) => ({ notices: setNotice(root, need(args[0], "name")).notices }) },
  "restart-pending": {
    run: ({ root, args }) => ({ restartPending: patchState(root, { restartPending: need(args[0], "true|false") === "true" }).restartPending }),
  },
  recover: { run: ({ root, args }) => tasks.recover(root, need(args[0], "run")) },
  phase: { run: ({ root, args }) => tasks.setPhase(root, need(args[0], "run"), need(args[1], "phase")) },
  "contract-check": { run: ({ root, args }) => checkContract(root, need(args[0], "run")) },
  next: { run: ({ root, args }) => tasks.next(root, need(args[0], "run")) },
  verify: { run: ({ root, args }) => verify(root, need(args[0], "run"), need(args[1], "task")) },
  "ownership-check": { run: ({ root, args }) => tasks.ownershipCheck(root, need(args[0], "run"), need(args[1], "task")) },
  "revert-violations": { run: ({ root, args }) => tasks.revertViolations(root, need(args[0], "run"), need(args[1], "task")) },
  "review-plan": { run: ({ root, args }) => reviewPlan(root, need(args[0], "run"), need(args[1], "task")) },
  "review-status": { run: ({ root, args }) => reviewStatus(root, need(args[0], "run"), need(args[1], "task")) },
  checkpoint: { run: ({ root, args }) => tasks.checkpoint(root, need(args[0], "run"), need(args[1], "task")) },
  owner: { run: ownerPath },
  handoff: { run: ({ root, args }) => handoff(root, need(args[0], "run"), need(args[1], "task")) },
  "task-files": { run: ({ root, args }) => tasks.taskFiles(root, need(args[0], "run"), need(args[1], "task")) },
  "reset-task": { run: ({ root, args }) => tasks.resetTask(root, need(args[0], "run"), need(args[1], "task")) },
  "block-task": {
    run: ({ root, args, flags }) => tasks.blockTask(root, need(args[0], "run"), need(args[1], "task"), need(flags.reason, "--reason")),
  },
  "final-gate": { run: ({ root, args }) => finalGate(root, need(args[0], "run")) },
  report: { run: ({ root, args }) => report(root, need(args[0], "run")) },
  calibrate: { run: ({ root }) => calibrate(root) },
  "preview-start": { run: ({ root }) => previewStart(root) },
  "preview-stop": { run: ({ root }) => previewStop(root) },
  "preview-credentials": { run: ({ root }) => previewCredentials(root) },
};


import path from "node:path";
import { loadContext, taskDefinition, runTask, FINISHED } from "./ctx.mjs";
import { runFiltered } from "../exec-filter.mjs";
import { expandTestFiles } from "./stack.mjs";
import { attributedFiles } from "./tasks.mjs";
import { nextTier } from "./routing.mjs";
import { fixMessage } from "./delegation.mjs";
import { appendJsonl } from "./json.mjs";
import { logPath } from "./jev.mjs";

const ECOSYSTEMS_BY_EXTENSION = {
  js: ["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro", "css", "scss", "sass", "html"],
  php: ["php"],
  python: ["py"],
  go: ["go"],
  rust: ["rs"],
  ruby: ["rb", "erb"],
  elixir: ["ex", "exs", "heex"],
  dotnet: ["cs", "csproj"],
  maven: ["java", "kt"],
  gradle: ["java", "kt"],
  flutter: ["dart"],
  dart: ["dart"],
};

function ecosystemsFor(file) {
  const extension = path.posix.extname(file).slice(1).toLowerCase();
  return Object.entries(ECOSYSTEMS_BY_EXTENSION).filter(([, extensions]) => extensions.includes(extension)).map(([name]) => name);
}

export const packageDir = (root, pkgRoot) => (pkgRoot === "." ? root : path.join(root, pkgRoot));

// Docs/03 section 6.2 step 2 plus decision D-048: longest matching root, then the matching ecosystem.
export function selectVerifyEntry(config, def, changedFiles = []) {
  // A quick task lists no files, so the files it actually changed stand in.
  const files = def.files.length > 0 ? def.files : changedFiles;
  const first = files[0] ?? "";
  const roots = [...new Set(config.verify.map((entry) => entry.root))].filter((r) => r === "." || first === r || first.startsWith(`${r}/`));
  roots.sort((a, b) => b.length - a.length);
  const entries = config.verify.filter((entry) => entry.root === roots[0]);
  if (entries.length === 0) return null;
  for (const file of [...(def.tests ?? []), ...files]) {
    const match = entries.find((entry) => ecosystemsFor(file).includes(entry.ecosystem));
    if (match) return match;
  }
  return entries[0];
}

function stepRecord(name, command, result) {
  return { name, command, exitCode: result.exitCode, summary: result.summary, log: result.log };
}

function mentionsAny(output, files, pkgRoot) {
  const candidates = new Set();
  for (const file of files) {
    candidates.add(file);
    if (pkgRoot !== "." && file.startsWith(`${pkgRoot}/`)) candidates.add(file.slice(pkgRoot.length + 1));
  }
  return [...candidates].some((candidate) => output.includes(candidate));
}

function limitLines(text, maxLines) {
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : lines.slice(0, maxLines).join("\n");
}

function runVerifySteps(ctx, def, entry, files) {
  const { root, config } = ctx;
  const steps = [];
  const failures = [];
  const cwd = packageDir(root, entry.root);
  const maxLines = config.outputFilter.maxLines;
  const tests = def.tests ?? [];

  if (tests.length === 0) steps.push({ name: "test", skipped: true, reason: "no_tests" });
  else if (!entry.testFiles) steps.push({ name: "test", skipped: true, reason: "no_test_template" });
  else {
    const command = expandTestFiles(entry.testFiles, tests, entry.root);
    const result = runFiltered({ command, cwd, label: `${def.id}-test`, root, maxLines });
    steps.push(stepRecord("test", command, result));
    if (result.exitCode !== 0) failures.push(`[test] ${command}\n${result.text}`);
  }

  for (const name of ["typecheck", "lint"]) {
    if (!entry[name]) continue;
    const result = runFiltered({ command: entry[name], cwd, label: `${def.id}-${name}`, root, maxLines });
    const record = stepRecord(name, entry[name], result);
    // Typecheck and lint run project-wide, so failures about other tasks' unbuilt code do not count (D-023).
    const scopedOut = result.exitCode !== 0 && !mentionsAny(result.fullOutput, [...files, ...tests], entry.root);
    if (scopedOut) record.scoped = true;
    steps.push(record);
    if (result.exitCode !== 0 && !scopedOut) failures.push(`[${name}] ${entry[name]}\n${result.text}`);
  }
  return { steps, failures };
}

export function verify(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const def = taskDefinition(ctx, taskId);
  const task = runTask(ctx, taskId);
  task.status = "verifying";
  task.changedFiles = attributedFiles(ctx, taskId);

  const entry = selectVerifyEntry(ctx.config, def, task.changedFiles);
  let steps = [];
  let failures = [];
  if (entry) {
    ({ steps, failures } = runVerifySteps(ctx, def, entry, task.changedFiles));
  } else {
    steps.push({ name: "test", skipped: true, reason: "no_verify_config" });
  }
  for (const step of steps.filter((s) => s.skipped)) task.notes.push(`skipped ${step.name}: ${step.reason}`);

  const result = failures.length === 0 ? "pass" : "fail";
  const lastAttempt = task.attempts.at(-1);
  if (lastAttempt) lastAttempt.result = result;
  appendJsonl(logPath(root), { ts: new Date().toISOString(), runId, task: taskId, kind: "outcome", model: task.tier, attempt: task.attempts.length, result });

  const output = { result, action: "review", steps, feedback: "", delegation: null, files: task.changedFiles };
  if (result === "fail") {
    task.failuresOnTier += 1;
    output.feedback = limitLines(failures.join("\n\n"), ctx.config.outputFilter.maxLines);
    if (task.failuresOnTier >= ctx.config.limits.maxTestRetriesPerTier) {
      if (task.tier === "opus") {
        task.status = "blocked";
        task.notes.push(`blocked: checks still failing on opus after ${task.attempts.length} attempts`);
        output.action = "blocked";
      } else {
        task.tier = nextTier(task.tier);
        task.failuresOnTier = 0;
        task.status = "pending";
        output.action = "respawn";
      }
    } else {
      task.status = "running";
      output.action = "resume";
      output.delegation = fixMessage(runId, def, output.feedback);
    }
  }
  ctx.save();
  return output;
}

function taskTestsStillPass(ctx, def) {
  const entry = selectVerifyEntry(ctx.config, def);
  if (!entry?.testFiles || (def.tests ?? []).length === 0) return true;
  const command = expandTestFiles(entry.testFiles, def.tests, entry.root);
  const result = runFiltered({ command, cwd: packageDir(ctx.root, entry.root), label: `${def.id}-final`, root: ctx.root, maxLines: ctx.config.outputFilter.maxLines });
  return result.exitCode === 0;
}

// Docs/03 section 6.7: strict, project-wide checks; one reopen of tasks whose own tests now fail.
export function finalGate(root, runId) {
  const ctx = loadContext(root, runId, { contract: true });
  const steps = [];
  for (const entry of ctx.config.verify) {
    for (const name of ["test", "typecheck", "lint"]) {
      if (!entry[name]) continue;
      const result = runFiltered({ command: entry[name], cwd: packageDir(root, entry.root), label: `final-${name}`, root, maxLines: ctx.config.outputFilter.maxLines });
      steps.push({ root: entry.root, ...stepRecord(name, entry[name], result) });
    }
  }
  const failed = steps.filter((step) => step.exitCode !== 0);
  if (failed.length === 0) {
    ctx.run.finalGate = { result: "pass", steps };
    ctx.save();
    return { result: "pass", steps, reopened: [] };
  }

  const reopened = [];
  if (!ctx.run.finalGateReopened && ctx.config.verify.some((entry) => entry.testFiles)) {
    for (const def of ctx.contract.tasks) {
      const task = ctx.run.tasks[def.id];
      if (!task || !FINISHED.includes(task.status) || (def.tests ?? []).length === 0) continue;
      if (taskTestsStillPass(ctx, def)) continue;
      task.status = "pending";
      task.failuresOnTier = 0;
      task.reviewRounds = { design: 0, code: 0 };
      task.notes.push("reopened: final gate tests failed");
      reopened.push(def.id);
    }
    ctx.run.finalGateReopened = true;
  }
  ctx.run.finalGate = { result: "fail", steps, reopened };
  ctx.save();
  return { result: "fail", steps, reopened };
}

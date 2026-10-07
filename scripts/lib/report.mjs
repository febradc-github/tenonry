import fs from "node:fs";
import path from "node:path";
import { loadContext, FINISHED, ACTIVE, readContract } from "./ctx.mjs";
import { readState, loadRun, saveRun } from "./state.mjs";
import { readDecisionLog } from "./jev.mjs";
import { loadConfig } from "./config.mjs";
import { runDir } from "./paths.mjs";

const PHASE_WORDS = {
  intake: "Clarifying the request",
  planning: "Planning",
  design: "Designing",
  contract: "Writing the contract and tests",
  building: "Building",
  "final-gate": "Running the final checks",
  done: "Finished",
  stopped: "Stopped",
};
const STATUS_WORDS = {
  done: "done",
  done_with_findings: "done, with notes",
  running: "in progress",
  verifying: "in progress",
  reviewing: "in progress",
  pending: "waiting",
  blocked: "blocked",
};
const REQUEST_PREVIEW_CHARACTERS = 100;
const BUCKETS = [
  { label: "[0, 0.5)", min: 0, max: 0.5 },
  { label: "[0.5, 1.5)", min: 0.5, max: 1.5 },
  { label: "[1.5, 2.5)", min: 1.5, max: 2.5 },
  { label: "[2.5, 3]", min: 2.5, max: Infinity },
];
const MIN_DECISIONS = 20;
const MIN_GROUP_SAMPLE = 5;

const pad = (text, width) => String(text).padEnd(width);

function titles(root, run) {
  const contract = readContract(root, run.id);
  return new Map((contract?.tasks ?? []).map((t) => [t.id, t.title]));
}

function nextLine(run) {
  if (run.phase === "done") return "Finished. Undo with /tenonry:run undo.";
  if (run.phase === "stopped") return "Start a new request with /tenonry:run <what you want>.";
  const working = Object.entries(run.tasks).filter(([, t]) => ACTIVE.includes(t.status)).map(([id]) => id);
  return working.length > 0 ? `Working on ${working.join(", ")}.` : "Type /tenonry:run to continue.";
}

// Docs/03 section 6.11.
export function statusDisplay(root, run) {
  const names = titles(root, run);
  const tasks = Object.entries(run.tasks);
  const count = (statuses) => tasks.filter(([, t]) => statuses.includes(t.status)).length;
  const lines = [
    `Tenonry run ${run.id}: ${PHASE_WORDS[run.phase] ?? run.phase}`,
    `Request: ${String(run.prompt ?? "").replace(/\s+/g, " ").slice(0, REQUEST_PREVIEW_CHARACTERS)}`,
    `Tasks: ${count(FINISHED)} done, ${count(ACTIVE)} in progress, ${count(["pending"])} waiting, ${count(["blocked"])} blocked`,
  ];
  const rows = tasks.map(([id, t]) => ({ id, status: STATUS_WORDS[t.status] ?? t.status, owner: t.owner ?? "-", tier: t.tier ?? "-", title: names.get(id) ?? "" }));
  const width = (key, min, gap) => Math.max(min, ...rows.map((r) => r[key].length)) + gap;
  const [idW, statusW, ownerW, tierW] = [width("id", 2, 2), width("status", 12, 2), width("owner", 0, 3), width("tier", 6, 2)];
  for (const row of rows) lines.push(`  ${pad(row.id, idW)}${pad(row.status, statusW)}${pad(row.owner, ownerW)}${pad(row.tier, tierW)}${row.title}`.trimEnd());
  lines.push(`Next: ${nextLine(run)}`);
  return lines.join("\n");
}

export function status(root, runId) {
  const id = runId || readState(root).activeRun;
  const run = id ? loadRun(root, id) : null;
  if (!run) return { ok: true, run: null, display: "No Tenonry runs yet. Start one with /tenonry:run <what you want>." };
  return { ok: true, run, display: statusDisplay(root, run) };
}

function jevUsage(root, runId) {
  const lines = readDecisionLog(root).filter((line) => line.runId === runId && line.kind !== "outcome");
  const cost = lines.reduce((sum, line) => sum + (Number(line.cost) || 0), 0);
  return { decisions: lines.length, fallbacks: lines.filter((l) => !l.ok).length, cost: Math.round(cost * 1e6) / 1e6 };
}

function blockReason(task) {
  const note = task.notes.filter((n) => n.startsWith("blocked") || n.startsWith("dependency")).at(-1);
  return note ? note.replace(/^blocked: /, "") : "blocked";
}

function reviewSummary(task) {
  const parts = [];
  if (task.reviews?.code) parts.push(`code ${task.reviews.code}`);
  if (task.reviews?.design) parts.push(`design ${task.reviews.design}`);
  return parts.join(", ") || "-";
}

function tryIt(config) {
  if (config.preview?.command) return `${config.preview.command}${config.preview.url ? ` (${config.preview.url})` : ""}`;
  const first = config.verify.find((entry) => entry.test);
  return first ? first.test : null;
}

// Docs/03 section 6.8.
export function report(root, runId) {
  const ctx = loadContext(root, runId);
  const { run, config } = ctx;
  const names = titles(root, run);
  const tasks = Object.entries(run.tasks);
  const counts = {};
  for (const [, task] of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  const usage = jevUsage(root, runId);

  const unresolved = tasks.filter(([, t]) => t.status === "done_with_findings" && t.unresolved?.length);
  const blocked = tasks.filter(([, t]) => t.status === "blocked");
  const skipped = tasks.flatMap(([id, t]) => t.notes.filter((n) => n.startsWith("skipped")).map((n) => `${id}: ${n}`));
  const gate = run.finalGate?.result ?? "not run";

  const md = [];
  md.push(`# Tenonry report: ${readContract(root, runId)?.title ?? String(run.prompt).slice(0, 60)}`, "", `Run: ${runId}`, "");
  md.push("## Request", "", run.prompt, "");
  md.push("## Outcome", "", ...(tasks.length ? Object.entries(counts).map(([status, n]) => `- ${status}: ${n}`) : ["- no tasks were created"]), "");
  md.push("## Tasks", "");
  if (tasks.length) {
    md.push("| Task | Owner | Final model | Attempts | Reviews | Commit |", "|---|---|---|---|---|---|");
    for (const [id, t] of tasks) {
      md.push(`| ${id} ${names.get(id) ?? ""} | ${t.owner ?? "-"} | ${t.tier ?? "-"} | ${t.attempts.length} | ${reviewSummary(t)} | ${t.commit ? t.commit.slice(0, 7) : "-"} |`);
    }
  } else {
    md.push("No tasks.");
  }
  md.push("", "## Unresolved review findings", "");
  md.push(...(unresolved.length ? unresolved.flatMap(([id, t]) => [`### ${id}`, ...t.unresolved]) : ["None."]), "");
  md.push("## Blocked tasks", "");
  md.push(...(blocked.length ? blocked.map(([id, t]) => `- ${id}: ${blockReason(t)}`) : ["None."]), "");
  md.push("## Final gate", "", `Result: ${gate}`, "");
  md.push("## Jev usage", "", `- Decisions: ${usage.decisions}`, `- Fallbacks: ${usage.fallbacks}`, `- Total cost: $${usage.cost}`, "");
  md.push("## Skipped steps", "", ...(skipped.length ? skipped.map((s) => `- ${s}`) : ["None."]), "");
  md.push("## Logs", "", "- Jev decisions: .tenonry/logs/jev-decisions.jsonl", "- Command output: .tenonry/logs/exec/", "");

  const file = path.join(runDir(root, runId), "report.md");
  fs.writeFileSync(file, md.join("\n"));
  if (run.phase !== "stopped") run.phase = "done";
  saveRun(root, run);

  const attention = [
    ...blocked.map(([id, t]) => `${id} blocked: ${blockReason(t)}`),
    ...unresolved.map(([id, t]) => `${id} has ${t.unresolved.length} unresolved review notes`),
    ...(run.finalGate?.result === "fail" ? ["the final checks failed"] : []),
  ];
  return {
    path: path.relative(root, file).split(path.sep).join("/"),
    summary: {
      done: tasks.filter(([, t]) => FINISHED.includes(t.status)).length,
      total: tasks.length,
      tasks: tasks.map(([id, t]) => ({ id, title: names.get(id) ?? "", status: t.status })),
      attention,
      tryIt: tryIt(config),
      jevCost: usage.cost,
    },
  };
}

const rate = (passes, total) => (total === 0 ? null : Math.round((passes / total) * 100) / 100);

// Docs/03 section 6.9. Suggestions only; the config is never edited.
export function calibrate(root) {
  const log = readDecisionLog(root);
  const dispatch = log.filter((line) => line.kind === "dispatch");
  if (dispatch.length < MIN_DECISIONS) return { enoughData: false, decisions: dispatch.length, needed: MIN_DECISIONS };

  const firstOutcome = new Map();
  for (const line of log.filter((l) => l.kind === "outcome" && l.attempt === 1)) firstOutcome.set(`${line.runId}/${line.task}`, line.result);
  const joined = dispatch
    .filter((line) => line.ok && line.decision?.model && line.answers?.difficulty)
    .map((line) => ({ model: line.decision.model, difficulty: line.answers.difficulty.score, result: firstOutcome.get(`${line.runId}/${line.task}`) }))
    .filter((row) => row.result);

  const group = (rows) => ({ count: rows.length, passRate: rate(rows.filter((r) => r.result === "pass").length, rows.length) });
  const byModel = Object.fromEntries(["haiku", "sonnet", "opus"].map((model) => [model, group(joined.filter((r) => r.model === model))]));
  const buckets = [];
  for (const model of ["haiku", "sonnet", "opus"]) {
    for (const bucket of BUCKETS) {
      const rows = joined.filter((r) => r.model === model && r.difficulty >= bucket.min && r.difficulty < bucket.max);
      if (rows.length > 0) buckets.push({ model, bucket: bucket.label, ...group(rows) });
    }
  }

  const thresholds = loadConfig(root).routing.thresholds;
  const suggestions = [];
  if (byModel.haiku.count >= MIN_GROUP_SAMPLE && byModel.haiku.passRate < 0.7) {
    suggestions.push(`Haiku passed ${byModel.haiku.passRate} of first attempts: lower routing.thresholds.haiku.maxDifficulty from ${thresholds.haiku.maxDifficulty} to ${Math.round((thresholds.haiku.maxDifficulty - 0.2) * 100) / 100}.`);
  }
  const hardSonnet = group(joined.filter((r) => r.model === "sonnet" && r.difficulty >= 1.5));
  if (hardSonnet.count >= MIN_GROUP_SAMPLE && hardSonnet.passRate > 0.9) {
    suggestions.push(`Sonnet passed ${hardSonnet.passRate} of first attempts at difficulty 1.5 and above: raise routing.thresholds.opus.minDifficulty from ${thresholds.opus.minDifficulty} to ${Math.round((thresholds.opus.minDifficulty + 0.25) * 100) / 100}.`);
  }
  if (byModel.opus.count >= MIN_GROUP_SAMPLE && byModel.opus.passRate < 0.6) {
    suggestions.push(`Opus passed only ${byModel.opus.passRate} of first attempts: review contracts for over-scoped tasks.`);
  }
  return { enoughData: true, decisions: dispatch.length, joined: joined.length, byModel, buckets, suggestions };
}


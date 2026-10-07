import fs from "node:fs";
import { loadContext, taskDefinition, runTask, reviewPath, specialistId } from "./ctx.mjs";
import { decideWithJev } from "./jev.mjs";
import { riskQuestions, mapRisk, fallbackRisk } from "./routing.mjs";
import { reviewMessage, fixMessage } from "./delegation.mjs";
import { readJson } from "./json.mjs";
import * as git from "./git.mjs";

export const DESIGN_WEIGHTS = { ux: 0.15, visual: 0.15, content: 0.1, accessibility: 0.1, performance: 0.2, responsive: 0.1, innovation: 0.2 };
const SEVERITIES = ["blocking", "major", "minor"];
const DESIGN_PASS_SCORE = 7.5;
const DESIGN_MIN_CRITERION = 6;
const DESIGN_REVIEWER = "tenonry-design-reviewer";

export function weightedScore(scores) {
  const total = Object.entries(DESIGN_WEIGHTS).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0);
  return Math.round(total * 100) / 100;
}

const validFindings = (findings) => Array.isArray(findings) && findings.every((f) => typeof f === "object" && f !== null && SEVERITIES.includes(f.severity));

function codeSchemaOk(review) {
  return typeof review === "object" && review !== null && validFindings(review.findings);
}

function designSchemaOk(review) {
  if (typeof review !== "object" || review === null || !validFindings(review.findings)) return false;
  const scores = review.scores;
  return typeof scores === "object" && scores !== null && Object.keys(DESIGN_WEIGHTS).every((key) => typeof scores[key] === "number" && scores[key] >= 0 && scores[key] <= 10);
}

export async function reviewPlan(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const def = taskDefinition(ctx, taskId);
  const task = runTask(ctx, taskId);
  task.status = "reviewing";
  const files = task.changedFiles;

  const thresholds = ctx.config.routing.thresholds;
  const risk = await decideWithJev({
    root,
    kind: "risk",
    runId,
    task: taskId,
    state: {
      task: { title: def.title, summary: def.summary ?? "", acceptance: def.acceptance ?? [] },
      files,
      diffStat: git.diffStat(root, files),
      diffExcerpt: git.diffExcerpt(root, files),
    },
    questions: riskQuestions(),
    map: (answers) => mapRisk(answers, thresholds),
    fallback: () => fallbackRisk(),
    timeoutMs: ctx.config.routing.timeoutMs,
  });

  const preview = ctx.config.preview ?? null;
  const planned = [];
  const reviewers = [];
  const plan = (agent, kind, model) => {
    task.reviewRounds[kind] += 1;
    fs.rmSync(reviewPath(root, runId, taskId, kind), { force: true });
    planned.push(kind);
    reviewers.push({
      agent,
      kind,
      model,
      delegation: reviewMessage({ runId, task: def, kind, round: task.reviewRounds[kind], files, preview }),
    });
  };
  plan(`tenonry-review-${specialistId(def.owner)}`, "code", risk.decision.model);
  if (def.ui === true && ctx.config.agents.includes(DESIGN_REVIEWER)) plan(DESIGN_REVIEWER, "design", "opus");

  task.plannedReviews = planned;
  ctx.save();
  return { reviewers, risk: { model: risk.decision.model, risky: risk.decision.risky, blastRadius: risk.decision.blastRadius, fallback: !risk.ok } };
}

function formatFinding(finding, fallbackFile) {
  const where = finding.file ? (finding.line ? `${finding.file}:${finding.line}` : finding.file) : fallbackFile;
  return `- [${finding.severity}] ${where} ${finding.problem ?? ""} -> ${finding.fix ?? ""}`.trimEnd();
}

function evaluateCode(review) {
  if (!codeSchemaOk(review)) return { status: "error", reason: "missing or invalid review file", lines: [] };
  const blocking = review.findings.filter((f) => f.severity === "blocking" || f.severity === "major");
  return { status: blocking.length === 0 ? "pass" : "fail", findings: review.findings.length, lines: blocking.map((f) => formatFinding(f, "(code)")) };
}

function evaluateDesign(review) {
  if (!designSchemaOk(review)) return { status: "error", reason: "missing or invalid review file", lines: [] };
  const weighted = weightedScore(review.scores);
  const lowest = Math.min(...Object.keys(DESIGN_WEIGHTS).map((key) => review.scores[key]));
  const hasBlocking = review.findings.some((f) => f.severity === "blocking");
  const passes = weighted >= DESIGN_PASS_SCORE && lowest >= DESIGN_MIN_CRITERION && !hasBlocking;
  const status = !passes ? "fail" : review.rendered === false ? "pass_unrendered" : "pass";
  const lines = [];
  if (!passes) lines.push(`- [design] weighted score ${weighted} (needs ${DESIGN_PASS_SCORE}, every criterion at least ${DESIGN_MIN_CRITERION})`);
  if (!passes) lines.push(...review.findings.map((f) => formatFinding(f, f.criterion ? `(${f.criterion})` : "(design)")));
  return { status, weighted, rendered: review.rendered !== false, findings: review.findings.length, lines };
}

const passed = (status) => status === "pass" || status === "pass_unrendered";

export function reviewStatus(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const def = taskDefinition(ctx, taskId);
  const task = runTask(ctx, taskId);
  const planned = task.plannedReviews ?? [];
  const limits = { design: ctx.config.limits.maxDesignRounds, code: ctx.config.limits.maxCodeReviewRounds };
  const evaluate = { code: evaluateCode, design: evaluateDesign };

  const results = { design: null, code: null };
  for (const kind of planned) results[kind] = evaluate[kind](readJson(reviewPath(root, runId, taskId, kind), null));

  const failing = planned.filter((kind) => !passed(results[kind].status));
  const overall = failing.length === 0 ? "pass" : "fail";
  const feedbackLines = planned.flatMap((kind) => (results[kind].status === "error" ? [`- [blocking] (${kind} review) the review file was missing or invalid`] : results[kind].lines));
  task.reviews = { design: results.design?.status ?? null, code: results.code?.status ?? null };

  const output = { design: summarize(results.design), code: summarize(results.code), overall, action: "checkpoint", feedback: feedbackLines.join("\n"), delegation: null };
  if (overall === "fail") {
    const exhausted = failing.some((kind) => task.reviewRounds[kind] >= limits[kind]);
    if (exhausted) {
      task.status = "done_with_findings";
      task.unresolved = feedbackLines;
    } else {
      task.status = "running";
      output.action = "fix";
      output.delegation = fixMessage(runId, def, output.feedback);
    }
  }
  ctx.save();
  return output;
}

function summarize(result) {
  if (!result) return null;
  const { lines, ...rest } = result;
  return rest;
}

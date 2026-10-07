import fs from "node:fs";
import { loadContext, taskDefinition, runTask, reviewPath, specialistId } from "./ctx.mjs";
import { decideWithJev } from "./jev.mjs";
import { riskQuestions, mapRisk, fallbackRisk } from "./routing.mjs";
import { reviewMessage, fixMessage } from "./delegation.mjs";
import { readJson } from "./json.mjs";
import * as git from "./git.mjs";
import { loginAvailable } from "./preview.mjs";

// Showcase pages are judged as award entries; product screens as tools (library/rubrics/design.md).
export const DESIGN_PROFILES = {
  showcase: { ux: 0.15, visual: 0.15, content: 0.1, accessibility: 0.1, performance: 0.2, responsive: 0.1, innovation: 0.2 },
  product: { ux: 0.25, visual: 0.15, content: 0.05, accessibility: 0.15, performance: 0.15, responsive: 0.15, innovation: 0.1 },
};
const CRITERIA = Object.keys(DESIGN_PROFILES.showcase);
const SEVERITIES = ["blocking", "major", "minor"];
const DESIGN_PASS_SCORE = 7.5;
const DESIGN_MIN_CRITERION = 6;
const PRODUCT_MIN_INNOVATION = 5;
const DESIGN_REVIEWER = "tenonry-design-reviewer";
// The browser the pinned review server launches by default, and the server's own install command (D-061).
export const PLAYWRIGHT_MCP_VERSION = "0.0.83";
export const BROWSER_INSTALL_COMMAND = `npx @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} install-browser chrome`;

// A missing or unknown profile is judged by the stricter showcase rules.
export const profileOf = (review) => (Object.hasOwn(DESIGN_PROFILES, review?.profile) ? review.profile : "showcase");

export function weightedScore(scores, profile = "showcase") {
  const total = Object.entries(DESIGN_PROFILES[profile]).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0);
  return Math.round(total * 100) / 100;
}

const minimumFor = (profile, criterion) => (profile === "product" && criterion === "innovation" ? PRODUCT_MIN_INNOVATION : DESIGN_MIN_CRITERION);

// One line for the final summary, telling the user how to get a visual review next time (docs/03 section 6.8).
export function unrenderedNote(taskId, reason) {
  const prefix = `Design for ${taskId} was not visually checked:`;
  if (reason === "needs_login") return `${prefix} the screen needs a signed-in user. Add TENONRY_PREVIEW_USER and TENONRY_PREVIEW_PASSWORD (a local test account) to .env.`;
  if (reason === "browser_missing") return `${prefix} the review browser is not installed. Run: ${BROWSER_INSTALL_COMMAND}`;
  if (reason === "preview_failed") return `${prefix} the preview server did not start. See .tenonry/logs/preview.log.`;
  if (reason === "no_preview") return `${prefix} no preview command was detected. Set "preview" in .tenonry/config.json.`;
  return `${prefix} ${reason || "no reason was given"}.`;
}

const validFindings = (findings) => Array.isArray(findings) && findings.every((f) => typeof f === "object" && f !== null && SEVERITIES.includes(f.severity));

function codeSchemaOk(review) {
  return typeof review === "object" && review !== null && validFindings(review.findings);
}

function designSchemaOk(review) {
  if (typeof review !== "object" || review === null || !validFindings(review.findings)) return false;
  const scores = review.scores;
  return typeof scores === "object" && scores !== null && CRITERIA.every((key) => typeof scores[key] === "number" && scores[key] >= 0 && scores[key] <= 10);
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
  const login = loginAvailable(root);
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
      delegation: reviewMessage({ runId, task: def, kind, round: task.reviewRounds[kind], files, preview, login }),
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
  if (typeof review !== "object" || review === null) return { status: "error", reason: "missing or invalid review file", lines: [] };
  // A review that never saw the page cannot pass or fail on guessed scores, and never starts a fix round.
  if (review.rendered === false) {
    const reason = typeof review.unrenderedReason === "string" && review.unrenderedReason.trim() ? review.unrenderedReason.trim() : null;
    return { status: "unrendered", rendered: false, unrenderedReason: reason, lines: [] };
  }
  if (!designSchemaOk(review)) return { status: "error", reason: "missing or invalid review file", lines: [] };

  const profile = profileOf(review);
  const weighted = weightedScore(review.scores, profile);
  const tooLow = CRITERIA.filter((key) => review.scores[key] < minimumFor(profile, key));
  const hasBlocking = review.findings.some((f) => f.severity === "blocking");
  const passes = weighted >= DESIGN_PASS_SCORE && tooLow.length === 0 && !hasBlocking;
  const lines = [];
  if (!passes) {
    const floor = profile === "product" ? `${DESIGN_MIN_CRITERION}, innovation at least ${PRODUCT_MIN_INNOVATION}` : String(DESIGN_MIN_CRITERION);
    lines.push(`- [design] ${profile} weighted score ${weighted} (needs ${DESIGN_PASS_SCORE}, every criterion at least ${floor})`);
    lines.push(...review.findings.map((f) => formatFinding(f, f.criterion ? `(${f.criterion})` : "(design)")));
  }
  return { status: passes ? "pass" : "fail", profile, weighted, rendered: true, findings: review.findings.length, lines };
}

// An unrendered design review does not block the task; checkpoint turns it into done_with_findings.
const passed = (status) => status === "pass" || status === "unrendered";

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
  if (results.design) task.unrenderedReason = results.design.status === "unrendered" ? results.design.unrenderedReason : null;

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

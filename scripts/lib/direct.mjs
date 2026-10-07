import fs from "node:fs";
import path from "node:path";
import { CliError, loadContext, relRunPath, readContract, writeContract } from "./ctx.mjs";
import { readRoute, quickOwnerQuestions, mapOwner } from "./routing.mjs";
import { decideWithJev } from "./jev.mjs";
import { validateContract, syncRunTasks } from "./contract.mjs";
import { runDir } from "./paths.mjs";

// The steps Jev lets a run skip still leave the file the next step reads. Each stand-in is written by code,
// with no agent, and says what it is so that no agent mistakes it for a planner's, art director's, or test author's work.

const MAX_REQUEST_CHARACTERS = 6000;
const MAX_TITLE_CHARACTERS = 72;
const DESIGN_DIRECTION = ".tenonry/design-direction.md";

const DIRECT_PLAN_INTRO =
  "No planner ran for this request. Jev judged it small and clear enough to build without a separate plan, so the brief below is the whole specification. Build exactly what it asks, completely, and nothing more.";

const NO_NEW_DESIGN_HEADING = "# Design brief: no new design";
const NO_NEW_DESIGN_BRIEF = `${NO_NEW_DESIGN_HEADING}

No art director ran for this request. Jev judged that it needs no new design decisions, so this run only applies the look the interface already has.

## Every screen this run touches
- Profile: \`product\`
- Follow \`${DESIGN_DIRECTION}\` exactly and match the screens that already exist: the same tokens, components, layout patterns, states, and voice.
- Add no new token, component style, layout pattern, or motion. Where the request needs something that has no existing pattern, use the closest one in the direction.
- Copy: use the wording the request gives; otherwise match the voice of the surrounding interface.

## Review focus
Consistency with the existing interface. Nothing on these screens should look newly designed.
`;

const QUICK_ACCEPTANCE = "The change the request describes is made completely, and nothing else changes.";
const QUICK_NOTE =
  "Quick change: Jev judged this a small mechanical change, so no test author ran and no new tests were written. The builder finds the files itself. The project's existing checks and the code review still apply.";

export const requestBrief = (root, runId, run) => `# Request\n\n${readRoute(root, runId)?.prompt ?? run.prompt}\n`;

function readRunFile(root, runId, name) {
  try {
    return fs.readFileSync(path.join(runDir(root, runId), name), "utf8");
  } catch {
    return null;
  }
}

// Stands in for the planner on a run that Jev routed past planning: plan.md carries the brief as written (docs/03 section 6).
export function directPlan(root, runId) {
  const { run, config } = loadContext(root, runId);
  const route = readRoute(root, runId);
  if (route?.plan !== "no") return { ok: false, reason: "plan_required" };
  const brief = readRunFile(root, runId, "brief.md") ?? requestBrief(root, runId, run);
  const ui = route.ui >= config.routing.thresholds.planning.minUi ? "yes" : "no";
  const file = path.join(runDir(root, runId), "plan.md");
  fs.writeFileSync(file, `---\nui: ${ui}\ndirect: yes\n---\n# Direct run\n\n${DIRECT_PLAN_INTRO}\n\n${brief.replace(/(\r?\n)+$/, "")}\n`);
  return { path: relRunPath(runId, "plan.md"), ui };
}

function planSaysUi(root, runId) {
  const plan = readRunFile(root, runId, "plan.md");
  if (plan === null) throw new CliError("plan_not_found");
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(plan)?.[1] ?? "";
  return /^ui:[ \t]*(yes|true)[ \t]*$/im.test(metadata);
}

// Decides the design step in code (docs/03 section 6): no interface change, nothing new to design, or the art director.
export function designCheck(root, runId) {
  loadContext(root, runId);
  if (!planSaysUi(root, runId)) return { design: "skip", reason: "no_ui", ui: "no" };

  const existing = readRunFile(root, runId, "design-brief.md");
  if (existing !== null && !existing.startsWith(NO_NEW_DESIGN_HEADING)) return { design: "skip", reason: "already_designed", ui: "yes" };

  // Without a design direction there is no existing look to apply, so the art director always runs first.
  const hasDirection = fs.existsSync(path.join(root, DESIGN_DIRECTION));
  if (hasDirection && readRoute(root, runId)?.design === "no") {
    fs.writeFileSync(path.join(runDir(root, runId), "design-brief.md"), NO_NEW_DESIGN_BRIEF);
    return { design: "skip", reason: "no_new_design", ui: "yes", brief: relRunPath(runId, "design-brief.md") };
  }
  return { design: "run", mode: hasDirection ? "extend" : "create", ui: "yes" };
}

function quickTitle(request) {
  const firstLine = request.split("\n").map((line) => line.trim()).find(Boolean) ?? "Quick change";
  const line = firstLine.replace(/\s+/g, " ");
  // A long request is cut at a word boundary so the commit subject does not end mid-word.
  const title = line.length <= MAX_TITLE_CHARACTERS ? line : line.slice(0, MAX_TITLE_CHARACTERS + 1).replace(/\s+\S*$/, "").slice(0, MAX_TITLE_CHARACTERS);
  return title.replace(/[.!?:;,]+$/, "") || "Quick change";
}

async function quickOwner(ctx, request) {
  const candidates = ctx.config.activeSpecialists
    .map((id) => ctx.catalog.find((spec) => spec.id === id))
    .filter(Boolean)
    .map((spec) => ({ agent: `tenonry-${spec.id}`, title: spec.title, owns: spec.owns }));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { owner: candidates[0].agent, source: "only" };

  const thresholds = ctx.config.routing.thresholds;
  const result = await decideWithJev({
    root: ctx.root,
    kind: "quick",
    runId: ctx.runId,
    state: { request: request.slice(0, MAX_REQUEST_CHARACTERS), stack: ctx.config.activeSpecialists },
    questions: quickOwnerQuestions(candidates),
    map: (answers) => mapOwner(answers, thresholds),
    fallback: () => ({ owner: null, confidence: 0, accepted: false }),
    timeoutMs: ctx.config.routing.timeoutMs,
  });
  return result.ok && result.decision.accepted ? { owner: result.decision.owner, source: "jev" } : null;
}

function quickContractSummary(contract) {
  const [task] = contract.tasks;
  const cell = (text) => String(text).replace(/\|/g, "\\|");
  return [
    `# Contract: ${contract.title}`,
    "",
    contract.notes,
    "",
    "| Task | Owner | Title | Depends on |",
    "|---|---|---|---|",
    `| ${task.id} | ${task.owner} | ${cell(task.title)} | - |`,
    "",
    "## Acceptance",
    "",
    ...task.acceptance.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

// Stands in for the test author on a quick run: one task for the specialist Jev picks, no new tests (docs/03 section 6).
// Any reason it cannot do that comes back as ok: false, and the run skill falls back to the test author.
export async function quickContract(root, runId) {
  const ctx = loadContext(root, runId);
  const route = readRoute(root, runId);
  if (route?.lane !== "quick") return { ok: false, reason: "not_quick" };

  const existing = readContract(root, runId);
  if (existing) {
    if (existing.quick !== true) return { ok: false, reason: "contract_exists" };
    return { owner: existing.tasks[0].owner, source: "existing", tasks: existing.tasks.length, path: relRunPath(runId, "contract.json") };
  }

  const request = String(route.prompt ?? ctx.run.prompt ?? "").trim();
  const chosen = await quickOwner(ctx, request);
  if (!chosen) return { ok: false, reason: "no_owner" };

  const title = quickTitle(request);
  const contract = {
    version: 1,
    runId,
    title,
    summary: request,
    quick: true,
    interfaces: [],
    tasks: [
      { id: "T1", title, owner: chosen.owner, summary: request, files: [], dependsOn: [], acceptance: [QUICK_ACCEPTANCE], tests: [], ui: false, newScreen: false, interfaces: [] },
    ],
    notes: QUICK_NOTE,
  };
  const checked = validateContract(root, runId, contract, { config: ctx.config, catalog: ctx.catalog });
  if (!checked.valid) return { ok: false, reason: "invalid_contract", errors: checked.errors };

  writeContract(root, runId, contract);
  fs.writeFileSync(path.join(runDir(root, runId), "contract.md"), quickContractSummary(contract));
  syncRunTasks(ctx.run, contract);
  ctx.save();
  return { owner: chosen.owner, source: chosen.source, tasks: 1, path: relRunPath(runId, "contract.json") };
}

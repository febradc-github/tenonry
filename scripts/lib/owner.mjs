import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./json.mjs";
import { loadContext, specialistOf, isUiLayer, reportPath, writeContract, runTask, taskDefinition } from "./ctx.mjs";
import { loadRules, resolveOwner, ownerAllows } from "./ownership.mjs";
import { decideWithJev } from "./jev.mjs";
import { ownerQuestions, mapOwner } from "./routing.mjs";
import { newTask } from "./state.mjs";
import { runDir } from "./paths.mjs";

const SIBLING_LIMIT = 10;
const MAX_FRUITLESS_HANDOFFS = 2;

function expandBraces(glob) {
  const match = /\{([^{}]*)\}/.exec(glob);
  if (!match) return [glob];
  return match[1].split(",").flatMap((alternative) => expandBraces(glob.slice(0, match.index) + alternative + glob.slice(match.index + match[0].length)));
}

// Active specialists of the package that contains the path, falling back to every active one.
function candidateSpecialists(ctx, relPath) {
  const packages = ctx.config.packages.filter((pkg) => pkg.root === "." || relPath.startsWith(`${pkg.root}/`));
  packages.sort((a, b) => b.root.length - a.root.length);
  const ids = new Set(packages[0]?.specialists ?? ctx.config.activeSpecialists);
  return ctx.catalog.filter((spec) => ids.has(spec.id) && spec.layer !== undefined);
}

// First pass: a generic "**/*.ext" glob; second pass: any glob ending with the extension (D-053).
export function heuristicOwner(ctx, relPath) {
  const extension = path.posix.extname(relPath);
  if (!extension) return null;
  const candidates = candidateSpecialists(ctx, relPath);
  const alternativesOf = (spec) => spec.owns.flatMap(expandBraces);
  const generic = candidates.find((spec) => alternativesOf(spec).includes(`**/*${extension}`));
  const loose = candidates.find((spec) => alternativesOf(spec).some((glob) => glob.endsWith(extension)));
  const found = generic ?? loose;
  return found ? `tenonry-${found.id}` : null;
}

function addRunRule(root, runId, relPath, owner, source) {
  const file = path.join(runDir(root, runId), "owner-rules.json");
  const existing = readJson(file, { version: 1, generatedAt: new Date().toISOString(), rules: [] });
  existing.rules.push({ glob: relPath, owner, priority: 950, source });
  writeJsonAtomic(file, existing);
}

function siblingsOf(ctx, relPath, rules) {
  const dir = path.posix.dirname(relPath);
  let names;
  try {
    names = fs.readdirSync(path.join(ctx.root, dir === "." ? "" : dir), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const siblings = [];
  for (const name of names) {
    const sibling = dir === "." ? name : `${dir}/${name}`;
    if (sibling === relPath) continue;
    const resolved = resolveOwner(rules, sibling);
    if (resolved && typeof resolved.owner === "string") siblings.push({ path: sibling, owner: resolved.owner });
    if (siblings.length >= SIBLING_LIMIT) break;
  }
  return siblings;
}

// Docs/03 section 6.6: rules, then Jev, then the extension heuristic.
export async function resolveFileOwner(ctx, relPath, purpose = "") {
  const rules = loadRules(ctx.root, ctx.runId);
  const resolved = resolveOwner(rules, relPath);
  if (resolved) return { owner: resolved.owner, source: "rules" };

  const candidates = ctx.config.activeSpecialists
    .map((id) => ctx.catalog.find((spec) => spec.id === id))
    .filter(Boolean)
    .map((spec) => ({ agent: `tenonry-${spec.id}`, title: spec.title, owns: spec.owns }));
  if (candidates.length > 0) {
    const thresholds = ctx.config.routing.thresholds;
    const result = await decideWithJev({
      root: ctx.root,
      kind: "owner",
      runId: ctx.runId,
      state: { path: relPath, purpose, siblings: siblingsOf(ctx, relPath, rules) },
      questions: ownerQuestions(candidates),
      map: (answers) => mapOwner(answers, thresholds),
      fallback: () => ({ owner: null, confidence: 0, accepted: false }),
      timeoutMs: ctx.config.routing.timeoutMs,
    });
    if (result.ok && result.decision.accepted) {
      addRunRule(ctx.root, ctx.runId, relPath, result.decision.owner, `jev:${ctx.runId}`);
      return { owner: result.decision.owner, source: "jev", confidence: result.decision.confidence };
    }
  }

  const heuristic = heuristicOwner(ctx, relPath);
  if (heuristic) {
    addRunRule(ctx.root, ctx.runId, relPath, heuristic, `heuristic:${ctx.runId}`);
    return { owner: heuristic, source: "heuristic" };
  }
  return { owner: null, source: "none" };
}

export async function ownerCommand(root, runId, relPath, purpose) {
  const ctx = loadContext(root, runId);
  return resolveFileOwner(ctx, relPath, purpose);
}

// Docs/03 section 6: turn a specialist's handoffs into follow-up tasks and re-queue the original.
export async function handoff(root, runId, taskId) {
  const ctx = loadContext(root, runId, { contract: true });
  const def = taskDefinition(ctx, taskId);
  const task = runTask(ctx, taskId);
  const report = readJson(reportPath(root, runId, taskId), null);
  const handoffs = Array.isArray(report?.handoffs) ? report.handoffs.filter((h) => typeof h?.path === "string") : [];

  const byOwner = new Map();
  const unresolved = [];
  for (const item of handoffs) {
    const { owner } = await resolveFileOwner(ctx, item.path, item.reason ?? "");
    if (typeof owner !== "string" || owner === "none") {
      unresolved.push(item.path);
      task.notes.push(`handoff for ${item.path} has no resolvable owner`);
    } else if (!ownerAllows(owner, def.owner)) {
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(item);
    }
  }

  const created = [];
  let nextNumber = Math.max(0, ...ctx.contract.tasks.map((t) => Number(t.id.slice(1)))) + 1;
  for (const [owner, items] of byOwner) {
    const id = `T${nextNumber++}`;
    const reasons = [...new Set(items.map((i) => i.reason).filter(Boolean))].join("; ");
    ctx.contract.tasks.push({
      id,
      title: `Support ${taskId}: ${items.map((i) => path.posix.basename(i.path)).join(", ")}`.slice(0, 100),
      owner,
      summary: `Needed by ${taskId}: ${reasons}`,
      files: [...new Set(items.map((i) => i.path))],
      dependsOn: [],
      acceptance: [`Provides what ${taskId} needs: ${reasons}`],
      tests: [],
      ui: isUiLayer(specialistOf(ctx, owner)?.layer),
      newScreen: false,
      interfaces: [],
    });
    ctx.run.tasks[id] = newTask({ owner });
    def.dependsOn = [...(def.dependsOn ?? []), id];
    created.push(id);
  }
  if (created.length > 0) {
    task.status = "pending";
    writeContract(root, runId, ctx.contract);
  } else if ((task.handoffRetries = (task.handoffRetries ?? 0) + 1) >= MAX_FRUITLESS_HANDOFFS) {
    task.status = "blocked";
    task.notes.push("blocked: handoffs could not be resolved to another owner");
  } else {
    task.status = "pending";
  }
  ctx.save();
  return { created, unresolved };
}

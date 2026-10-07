import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./json.mjs";
import { decideWithJev } from "./jev.mjs";
import { loadConfig } from "./config.mjs";
import { runDir } from "./paths.mjs";

export const TIERS = ["haiku", "sonnet", "opus"];
const FAMILIES = ["opus", "sonnet", "haiku", "fable"];
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_REQUEST_CHARACTERS = 6000;

const DIFFICULTY_LEVELS = [
  "Trivial: a small mechanical change in one place, such as a rename, copy edit, or config value.",
  "Routine: a standard feature or fix that follows patterns already in the codebase.",
  "Hard: new design decisions, changes across several modules, or tricky logic and edge cases.",
  "Frontier: novel architecture, security-critical or concurrency-heavy work, or a large migration.",
];
const BLAST_RADIUS_LEVELS = [
  "Contained: one file or a leaf component that nothing else depends on.",
  "Local: one module or feature.",
  "Wide: shared code, public interfaces, or data used by many modules.",
];

export const tierIndex = (tier) => TIERS.indexOf(tier);
export const roundUp = (tier) => TIERS[Math.min(tierIndex(tier) + 1, TIERS.length - 1)];
export const applyFloor = (tier, floor) => (tierIndex(floor) > tierIndex(tier) ? floor : tier);
export const nextTier = (tier) => TIERS[tierIndex(tier) + 1] ?? null;
const two = (n) => Number(n).toFixed(2);

export function intakeQuestions() {
  return {
    ambiguity: {
      type: "noul",
      instructions:
        "Would a competent engineer working in this repository need to ask the requester questions before building this, because scope, expected behavior, or success criteria are missing and cannot reasonably be inferred?",
      criteria: {
        true: "Key scope, behavior, or acceptance details are missing or contradictory.",
        false: "The request is specific enough to plan and build, using reasonable defaults where needed.",
      },
    },
    difficulty: { type: "score", instructions: "How difficult is this request to implement well in this stack?", criteria: DIFFICULTY_LEVELS },
    task_type: {
      type: "choice",
      instructions: "What kind of work is this request?",
      criteria: {
        mechanical: "Renames, copy edits, config tweaks, dependency bumps.",
        bugfix: "Fixing incorrect existing behavior.",
        feature: "Adding new user-facing or API behavior.",
        refactor: "Restructuring code without changing behavior.",
        architecture: "Changing system structure, data models, or cross-cutting design.",
        investigation: "Analysis or research with little or no code change.",
        ui_design: "Primarily the visual or interaction design of screens.",
      },
    },
    ui: {
      type: "noul",
      instructions: "Does this request create or visibly change a user interface: screens, layouts, components, styles, or 3D scenes?",
      criteria: {
        true: "Users will see new or changed interface elements.",
        false: "Only behavior, data, APIs, tooling, or infrastructure change.",
      },
    },
  };
}

export function dispatchQuestions() {
  return {
    difficulty: { type: "score", instructions: "How difficult is this task for a capable engineer who owns these files?", criteria: DIFFICULTY_LEVELS },
    fully_specified: {
      type: "noul",
      instructions:
        "Do the task, its files, and its acceptance criteria fully specify what to build, so the work is mainly executing clear instructions?",
      criteria: {
        true: "Exact files, behavior, and acceptance criteria are given; little judgment is needed.",
        false: "Meaningful design or behavior decisions remain open.",
      },
    },
    blast_radius: { type: "score", instructions: "How far could a mistake in this task spread through the codebase?", criteria: BLAST_RADIUS_LEVELS },
  };
}

export function ownerQuestions(candidates) {
  const criteria = {};
  for (const candidate of candidates) criteria[candidate.agent] = `${candidate.title}. Owns: ${candidate.owns.slice(0, 6).join(", ")}`;
  return {
    owner: {
      type: "choice",
      instructions: "Which specialist should own this file, based on its path, its purpose, and who owns the files around it?",
      criteria,
    },
  };
}

export function riskQuestions() {
  return {
    risky: {
      type: "noul",
      instructions:
        "Does this change touch authentication, authorization, payments, personal data, secrets, database schema or migrations, concurrency, or the handling of untrusted input?",
      criteria: {
        true: "At least one of those sensitive areas is affected.",
        false: "None of those sensitive areas is affected.",
      },
    },
    blast_radius: { type: "score", instructions: "How far could a mistake in this change spread through the codebase?", criteria: BLAST_RADIUS_LEVELS },
  };
}

export function mapIntake(answers, thresholds, family) {
  return {
    jev: "ok",
    fallbackReason: null,
    clarify: answers.ambiguity.noul >= thresholds.clarifyIfAmbiguity ? "yes" : "no",
    difficulty: answers.difficulty.score,
    difficultyConfidence: answers.difficulty.confidence,
    taskType: answers.task_type.choice,
    ui: answers.ui.noul,
    mainModel: { current: family, notice: family === "haiku" },
  };
}

export function fallbackIntake(reason, family) {
  return {
    jev: "fallback",
    fallbackReason: reason,
    clarify: "auto",
    difficulty: null,
    difficultyConfidence: null,
    taskType: null,
    ui: null,
    mainModel: { current: family, notice: family === "haiku" },
  };
}

export function mapDispatch(answers, thresholds, floor) {
  const { difficulty, fully_specified: specified, blast_radius: blast } = answers;
  let model;
  if (specified.noul >= thresholds.haiku.minFullySpecified && difficulty.score <= thresholds.haiku.maxDifficulty && blast.score <= thresholds.haiku.maxBlastRadius) {
    model = "haiku";
  } else if (difficulty.score >= thresholds.opus.minDifficulty || blast.score >= thresholds.opus.minBlastRadius) {
    model = "opus";
  } else {
    model = "sonnet";
  }
  if (difficulty.confidence < thresholds.roundUpIfConfidenceBelow || blast.confidence < thresholds.roundUpIfConfidenceBelow) model = roundUp(model);
  model = applyFloor(model, floor);
  const reason = `jev difficulty=${two(difficulty.score)}(c${two(difficulty.confidence)}) specified=${two(specified.noul)} blast=${two(blast.score)}(c${two(blast.confidence)}) -> ${model}`;
  return { model, reason };
}

export function fallbackDispatch(failure, floor) {
  const model = applyFloor("sonnet", floor);
  return { model, reason: `fallback ${failure} -> ${model}` };
}

export function mapOwner(answers, thresholds) {
  const { choice, confidence } = answers.owner;
  return { owner: choice, confidence, accepted: confidence >= thresholds.newFileOwnerMinConfidence };
}

export function mapRisk(answers, thresholds) {
  const opus = answers.risky.noul >= thresholds.codeReviewOpus.minRisky || answers.blast_radius.score >= thresholds.codeReviewOpus.minBlastRadius;
  return { model: opus ? "opus" : "sonnet", risky: answers.risky.noul, blastRadius: answers.blast_radius.score };
}

export const fallbackRisk = () => ({ model: "opus", risky: null, blastRadius: null });

function familyOf(name) {
  const lower = String(name ?? "").toLowerCase();
  return FAMILIES.find((family) => lower.includes(family)) ?? "unknown";
}

function modelFromTranscript(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    try {
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n").reverse();
      for (const line of lines) {
        if (!line.includes('"model"')) continue;
        try {
          const model = JSON.parse(line)?.message?.model;
          if (typeof model === "string" && familyOf(model) !== "unknown") return model;
        } catch {
          // a partial first line of the tail window is skipped
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return null;
}

// The main session's model family: input.model, else the latest assistant message in the transcript.
export function currentModelFamily(input) {
  const model = input?.model;
  const direct = typeof model === "string" ? model : (model?.id ?? model?.display_name);
  const family = familyOf(direct);
  if (family !== "unknown") return family;
  const transcript = typeof input?.transcript_path === "string" ? modelFromTranscript(input.transcript_path) : null;
  return familyOf(transcript);
}

// Asks Jev the intake questions, maps them, and writes route.json for the run.
export async function runIntake(root, runId, request, family) {
  const config = loadConfig(root);
  const state = { request: String(request).slice(0, MAX_REQUEST_CHARACTERS), stack: config.activeSpecialists, packageCount: config.packages.length || 1 };
  const result = await decideWithJev({
    root,
    kind: "intake",
    runId,
    state,
    questions: intakeQuestions(),
    map: (answers) => mapIntake(answers, config.routing.thresholds, family),
    fallback: (reason) => fallbackIntake(reason, family),
  });
  const route = {
    runId,
    createdAt: new Date().toISOString(),
    prompt: request,
    jev: result.decision.jev,
    fallbackReason: result.decision.fallbackReason,
    answers: result.answers ?? {},
    clarify: result.decision.clarify,
    difficulty: result.decision.difficulty,
    difficultyConfidence: result.decision.difficultyConfidence,
    taskType: result.decision.taskType,
    ui: result.decision.ui,
    mainModel: result.decision.mainModel,
  };
  writeJsonAtomic(path.join(runDir(root, runId), "route.json"), route);
  return route;
}

export const readRoute = (root, runId) => readJson(path.join(runDir(root, runId), "route.json"), null);

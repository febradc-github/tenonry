import path from "node:path";
import { readJson } from "./json.mjs";

export const DEFAULT_ROUTING = {
  jevModel: "typesafe/jev-1.13",
  timeoutMs: 8000,
  thresholds: {
    clarifyIfAmbiguity: 0.6,
    planning: { minNeedsPlan: 0.5, minDifficulty: 2.0, minUi: 0.5 },
    design: { minNewDesign: 0.5, minVisualChange: 0.5 },
    answer: { minConfidence: 0.7 },
    quick: { minConfidence: 0.7, maxDifficulty: 0.5 },
    haiku: { minFullySpecified: 0.8, maxDifficulty: 0.6, maxBlastRadius: 0.5 },
    opus: { minDifficulty: 2.0 },
    roundUpIfConfidenceBelow: 0.5,
    codeReviewOpus: { minRisky: 0.5, minBlastRadius: 1.5 },
    codeReviewHaiku: { maxDifficulty: 0.6, maxRisky: 0.2, maxBlastRadius: 0.5 },
    newFileOwnerMinConfidence: 0.5,
  },
};

export const DEFAULT_LIMITS = {
  maxParallel: 3,
  maxTestRetriesPerTier: 2,
  maxDesignRounds: 3,
  maxCodeReviewRounds: 2,
  maxContractFixes: 2,
};

export const DEFAULT_READ_GUARD = { extraDeny: [], allow: [] };
export const DEFAULT_OUTPUT_FILTER = { maxLines: 120, extraCommands: [] };
export const DEFAULT_CODEBASE_MAP = { enabled: true, maxChars: 2000 };

export const configPath = (root) => path.join(root, ".tenonry", "config.json");

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep merge where values already present in `existing` win; used to keep user edits on re-init.
export function mergePreferExisting(defaults, existing) {
  if (!isPlainObject(defaults) || !isPlainObject(existing)) return existing === undefined ? defaults : existing;
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(existing)) {
    merged[key] = key in defaults ? mergePreferExisting(defaults[key], value) : value;
  }
  return merged;
}

// `opus.minBlastRadius` was retired in 0.3.1; re-init drops it so the file lists only knobs that are read.
export function dropRetiredRouting(routing) {
  const opus = routing?.thresholds?.opus;
  if (!isPlainObject(opus) || !("minBlastRadius" in opus)) return routing;
  const { minBlastRadius, ...kept } = opus;
  return { ...routing, thresholds: { ...routing.thresholds, opus: kept } };
}

// Reads the project config and fills in every optional knob with its default.
export function loadConfig(root) {
  const raw = readJson(configPath(root), {});
  return {
    ...raw,
    routing: mergePreferExisting(DEFAULT_ROUTING, raw.routing),
    limits: mergePreferExisting(DEFAULT_LIMITS, raw.limits),
    readGuard: mergePreferExisting(DEFAULT_READ_GUARD, raw.readGuard),
    outputFilter: mergePreferExisting(DEFAULT_OUTPUT_FILTER, raw.outputFilter),
    codebaseMap: mergePreferExisting(DEFAULT_CODEBASE_MAP, raw.codebaseMap),
    agents: raw.agents ?? [],
    verify: raw.verify ?? [],
    packages: raw.packages ?? [],
    activeSpecialists: raw.activeSpecialists ?? [],
  };
}

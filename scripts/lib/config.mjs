import path from "node:path";
import { readJson } from "./json.mjs";

export const DEFAULT_ROUTING = {
  jevModel: "typesafe/jev-1.13",
  timeoutMs: 8000,
  thresholds: {
    clarifyIfAmbiguity: 0.6,
    haiku: { minFullySpecified: 0.8, maxDifficulty: 0.6, maxBlastRadius: 0.5 },
    opus: { minDifficulty: 2.0, minBlastRadius: 1.5 },
    roundUpIfConfidenceBelow: 0.5,
    codeReviewOpus: { minRisky: 0.5, minBlastRadius: 1.5 },
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

// Reads the project config and fills in every optional knob with its default.
export function loadConfig(root) {
  const raw = readJson(configPath(root), {});
  return {
    ...raw,
    routing: mergePreferExisting(DEFAULT_ROUTING, raw.routing),
    limits: mergePreferExisting(DEFAULT_LIMITS, raw.limits),
    readGuard: mergePreferExisting(DEFAULT_READ_GUARD, raw.readGuard),
    outputFilter: mergePreferExisting(DEFAULT_OUTPUT_FILTER, raw.outputFilter),
    agents: raw.agents ?? [],
    verify: raw.verify ?? [],
    packages: raw.packages ?? [],
    activeSpecialists: raw.activeSpecialists ?? [],
  };
}

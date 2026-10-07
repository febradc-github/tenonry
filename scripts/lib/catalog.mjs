import path from "node:path";
import { readJson } from "./json.mjs";
import { compileGlob } from "./glob.mjs";
import { pluginRoot } from "./paths.mjs";

export const LAYER_COUNTS = { frontend: 24, "3d": 1, backend: 23, data: 22 };
const MODEL_FLOORS = ["haiku", "sonnet", "opus"];
const REQUIRED_FIELDS = ["id", "layer", "title", "detect", "owns", "priority", "supersedes", "modelFloor", "idioms", "slop"];
const DETECT_KEYS = ["files", "npm", "composer", "text"];

export function catalogPath() {
  const root = pluginRoot();
  return root ? path.join(root, "library", "catalog.json") : null;
}

export function loadCatalog(file = catalogPath()) {
  const catalog = readJson(file);
  return catalog.specialists;
}

function globErrors(label, globs) {
  const errors = [];
  for (const glob of globs) {
    try {
      compileGlob(glob);
    } catch (error) {
      errors.push(`${label}: invalid glob ${JSON.stringify(glob)} (${error.message})`);
    }
  }
  return errors;
}

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

function checkSpecialist(spec, ids) {
  const label = `specialist ${spec.id ?? "<no id>"}`;
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (spec[field] === undefined) errors.push(`${label}: missing field ${field}`);
  }
  if (errors.length) return errors;

  if (!/^[a-z0-9-]+$/.test(spec.id)) errors.push(`${label}: id must match ^[a-z0-9-]+$`);
  if (!Object.hasOwn(LAYER_COUNTS, spec.layer)) errors.push(`${label}: unknown layer ${spec.layer}`);
  if (!MODEL_FLOORS.includes(spec.modelFloor)) errors.push(`${label}: modelFloor must be one of ${MODEL_FLOORS.join(", ")}`);
  if (typeof spec.priority !== "number") errors.push(`${label}: priority must be a number`);
  if (!isStringList(spec.owns) || spec.owns.length === 0) errors.push(`${label}: owns must be a non-empty list of globs`);
  if (!isStringList(spec.supersedes)) errors.push(`${label}: supersedes must be a list of ids`);
  if (!isStringList(spec.idioms) || spec.idioms.length < 3 || spec.idioms.length > 5) errors.push(`${label}: needs 3 to 5 idioms`);
  if (!isStringList(spec.slop) || spec.slop.length < 2 || spec.slop.length > 4) errors.push(`${label}: needs 2 to 4 slop items`);

  const detect = spec.detect;
  if (typeof detect !== "object" || detect === null || Array.isArray(detect)) {
    errors.push(`${label}: detect must be an object`);
    return errors;
  }
  for (const key of Object.keys(detect)) {
    if (!DETECT_KEYS.includes(key)) errors.push(`${label}: unknown detect signal ${key}`);
  }
  if (Object.keys(detect).length === 0) errors.push(`${label}: detect has no signals`);
  if (detect.files !== undefined) errors.push(...globErrors(`${label} detect.files`, detect.files));
  if (detect.text !== undefined) errors.push(...globErrors(`${label} detect.text`, Object.keys(detect.text)));
  if (isStringList(spec.owns)) errors.push(...globErrors(`${label} owns`, spec.owns));
  for (const other of spec.supersedes ?? []) {
    if (!ids.has(other)) errors.push(`${label}: supersedes unknown id ${other}`);
  }
  return errors;
}

export function checkCatalog(catalog) {
  const specs = catalog?.specialists;
  if (!Array.isArray(specs)) return { ok: false, errors: ["catalog has no specialists array"], counts: {} };

  const errors = [];
  const ids = new Set();
  const seen = new Set();
  for (const spec of specs) {
    if (seen.has(spec.id)) errors.push(`duplicate id ${spec.id}`);
    seen.add(spec.id);
    ids.add(spec.id);
  }
  const counts = {};
  for (const spec of specs) counts[spec.layer] = (counts[spec.layer] ?? 0) + 1;
  for (const [layer, expected] of Object.entries(LAYER_COUNTS)) {
    if ((counts[layer] ?? 0) !== expected) errors.push(`layer ${layer} has ${counts[layer] ?? 0} specialists, expected ${expected}`);
  }
  for (const spec of specs) errors.push(...checkSpecialist(spec, ids));
  return { ok: errors.length === 0, errors, counts };
}

import { readJson } from "./json.mjs";
import { catalogPath, checkCatalog } from "./catalog.mjs";

function catalogCheck({ flags }) {
  const file = flags.file || catalogPath();
  if (!file) return { ok: false, error: "catalog_not_found" };
  const result = checkCatalog(readJson(file));
  return { ...result, file };
}

// Each command receives { args, flags, root, cwd } and returns the one JSON object to print.
export const COMMANDS = {
  "catalog-check": { run: catalogCheck, needsProject: false },
};

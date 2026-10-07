import fs from "node:fs";
import { fileURLToPath } from "node:url";

// True when the module is the process entry point, so hook scripts can export helpers for tests.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

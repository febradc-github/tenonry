import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));

export function findProjectRoot(startDir) {
  if (!startDir) return null;
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".tenonry", "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The directory that holds `library/catalog.json`: the plugin root when running from the
// plugin (scripts/lib), or `.tenonry/bin` when running from a project copy (.tenonry/bin/lib).
export function pluginRoot() {
  for (const candidate of [path.resolve(libDir, "..", ".."), path.resolve(libDir, "..")]) {
    if (fs.existsSync(path.join(candidate, "library", "catalog.json"))) return candidate;
  }
  return null;
}

export function rel(root, absPath) {
  const relative = path.relative(path.resolve(root), path.resolve(absPath));
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

export function runDir(root, runId) {
  return path.join(root, ".tenonry", "runs", runId);
}

function realpathOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

// Like `rel`, but also matches when the project or the target is reached through a symlink
// (for example /tmp versus /private/tmp on macOS). The target need not exist yet.
export function relResolved(root, target) {
  const lexical = rel(root, target);
  if (lexical !== null) return lexical;
  let existing = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return rel(realpathOrSelf(root), path.join(realpathOrSelf(existing), ...missing));
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson } from "./json.mjs";
import { matchGlob } from "./glob.mjs";

export const SKIP_DIRS = new Set([
  ".git", "node_modules", "vendor", "dist", "build", ".next", ".nuxt", ".output", ".svelte-kit", "out", "coverage",
  "target", ".venv", "venv", "__pycache__", ".tenonry", ".claude",
]);
const PACKAGE_MARKERS = [
  "package.json", "composer.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "Gemfile", "mix.exs",
  "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml",
];
const HASHED_FILES = [
  ...PACKAGE_MARKERS, "Pipfile", "deno.json", "deno.jsonc", "dbt_project.yml", "pnpm-workspace.yaml", "artisan", "manage.py",
];
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 20000;
const MAX_TEXT_BYTES = 256 * 1024;
const TEXT_SIGNAL_MAX_DIRECTORY_DEPTH = 2;

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function subdirectories(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function hasManifest(dir) {
  try {
    return fs.readdirSync(dir).some((name) => PACKAGE_MARKERS.includes(name) || name.endsWith(".csproj"));
  } catch {
    return false;
  }
}

function pnpmWorkspacePatterns(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  } catch {
    return [];
  }
  const patterns = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
    } else if (inPackages) {
      const match = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
      if (match) patterns.push(match[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return patterns;
}

function expandWorkspacePattern(root, rawPattern) {
  const pattern = rawPattern.replace(/^\.\//, "").replace(/\/$/, "");
  if (!pattern || pattern.startsWith("!")) return [];
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3);
    const first = subdirectories(path.join(root, base)).map((name) => `${base}/${name}`);
    const second = first.flatMap((dir) => subdirectories(path.join(root, dir)).map((name) => `${dir}/${name}`));
    return [...first, ...second];
  }
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return subdirectories(path.join(root, base)).map((name) => `${base}/${name}`);
  }
  return isDir(path.join(root, pattern)) ? [pattern] : [];
}

export function findPackageRoots(root) {
  const roots = new Set(["."]);
  const pkg = readJson(path.join(root, "package.json"), {});
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  for (const pattern of [...workspaces, ...pnpmWorkspacePatterns(root)]) {
    for (const dir of expandWorkspacePattern(root, pattern)) roots.add(dir);
  }
  for (const name of subdirectories(root)) {
    if (hasManifest(path.join(root, name))) roots.add(name);
  }
  const rest = [...roots].filter((r) => r !== ".").sort();
  return [".", ...rest];
}

export function packageManager(pkgDir, root = pkgDir) {
  const stop = path.resolve(root);
  let dir = path.resolve(pkgDir);
  for (;;) {
    const has = (name) => fs.existsSync(path.join(dir, name));
    if (has("pnpm-lock.yaml")) return "pnpm";
    if (has("yarn.lock")) return "yarn";
    if (has("bun.lockb") || has("bun.lock")) return "bun";
    if (has("package-lock.json")) return "npm";
    if (dir === stop || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  return fs.existsSync(path.join(pkgDir, "package.json")) ? "npm" : null;
}

// Lists files (relative to the package directory) up to depth 6, skipping generated directories
// and the subtrees of other package roots.
export function scanFiles(pkgDir, skipRelDirs = []) {
  const skip = new Set(skipRelDirs);
  const files = [];
  let truncated = false;
  const stack = [{ rel: "", depth: 0 }];
  while (stack.length > 0 && !truncated) {
    const { rel: dirRel, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(pkgDir, dirRel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || skip.has(relPath) || depth + 1 > MAX_SCAN_DEPTH) continue;
        stack.push({ rel: relPath, depth: depth + 1 });
      } else if (entry.isFile()) {
        if (files.length >= MAX_SCAN_FILES) {
          truncated = true;
          break;
        }
        files.push(relPath);
      }
    }
  }
  return { files: files.sort(), truncated };
}

function readText(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(MAX_TEXT_BYTES);
      const bytes = fs.readSync(fd, buffer, 0, MAX_TEXT_BYTES, 0);
      return buffer.toString("utf8", 0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

const directoryDepth = (relPath) => relPath.split("/").length - 1;

function dependencyNames(pkgDir) {
  const pkg = readJson(path.join(pkgDir, "package.json"), {});
  const composer = readJson(path.join(pkgDir, "composer.json"), {});
  return {
    npm: new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]),
    composer: new Set([...Object.keys(composer.require ?? {}), ...Object.keys(composer["require-dev"] ?? {})]),
  };
}

function signalMatches(detect, files, deps, readCached, pkgDir) {
  if (detect.npm?.some((name) => deps.npm.has(name))) return true;
  if (detect.composer?.some((name) => deps.composer.has(name))) return true;
  if (detect.files?.some((glob) => files.some((file) => matchGlob(glob, file)))) return true;
  for (const [glob, needles] of Object.entries(detect.text ?? {})) {
    for (const file of files) {
      if (directoryDepth(file) > TEXT_SIGNAL_MAX_DIRECTORY_DEPTH || !matchGlob(glob, file)) continue;
      const text = readCached(path.join(pkgDir, file));
      if (needles.some((needle) => text.includes(needle))) return true;
    }
  }
  return false;
}

// Removes specialists listed in `supersedes` by another still-active specialist, in catalog order.
export function applySupersession(activeIds, catalog) {
  const active = new Set(activeIds);
  for (const spec of catalog) {
    if (!active.has(spec.id)) continue;
    for (const other of spec.supersedes) active.delete(other);
  }
  return catalog.filter((spec) => active.has(spec.id)).map((spec) => spec.id);
}

export function detectPackage(root, pkgRoot, catalog, allRoots = [pkgRoot]) {
  const pkgDir = pkgRoot === "." ? root : path.join(root, pkgRoot);
  const prefix = pkgRoot === "." ? "" : `${pkgRoot}/`;
  const skipRelDirs = allRoots.filter((r) => r !== pkgRoot && (pkgRoot === "." || r.startsWith(prefix))).map((r) => (pkgRoot === "." ? r : r.slice(prefix.length)));
  const { files, truncated } = scanFiles(pkgDir, skipRelDirs);
  const deps = dependencyNames(pkgDir);
  const cache = new Map();
  const readCached = (file) => {
    if (!cache.has(file)) cache.set(file, readText(file));
    return cache.get(file);
  };
  const matched = catalog.filter((spec) => signalMatches(spec.detect, files, deps, readCached, pkgDir)).map((spec) => spec.id);
  return {
    root: pkgRoot,
    packageManager: packageManager(pkgDir, root),
    specialists: applySupersession(matched, catalog),
    files,
    truncated,
  };
}

export function detectAll(root, catalog) {
  const roots = findPackageRoots(root);
  const packages = roots.map((pkgRoot) => detectPackage(root, pkgRoot, catalog, roots));
  const warnings = packages.filter((pkg) => pkg.truncated).map((pkg) => `file scan of package ${pkg.root} stopped after ${MAX_SCAN_FILES} files`);
  return { packages, warnings };
}

// Hash of the plugin version plus every manifest file at directory depth 2 or less.
export function manifestHash(root, pluginVersion) {
  const found = [];
  const visit = (dirRel, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (depth < 2 && !SKIP_DIRS.has(entry.name)) visit(relPath, depth + 1);
      } else if (entry.isFile() && (HASHED_FILES.includes(entry.name) || /^requirements.*\.txt$/.test(entry.name) || entry.name.endsWith(".csproj"))) {
        found.push(relPath);
      }
    }
  };
  visit("", 0);
  const hash = crypto.createHash("sha256").update(`version:${pluginVersion}\n`);
  for (const relPath of found.sort()) {
    hash.update(`\0${relPath}\0`);
    hash.update(fs.readFileSync(path.join(root, relPath)));
  }
  return hash.digest("hex");
}

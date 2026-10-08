import fs from "node:fs";
import path from "node:path";
import { git } from "./git.mjs";
import { DEFAULT_CODEBASE_MAP } from "./config.mjs";

// The codebase map: one line per source folder naming what its files define, inside a character
// budget, so agents reuse what exists instead of searching for it first. Adapted from ponytail's
// codebase map (https://github.com/dietrichgebert/ponytail, MIT). Regexes, not parsers: nested and
// dynamic definitions are missed, which is fine for a hint an agent can follow up with a search.

export const MAP_HEADER = "Codebase map (what already exists, one line per folder; reuse it, and read a file only when you need its details):";

// The art director and the design reviewer judge the interface, not the code, so they get no map.
const NO_MAP_AGENTS = new Set(["tenonry-art-director", "tenonry-design-reviewer"]);
const MAX_FILES = 4000;
const MAX_BYTES = 64 * 1024;
const MIN_LINE = 24;
const MAX_NAMES = 30;

const SKIP_DIR = /(^|\/)(\.[^/]*|node_modules|vendor|dist|build|out|target|coverage|venv|__pycache__|migrations|fixtures|tests?|__tests__|spec|e2e)(\/|$)/;
const SKIP_FILE = /(^|\/)(test_[^/]*|[^/]*(_test|\.test|\.spec|\.stories|\.gen|\.min|\.d)\.[a-z]+)$/;
const SHARED = /(util|helper|lib|common|shared|service|component|composable|hook|store|core|model|schema|api)/i;
const COMPONENT_FILE = /\.(vue|svelte|astro)$/;

const PATTERNS = {
  js: [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s*\{([^}]*)\}/gm,
  ],
  py: [/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm, /^class\s+([A-Za-z]\w*)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, /^type\s+([A-Z]\w*)/gm],
  rs: [/^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+(\w+)/gm],
  rb: [/^\s*(?:def|class|module)\s+([A-Za-z][\w.:]*)/gm],
  php: [/^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/gm, /^function\s+([A-Za-z_]\w*)/gm],
  jvm: [/^\s*(?:(?:public|internal|open|abstract|sealed|static|final|partial|data|enum|annotation|value)\s+)*(?:class|interface|enum|record|struct|protocol|object)\s+([A-Za-z_]\w*)/gm],
  ex: [/^\s*defmodule\s+([A-Z][\w.]*)/gm],
  dart: [/^(?:(?:abstract|sealed|base|final|interface)\s+)*(?:class|mixin|enum)\s+([A-Za-z_]\w*)/gm],
};
const LANG = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", mts: "js", cts: "js",
  py: "py", go: "go", rs: "rs", rb: "rb", php: "php", ex: "ex", dart: "dart",
  java: "jvm", kt: "jvm", scala: "jvm", swift: "jvm", cs: "jvm",
};

const extension = (file) => path.posix.extname(file).slice(1);
const isSource = (file) => !SKIP_DIR.test(file) && !SKIP_FILE.test(file) && (Boolean(LANG[extension(file)]) || COMPONENT_FILE.test(file));

export function receivesMap(agentType) {
  return typeof agentType === "string" && agentType.startsWith("tenonry-") && !NO_MAP_AGENTS.has(agentType);
}

// Tracked files; a short directory walk when git lists none (no repository, or nothing committed yet).
function listFiles(root) {
  const result = git(root, ["ls-files", "-z"]);
  const tracked = result.status === 0 ? result.stdout.split("\0").filter(Boolean) : [];
  if (tracked.length) return tracked;
  const files = [];
  const visit = (dir, depth) => {
    if (depth > 6 || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(`${rel}/`)) visit(rel, depth + 1);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  visit("", 0);
  return files;
}

const buffer = Buffer.alloc(MAX_BYTES);
function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    return buffer.toString("utf8", 0, fs.readSync(fd, buffer, 0, MAX_BYTES, 0));
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// The top-level names a file defines or exports; a single-file component is named by its file.
export function namesIn(file, text) {
  if (COMPONENT_FILE.test(file)) return [path.posix.basename(file).replace(COMPONENT_FILE, "")];
  const names = [];
  for (const pattern of PATTERNS[LANG[extension(file)]] ?? []) {
    for (const match of text.matchAll(pattern)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, "").trim();
        if (/^[A-Za-z$][\w$.:]*$/.test(name) && name !== "default" && !names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

function folderLine(root, folder, files) {
  const perFile = files
    .map((file) => namesIn(file, COMPONENT_FILE.test(file) ? "" : readHead(path.join(root, file))))
    .filter((names) => names.length);
  if (!perFile.length) return null;
  // A file's first names say what it is; in a folder of many files, such as a UI kit, one name each.
  const names = [...new Set(perFile.flatMap((list) => list.slice(0, perFile.length > 8 ? 1 : 3)))];
  return `${folder}/: ${names.slice(0, MAX_NAMES).join(", ")}${names.length > MAX_NAMES ? ", ..." : ""}`;
}

// Shared folders (utils, services, components, models) come first, so a tight budget keeps them.
export function buildMap(root, { maxChars = DEFAULT_CODEBASE_MAP.maxChars } = {}) {
  const budget = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_CODEBASE_MAP.maxChars;
  const folders = new Map();
  for (const file of listFiles(root).filter(isSource).slice(0, MAX_FILES)) {
    const folder = path.posix.dirname(file);
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(file);
  }
  const order = [...folders.keys()].sort((a, b) => SHARED.test(b) - SHARED.test(a) || a.localeCompare(b));
  const lines = [];
  let used = 0;
  let skipped = 0;
  for (const folder of order) {
    if (budget - used < MIN_LINE) {
      skipped++;
      continue;
    }
    const line = folderLine(root, folder, folders.get(folder));
    if (!line) continue;
    if (used + line.length > budget) {
      skipped++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return "";
  if (skipped) lines.push(`(${skipped} more folders not listed)`);
  return [MAP_HEADER, ...lines].join("\n");
}

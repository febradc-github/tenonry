#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { printResult, readJson, writeJsonAtomic } from "./lib/json.mjs";
import { pluginRoot } from "./lib/paths.mjs";
import { loadCatalog } from "./lib/catalog.mjs";
import { detectAll, manifestHash, applySupersession } from "./lib/detect.mjs";
import { starterById, starterChoices } from "./lib/starter.mjs";
import { detectPreview, verifyEntries } from "./lib/stack.mjs";
import { buildOwnership } from "./lib/ownership.mjs";
import { renderAgents, agentNames } from "./lib/agents.mjs";
import { hasMarker } from "./lib/render.mjs";
import { isGitRepo } from "./lib/git.mjs";
import { openRouterKey } from "./lib/env.mjs";
import {
  DEFAULT_ROUTING, DEFAULT_LIMITS, DEFAULT_READ_GUARD, DEFAULT_OUTPUT_FILTER, DEFAULT_CODEBASE_MAP, mergePreferExisting, dropRetiredRouting, configPath, isPlainObject,
} from "./lib/config.mjs";
import { isMain } from "./lib/main.mjs";

const GITIGNORE_LINES = [".env", ".tenonry/bin/", ".tenonry/state.json", ".tenonry/logs/", ".tenonry/runs/", ".claude/settings.local.json"];
// Tenonry's own bookkeeping script, and the design reviewer's browser (decision D-062 for the syntax).
export const PERMISSION_RULES = ["Bash(node .tenonry/bin/tenonry.mjs *)", "mcp__playwright"];
const INVALID_SETTINGS_WARNING = "settings.local.json is not valid JSON; add the Tenonry permission rules by hand";
const BIN_SCRIPTS = ["tenonry.mjs", "exec-filter.mjs", "hook-ownership-guard.mjs"];
const MIN_NODE_MAJOR = 18;

function pluginVersion(pluginDir) {
  return readJson(path.join(pluginDir, ".claude-plugin", "plugin.json"), { version: "0.0.0" }).version;
}

function agentsDirOf(root) {
  return path.join(root, ".claude", "agents");
}

const localSettingsPath = (root) => path.join(root, ".claude", "settings.local.json");

// Returns { settings, missing } for the local settings file, or { invalid: true } when it cannot be merged into.
function readLocalSettings(root) {
  const file = localSettingsPath(root);
  if (!fs.existsSync(file)) return { settings: {}, missing: [...PERMISSION_RULES] };
  const settings = readJson(file, null);
  const allow = settings?.permissions?.allow ?? [];
  const mergeable = isPlainObject(settings) && (settings.permissions === undefined || isPlainObject(settings.permissions)) && Array.isArray(allow);
  if (!mergeable) return { invalid: true };
  return { settings, missing: PERMISSION_RULES.filter((rule) => !allow.includes(rule)) };
}

// Appends the missing rules; every other key and entry keeps its place.
function ensurePermissionRules(root, { write }) {
  const state = readLocalSettings(root);
  if (state.invalid) return { added: false, warning: INVALID_SETTINGS_WARNING };
  if (state.missing.length === 0) return { added: false };
  if (write) {
    const settings = state.settings;
    settings.permissions = { ...settings.permissions, allow: [...(settings.permissions?.allow ?? []), ...state.missing] };
    fs.mkdirSync(path.dirname(localSettingsPath(root)), { recursive: true });
    fs.writeFileSync(localSettingsPath(root), JSON.stringify(settings, null, 2) + "\n");
  }
  return { added: true };
}

function withPermissions(summary, permissions) {
  summary.permissionsAdded = permissions.added;
  if (permissions.warning) summary.warnings.push(permissions.warning);
  return summary;
}

// `empty` means no builder exists yet, so the run skill must pick a starter (docs/03 section 5.6).
function starterFields(active, starter) {
  const empty = active.length === 0;
  return { empty, starter: starter?.id ?? null, ...(empty ? { starters: starterChoices() } : {}) };
}

function skippedResult(root) {
  const config = readJson(configPath(root), {});
  return {
    ok: true, skipped: true, agentsDirCreated: false, jevKey: Boolean(openRouterKey(root)),
    ...starterFields(config.activeSpecialists ?? [], config.starter),
  };
}

// True when nothing relevant changed since the last full init (docs/03 section 5.5).
function isUpToDate(root, version, hash) {
  const config = readJson(configPath(root), null);
  if (!config || config.manifestHash !== hash) return false;
  let installed = "";
  try {
    installed = fs.readFileSync(path.join(root, ".tenonry", "bin", "VERSION"), "utf8").trim();
  } catch {
    return false;
  }
  if (installed !== version) return false;
  // A settings file that cannot be merged into is reported by a full init, not retried on every run.
  if ((readLocalSettings(root).missing ?? []).length > 0) return false;
  return (config.agents ?? []).every((name) => fs.existsSync(path.join(agentsDirOf(root), `${name}.md`)));
}

function syncDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  const wanted = new Set();
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    wanted.add(entry.name);
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) syncDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
  for (const name of fs.readdirSync(target)) {
    if (!wanted.has(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
  }
}

function installBin(root, pluginDir, version) {
  const bin = path.join(root, ".tenonry", "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const name of BIN_SCRIPTS) fs.copyFileSync(path.join(pluginDir, "scripts", name), path.join(bin, name));
  syncDirectory(path.join(pluginDir, "scripts", "lib"), path.join(bin, "lib"));
  fs.mkdirSync(path.join(bin, "library"), { recursive: true });
  fs.copyFileSync(path.join(pluginDir, "library", "catalog.json"), path.join(bin, "library", "catalog.json"));
  fs.writeFileSync(path.join(bin, "VERSION"), `${version}\n`);
}

function installRubrics(root, pluginDir) {
  const target = path.join(root, ".tenonry", "rubrics");
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["design.md", "code.md"]) fs.copyFileSync(path.join(pluginDir, "library", "rubrics", name), path.join(target, name));
}

function writeAgents(root, rendered) {
  const dir = agentsDirOf(root);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  const warnings = [];
  for (const [name, text] of rendered) {
    const file = path.join(dir, `${name}.md`);
    if (fs.existsSync(file)) {
      const current = fs.readFileSync(file, "utf8");
      if (!hasMarker(current)) {
        warnings.push(`${name}.md exists without the generated marker and was left untouched`);
        continue;
      }
      if (current === text) continue;
    }
    fs.writeFileSync(file, text);
    written.push(name);
  }
  return { written, warnings };
}

function removeStaleAgents(root, keep) {
  const dir = agentsDirOf(root);
  if (!fs.existsSync(dir)) return [];
  const removed = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/^tenonry-.*\.md$/.test(file)) continue;
    const name = file.slice(0, -3);
    if (keep.has(name)) continue;
    const full = path.join(dir, file);
    if (!hasMarker(fs.readFileSync(full, "utf8"))) continue;
    fs.rmSync(full);
    removed.push(name);
  }
  return removed;
}

// A starter adds its stack's generated directories, so installing dependencies never floods git status.
function ensureGitignore(root, extraLines = []) {
  const file = path.join(root, ".gitignore");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = [...new Set([...GITIGNORE_LINES, ...extraLines])].filter((line) => !present.has(line));
  if (missing.length === 0) return;
  const lines = present.has("# tenonry") ? missing : ["# tenonry", ...missing];
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  // Lines added to a block Tenonry wrote last stay in that block, without a blank line before them.
  const last = current.trimEnd().split(/\r?\n/).at(-1)?.trim() ?? "";
  const continues = present.has("# tenonry") && (last === "# tenonry" || GITIGNORE_LINES.includes(last));
  fs.writeFileSync(file, `${current}${separator}${current === "" || continues ? "" : "\n"}${lines.join("\n")}\n`);
}

export function runInit({ root, dryRun = false, ifChanged = false, starter: starterId }) {
  if (Number(process.versions.node.split(".")[0]) < MIN_NODE_MAJOR) return { ok: false, error: "node_too_old", fatal: true };
  const pluginDir = pluginRoot();
  if (!pluginDir) return { ok: false, error: "plugin_library_not_found", fatal: true };
  const requested = starterId === undefined ? null : starterById(starterId);
  if (starterId !== undefined && !requested) return { ok: false, error: `unknown_starter: ${starterId}` };

  const version = pluginVersion(pluginDir);
  const hash = manifestHash(root, version);
  if (ifChanged && !requested && isUpToDate(root, version, hash)) return skippedResult(root);

  const gitRepo = isGitRepo(root);
  const catalog = loadCatalog(path.join(pluginDir, "library", "catalog.json"));
  const existing = readJson(configPath(root), {});
  const detected = detectAll(root, catalog);
  // A starter stands in for detection only while detection finds nothing; real files always win.
  const nothingDetected = detected.packages.every((pkg) => pkg.specialists.length === 0);
  const starter = nothingDetected ? (requested ?? starterById(existing.starter?.id)) : null;
  const packages = detected.packages.map(({ root: pkgRoot, packageManager, specialists, files }) => ({
    root: pkgRoot,
    packageManager,
    specialists: starter && pkgRoot === "." ? applySupersession(starter.specialists, catalog) : specialists,
    files,
  }));
  const verify = packages.flatMap((pkg) => verifyEntries(root, pkg));
  const preview = detectPreview(root, packages);
  const publicPackages = packages.map(({ root: pkgRoot, packageManager, specialists }) => ({ root: pkgRoot, packageManager, specialists }));
  const active = [...new Set(publicPackages.flatMap((pkg) => pkg.specialists))].sort();
  const agents = agentNames({ catalog, packages: publicPackages });
  const rendered = renderAgents({ libraryDir: path.join(pluginDir, "library"), catalog, packages: publicPackages, verify });

  const warnings = [...detected.warnings];
  if (requested && !starter) warnings.push(`the project already has a stack, so the starter ${requested.id} was not applied`);
  if (!gitRepo) warnings.push("not a git repository: /tenonry:run needs git for checkpoints and undo");

  const agentsDirCreated = !fs.existsSync(agentsDirOf(root));
  const summary = {
    ok: true, gitRepo, packages: publicPackages, active, agentsWritten: [...rendered.keys()], agentsRemoved: [],
    agentsDirCreated, verify, preview, jevKey: Boolean(openRouterKey(root)), warnings, skipped: false, manifestHash: hash,
    permissionsAdded: false, ...starterFields(active, starter),
  };
  if (dryRun) return { ...withPermissions(summary, ensurePermissionRules(root, { write: false })), dryRun: true };

  writeJsonAtomic(configPath(root), {
    version: 1,
    plugin: "tenonry",
    pluginVersion: version,
    initializedAt: new Date().toISOString(),
    packages: publicPackages,
    activeSpecialists: active,
    agents,
    verify,
    preview,
    routing: mergePreferExisting(DEFAULT_ROUTING, dropRetiredRouting(existing.routing)),
    limits: mergePreferExisting(DEFAULT_LIMITS, existing.limits),
    readGuard: mergePreferExisting(DEFAULT_READ_GUARD, existing.readGuard),
    outputFilter: mergePreferExisting(DEFAULT_OUTPUT_FILTER, existing.outputFilter),
    codebaseMap: mergePreferExisting(DEFAULT_CODEBASE_MAP, existing.codebaseMap),
    manifestHash: hash,
    ...(starter ? { starter: { id: starter.id, title: starter.title, setup: starter.setup } } : {}),
  });
  writeJsonAtomic(path.join(root, ".tenonry", "ownership.json"), buildOwnership(publicPackages, catalog));
  installBin(root, pluginDir, version);
  installRubrics(root, pluginDir);
  const { written, warnings: agentWarnings } = writeAgents(root, rendered);
  summary.agentsWritten = written;
  summary.agentsRemoved = removeStaleAgents(root, new Set(agents));
  summary.warnings.push(...agentWarnings);
  ensureGitignore(root, starter?.ignore ?? []);
  return withPermissions(summary, ensurePermissionRules(root, { write: true }));
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), ["dry-run", "if-changed"]);
  const root = path.resolve(flags.project || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    printResult({ ok: false, error: "project_not_found" });
    return 1;
  }
  const result = runInit({ root, dryRun: Boolean(flags["dry-run"]), ifChanged: Boolean(flags["if-changed"]), starter: flags.starter });
  printResult(result);
  return result.ok === false ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    printResult({ ok: false, error: String(error?.message ?? error) });
    process.exitCode = 1;
  }
}

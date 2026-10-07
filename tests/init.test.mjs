import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MARKER } from "../scripts/lib/render.mjs";
import { fixtureCopy, git, runInit } from "./helpers/project.mjs";
import { readJson } from "../scripts/lib/json.mjs";

const agentFile = (root, name) => path.join(root, ".claude", "agents", `${name}.md`);
const config = (root) => readJson(path.join(root, ".tenonry", "config.json"));

function frontmatter(text) {
  const lines = text.split("\n");
  assert.equal(lines[0], "---", "frontmatter must start on line 1");
  const end = lines.indexOf("---", 1);
  assert.ok(end > 0, "frontmatter must close");
  const body = lines.slice(1, end).join("\n");
  return { name: /^name: (.+)$/m.exec(body)?.[1], description: /^description: (.+)$/m.exec(body)?.[1], body };
}

test("init writes config, ownership, bin, rubrics, agents, and gitignore", () => {
  const root = fixtureCopy("laravel-vue");
  const result = runInit(root);
  assert.equal(result.status, 0);
  const out = result.json;
  assert.equal(out.ok, true);
  assert.equal(out.skipped, false);
  assert.equal(out.gitRepo, true);
  assert.equal(out.agentsDirCreated, true);
  assert.equal(out.jevKey, false);
  assert.deepEqual(out.agentsRemoved, []);
  for (const id of ["laravel", "eloquent", "php", "vue", "tailwind", "html", "nodejs"]) assert.ok(out.active.includes(id), id);
  assert.ok(!out.active.includes("css"));
  assert.match(out.manifestHash, /^[0-9a-f]{64}$/);

  const cfg = config(root);
  assert.equal(cfg.plugin, "tenonry");
  assert.equal(cfg.pluginVersion, "0.1.0");
  assert.deepEqual(cfg.activeSpecialists, [...cfg.activeSpecialists].sort());
  assert.deepEqual(cfg.verify.map(({ ecosystem, ...v }) => v), [
    { root: ".", test: "php artisan test", testFiles: "php artisan test {files}", typecheck: null, lint: "./vendor/bin/pint --test" },
  ]);
  assert.equal(cfg.preview.command, "composer run dev");
  assert.equal(cfg.routing.jevModel, "typesafe/jev-1.13");
  assert.deepEqual(cfg.limits, { maxParallel: 3, maxTestRetriesPerTier: 2, maxDesignRounds: 3, maxCodeReviewRounds: 2, maxContractFixes: 2 });

  assert.ok(fs.existsSync(path.join(root, ".tenonry", "ownership.json")));
  for (const file of ["tenonry.mjs", "exec-filter.mjs", "hook-ownership-guard.mjs", "VERSION", "lib/glob.mjs", "library/catalog.json"]) {
    assert.ok(fs.existsSync(path.join(root, ".tenonry", "bin", file)), file);
  }
  assert.equal(fs.readFileSync(path.join(root, ".tenonry", "bin", "VERSION"), "utf8"), "0.1.0\n");
  for (const file of ["design.md", "code.md"]) assert.ok(fs.existsSync(path.join(root, ".tenonry", "rubrics", file)));

  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  for (const line of [".env", ".tenonry/bin/", ".tenonry/state.json", ".tenonry/logs/", ".tenonry/runs/"]) assert.ok(gitignore.split("\n").includes(line), line);
});

test("rendered agents are well formed", () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const names = config(root).agents;
  assert.ok(names.includes("tenonry-design-reviewer"));
  assert.equal(names.length, 4 + 2 * config(root).activeSpecialists.length);
  for (const name of names) {
    const text = fs.readFileSync(agentFile(root, name), "utf8");
    const fm = frontmatter(text);
    assert.equal(fm.name, name);
    assert.ok(fm.description);
    assert.ok(!text.includes("{{"), `${name} still has a placeholder`);
    assert.equal(text.trimEnd().split("\n").at(-1), MARKER);
    assert.ok(fm.body.includes(`hook-ownership-guard.mjs" ${name}'`), `${name} guard names its own agent`);
    assert.ok(text.split(MARKER).length === 2);
  }
  const vue = fs.readFileSync(agentFile(root, "tenonry-vue"), "utf8");
  assert.match(vue, /^model: sonnet$/m);
  assert.match(vue, /## UI rules/);
  assert.match(vue, /- \*\*\/\*\.vue/);
  assert.match(vue, /S1\. /);
  const eloquent = fs.readFileSync(agentFile(root, "tenonry-eloquent"), "utf8");
  assert.doesNotMatch(eloquent, /## UI rules/);
  assert.doesNotMatch(eloquent, /\n\n\n/);
  assert.match(eloquent, /^- task tests: php artisan test \{files\}$/m);
  assert.doesNotMatch(eloquent, /^- test: /m);
  assert.match(fs.readFileSync(agentFile(root, "tenonry-review-vue"), "utf8"), /^model: sonnet$/m);
});

test("the design reviewer exists only when a frontend or 3d specialist is active", () => {
  const backend = fixtureCopy("go-api");
  runInit(backend);
  assert.ok(!fs.existsSync(agentFile(backend, "tenonry-design-reviewer")));
  assert.ok(!config(backend).agents.includes("tenonry-design-reviewer"));
  assert.ok(fs.existsSync(agentFile(backend, "tenonry-planner")));

  const three = fixtureCopy("three-landing");
  runInit(three);
  assert.ok(fs.existsSync(agentFile(three, "tenonry-design-reviewer")));
  assert.ok(fs.existsSync(agentFile(three, "tenonry-3d")));
});

test("agents without frontend layers render an empty verify note when no commands exist", () => {
  const root = fixtureCopy("three-landing");
  runInit(root);
  assert.match(fs.readFileSync(agentFile(root, "tenonry-3d"), "utf8"), /- No verification commands are configured for your files\./);
});

test("--if-changed skips a second run and writes nothing", () => {
  const root = fixtureCopy("next-prisma");
  const first = runInit(root, "--if-changed");
  assert.equal(first.json.skipped, false);
  const configBefore = fs.readFileSync(path.join(root, ".tenonry", "config.json"), "utf8");
  const mtime = fs.statSync(path.join(root, ".tenonry", "config.json")).mtimeMs;
  const second = runInit(root, "--if-changed");
  assert.deepEqual(second.json, { ok: true, skipped: true, agentsDirCreated: false, jevKey: false });
  assert.equal(fs.readFileSync(path.join(root, ".tenonry", "config.json"), "utf8"), configBefore);
  assert.equal(fs.statSync(path.join(root, ".tenonry", "config.json")).mtimeMs, mtime);
});

test("--if-changed reruns when a manifest, the plugin version, or an agent file changes", () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root, "--if-changed");

  fs.appendFileSync(path.join(root, "package.json"), "\n");
  assert.equal(runInit(root, "--if-changed").json.skipped, false);
  assert.equal(runInit(root, "--if-changed").json.skipped, true);

  fs.appendFileSync(path.join(root, "composer.json"), "\n");
  assert.equal(runInit(root, "--if-changed").json.skipped, false);
  assert.equal(runInit(root, "--if-changed").json.skipped, true);

  fs.writeFileSync(path.join(root, ".tenonry", "bin", "VERSION"), "0.0.1\n");
  assert.equal(runInit(root, "--if-changed").json.skipped, false);
  assert.equal(runInit(root, "--if-changed").json.skipped, true);

  fs.rmSync(agentFile(root, "tenonry-vue"));
  const repaired = runInit(root, "--if-changed").json;
  assert.equal(repaired.skipped, false);
  assert.ok(repaired.agentsWritten.includes("tenonry-vue"));
});

test("the skip result reports jevKey", () => {
  const root = fixtureCopy("go-api");
  fs.writeFileSync(path.join(root, ".env"), "OPENROUTER_API_KEY=sk-or-test\n");
  runInit(root, "--if-changed");
  const second = runInit(root, "--if-changed").json;
  assert.equal(second.skipped, true);
  assert.equal(second.jevKey, true);
  assert.ok(!JSON.stringify(second).includes("sk-or-test"));
});

test("agentsDirCreated is true only when .claude/agents did not exist before", () => {
  const fresh = fixtureCopy("go-api");
  assert.equal(runInit(fresh).json.agentsDirCreated, true);
  assert.equal(runInit(fresh).json.agentsDirCreated, false);

  const existing = fixtureCopy("go-api");
  fs.mkdirSync(path.join(existing, ".claude", "agents"), { recursive: true });
  assert.equal(runInit(existing).json.agentsDirCreated, false);
});

test("re-init preserves edited routing, limits, readGuard, and outputFilter", () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const cfg = config(root);
  cfg.routing.thresholds.haiku.maxDifficulty = 0.25;
  cfg.limits.maxParallel = 5;
  cfg.readGuard.extraDeny = ["secrets/**"];
  cfg.outputFilter.maxLines = 60;
  fs.writeFileSync(path.join(root, ".tenonry", "config.json"), JSON.stringify(cfg, null, 2));
  runInit(root);
  const after = config(root);
  assert.equal(after.routing.thresholds.haiku.maxDifficulty, 0.25);
  assert.equal(after.limits.maxParallel, 5);
  assert.deepEqual(after.readGuard.extraDeny, ["secrets/**"]);
  assert.equal(after.outputFilter.maxLines, 60);
  assert.equal(after.routing.thresholds.opus.minDifficulty, 2.0);
});

test("re-init removes a stale generated agent and never touches files without the marker", () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const dir = path.join(root, ".claude", "agents");
  fs.writeFileSync(path.join(dir, "tenonry-stale.md"), `---\nname: tenonry-stale\ndescription: x\n---\nold\n${MARKER}\n`);
  fs.writeFileSync(path.join(dir, "tenonry-handmade.md"), "---\nname: tenonry-handmade\ndescription: mine\n---\nno marker\n");
  fs.writeFileSync(path.join(dir, "mine.md"), "---\nname: mine\ndescription: mine\n---\n");
  const result = runInit(root).json;
  assert.deepEqual(result.agentsRemoved, ["tenonry-stale"]);
  assert.ok(!fs.existsSync(path.join(dir, "tenonry-stale.md")));
  assert.ok(fs.existsSync(path.join(dir, "tenonry-handmade.md")));
  assert.ok(fs.existsSync(path.join(dir, "mine.md")));
});

test("an agent file without the marker is not overwritten", () => {
  const root = fixtureCopy("go-api");
  const dir = path.join(root, ".claude", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tenonry-go.md"), "---\nname: tenonry-go\ndescription: custom\n---\ncustom\n");
  const result = runInit(root).json;
  assert.equal(fs.readFileSync(path.join(dir, "tenonry-go.md"), "utf8").includes("custom\n"), true);
  assert.ok(result.warnings.some((w) => w.includes("tenonry-go.md")));
});

test("a generated agent that was edited is overwritten", () => {
  const root = fixtureCopy("go-api");
  runInit(root);
  const file = agentFile(root, "tenonry-go");
  fs.appendFileSync(file, "\nlocal edit\n");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(`${MARKER}\n\nlocal edit`, `local edit\n${MARKER}`));
  assert.ok(runInit(root).json.agentsWritten.includes("tenonry-go"));
  assert.ok(!fs.readFileSync(file, "utf8").includes("local edit"));
});

test("gitignore lines are not duplicated and existing content is kept", () => {
  const root = fixtureCopy("go-api");
  fs.writeFileSync(path.join(root, ".gitignore"), "bin/\n.env");
  runInit(root);
  runInit(root);
  runInit(root);
  const lines = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n");
  assert.equal(lines.filter((l) => l === ".env").length, 1);
  assert.equal(lines.filter((l) => l === "# tenonry").length, 1);
  assert.equal(lines.filter((l) => l === ".tenonry/runs/").length, 1);
  assert.ok(lines.includes("bin/"));
});

test("--dry-run writes nothing", () => {
  const root = fixtureCopy("laravel-vue");
  const before = git(root, "status", "--porcelain");
  const result = runInit(root, "--dry-run");
  assert.equal(result.json.ok, true);
  assert.equal(result.json.dryRun, true);
  assert.ok(result.json.agentsWritten.includes("tenonry-laravel"));
  assert.ok(!fs.existsSync(path.join(root, ".tenonry")));
  assert.ok(!fs.existsSync(path.join(root, ".claude")));
  assert.equal(git(root, "status", "--porcelain"), before);
});

test("a directory that is not a git repository only warns", () => {
  const root = fixtureCopy("go-api", { git: false });
  const result = runInit(root);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.gitRepo, false);
  assert.ok(result.json.warnings.some((w) => w.includes("git")));
});

test("a missing project directory is an error", () => {
  const result = runInit(path.join(fixtureCopy("go-api"), "nope"));
  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
});

test("init output never contains the API key", () => {
  const root = fixtureCopy("go-api");
  fs.writeFileSync(path.join(root, ".env"), "OPENROUTER_API_KEY=sk-or-secret-value\n");
  const result = runInit(root);
  assert.equal(result.json.jevKey, true);
  assert.ok(!result.stdout.includes("sk-or-secret-value"));
  assert.ok(!result.stderr.includes("sk-or-secret-value"));
});

test("monorepo init prefixes globs and detects per-package verify commands", () => {
  const root = fixtureCopy("monorepo");
  const out = runInit(root).json;
  assert.deepEqual(out.packages.map((p) => p.root), [".", "apps/api", "apps/web"]);
  assert.deepEqual(out.verify.map((v) => v.root), ["apps/api"]);
  const rules = readJson(path.join(root, ".tenonry", "ownership.json")).rules;
  assert.ok(rules.some((r) => r.glob === "apps/web/app/**" && r.owner === "tenonry-nextjs"));
  assert.ok(rules.some((r) => r.glob === "apps/api/src/**/*.ts" && r.owner === "tenonry-nestjs"));
  const nextAgent = fs.readFileSync(agentFile(root, "tenonry-nextjs"), "utf8");
  assert.match(nextAgent, /- apps\/web\/app\/\*\*/);
});

test("rendered agents pass `claude plugin validate` when the CLI is available", { skip: spawnSync("claude", ["--version"]).status !== 0 && "claude CLI not available" }, () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const result = spawnSync("claude", ["plugin", "validate", ".claude/agents"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

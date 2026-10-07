import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixtureCopy, runInit, git } from "./helpers/project.mjs";
import { setupScenario } from "./helpers/scenario.mjs";
import { runNode } from "./helpers/run.mjs";
import { repoRoot } from "./helpers/docs.mjs";

const RULES = ["Bash(node .tenonry/bin/tenonry.mjs *)", "mcp__playwright"];
const settingsFile = (root) => path.join(root, ".claude", "settings.local.json");
const readSettings = (root) => JSON.parse(fs.readFileSync(settingsFile(root), "utf8"));
const TRICKY = 'add a page with "double" and \'single\' quotes,\n$HOME and ${braces}, `backticks`, a \\ backslash;\nand a last line && more | pipe';

function cliWithInput(s, input, ...args) {
  return runNode(path.join(s.root, ".tenonry", "bin", "tenonry.mjs"), args, { cwd: s.root, input, env: { TENONRY_JEV_DISABLE: "1" } });
}

test("F5: new-run --prompt-stdin keeps a multi-line request byte for byte", () => {
  const s = setupScenario({ contract: false });
  const result = cliWithInput(s, TRICKY + "\n", "new-run", "--prompt-stdin");
  assert.equal(result.status, 0);
  const { runId } = result.json;
  const dir = path.join(s.root, ".tenonry", "runs", runId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")).prompt, TRICKY);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "route.json"), "utf8")).prompt, TRICKY);
});

test("F5: new-run --prompt-stdin strips exactly one trailing newline", () => {
  const s = setupScenario({ contract: false });
  const { runId } = cliWithInput(s, "request\n\n", "new-run", "--prompt-stdin").json;
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry", "runs", runId, "run.json"), "utf8")).prompt, "request\n");
});

test("F5: new-run --prompt-stdin through a real quoted heredoc", () => {
  const s = setupScenario({ contract: false });
  const script = `node .tenonry/bin/tenonry.mjs new-run --prompt-stdin <<'TENONRY_REQUEST'\n${TRICKY}\nTENONRY_REQUEST\n`;
  const out = JSON.parse(spawnShell(s.root, script));
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, ".tenonry", "runs", out.runId, "run.json"), "utf8")).prompt, TRICKY);
});

function spawnShell(cwd, script) {
  return execFileSync("/bin/sh", ["-c", script], { cwd, encoding: "utf8", env: { ...process.env, TENONRY_JEV_DISABLE: "1" } });
}

test("F5: empty standard input is an error for new-run", () => {
  const s = setupScenario({ contract: false });
  for (const input of ["", "\n", "   \n"]) {
    const result = cliWithInput(s, input, "new-run", "--prompt-stdin");
    assert.equal(result.status, 1);
    assert.deepEqual(result.json, { ok: false, error: "empty_prompt" });
  }
});

test("F5: --prompt and --prompt-file keep working", () => {
  const s = setupScenario({ contract: false });
  assert.ok(s.cli("new-run", "--prompt", "plain").runId);
  const file = path.join(s.root, ".tenonry", "req.txt");
  fs.writeFileSync(file, "from a file\n");
  assert.ok(s.cli("new-run", "--prompt-file", file).runId);
});

test("F5: write-brief writes the request under a heading", () => {
  const s = setupScenario({ contract: false });
  const { runId } = cliWithInput(s, TRICKY + "\n", "new-run", "--prompt-stdin").json;
  const result = cliWithInput(s, "", "write-brief", runId);
  assert.deepEqual(result.json, { ok: true, path: `.tenonry/runs/${runId}/brief.md` });
  assert.equal(fs.readFileSync(path.join(s.root, result.json.path), "utf8"), `# Request\n\n${TRICKY}\n`);
});

test("F5: write-brief prefers the prompt in route.json and falls back to run.json", () => {
  const s = setupScenario({ contract: false });
  const routeFile = path.join(s.runDir, "route.json");
  const route = JSON.parse(fs.readFileSync(routeFile, "utf8"));
  route.prompt = "from the route";
  fs.writeFileSync(routeFile, JSON.stringify(route));
  s.cli("write-brief", s.runId);
  assert.equal(fs.readFileSync(path.join(s.runDir, "brief.md"), "utf8"), "# Request\n\nfrom the route\n");
  fs.rmSync(routeFile);
  s.cli("write-brief", s.runId);
  assert.equal(fs.readFileSync(path.join(s.runDir, "brief.md"), "utf8"), "# Request\n\nadd loyalty points\n");
});

test("F5: write-brief --stdin stores the clarified brief as given with one trailing newline", () => {
  const s = setupScenario({ contract: false });
  const brief = `# Request\n${TRICKY}\n\n# Clarified requirements\n- Uses "tiers" at $5 steps\n\n# Assumptions\n- \`bronze\` is the default`;
  for (const input of [brief, `${brief}\n`, `${brief}\n\n\n`]) {
    const result = cliWithInput(s, input, "write-brief", s.runId, "--stdin");
    assert.deepEqual(result.json, { ok: true, path: `.tenonry/runs/${s.runId}/brief.md` });
    assert.equal(fs.readFileSync(path.join(s.runDir, "brief.md"), "utf8"), `${brief}\n`);
  }
});

test("F5: write-brief errors on empty input, an unknown run, and a missing run", () => {
  const s = setupScenario({ contract: false });
  const empty = cliWithInput(s, " \n", "write-brief", s.runId, "--stdin");
  assert.equal(empty.status, 1);
  assert.deepEqual(empty.json, { ok: false, error: "empty_brief" });
  assert.ok(!fs.existsSync(path.join(s.runDir, "brief.md")));
  assert.equal(cliWithInput(s, "", "write-brief", "r-nope").status, 1);
  assert.equal(cliWithInput(s, "", "write-brief").status, 1);
});

test("F5: init creates settings.local.json with both rules and gitignores it", () => {
  const root = fixtureCopy("laravel-vue");
  const out = runInit(root).json;
  assert.equal(out.permissionsAdded, true);
  assert.deepEqual(readSettings(root), { permissions: { allow: RULES } });
  assert.ok(fs.readFileSync(settingsFile(root), "utf8").endsWith("\n}\n"));
  assert.ok(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n").includes(".claude/settings.local.json"));
  assert.ok(!git(root, "status", "--porcelain", "-uall").includes("settings.local.json"), "the file is ignored, so its rules need no trust step");
  assert.equal(runInit(root).json.permissionsAdded, false);
});

test("F5: init merges into an existing file and keeps unrelated keys and entries in order", () => {
  const root = fixtureCopy("laravel-vue");
  fs.mkdirSync(path.join(root, ".claude"));
  const existing = {
    env: { FOO: "bar" },
    permissions: { deny: ["Read(./secrets/**)"], allow: ["Bash(npm run lint)", "mcp__playwright", "Bash(git log *)"], defaultMode: "acceptEdits" },
    hooks: {},
  };
  fs.writeFileSync(settingsFile(root), JSON.stringify(existing));
  assert.equal(runInit(root).json.permissionsAdded, true);
  const merged = readSettings(root);
  assert.deepEqual(Object.keys(merged), ["env", "permissions", "hooks"]);
  assert.deepEqual(Object.keys(merged.permissions), ["deny", "allow", "defaultMode"]);
  assert.deepEqual(merged.permissions.allow, ["Bash(npm run lint)", "mcp__playwright", "Bash(git log *)", "Bash(node .tenonry/bin/tenonry.mjs *)"]);
  assert.deepEqual(merged.permissions.deny, ["Read(./secrets/**)"]);
  assert.deepEqual(merged.env, { FOO: "bar" });
});

test("F5: init adds the permissions key to a settings file that has none", () => {
  const root = fixtureCopy("go-api");
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(settingsFile(root), '{"outputStyle":"plain"}');
  runInit(root);
  assert.deepEqual(readSettings(root), { outputStyle: "plain", permissions: { allow: RULES } });
});

test("F5: init leaves invalid JSON untouched and warns", () => {
  for (const text of ["{ not json", '["an array"]', '{"permissions":{"allow":"Bash(x)"}}']) {
    const root = fixtureCopy("go-api");
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(settingsFile(root), text);
    const out = runInit(root).json;
    assert.equal(out.ok, true);
    assert.equal(out.permissionsAdded, false);
    assert.ok(out.warnings.includes("settings.local.json is not valid JSON; add the Tenonry permission rules by hand"), text);
    assert.equal(fs.readFileSync(settingsFile(root), "utf8"), text);
    assert.equal(runInit(root, "--if-changed").json.skipped, true, "an unmergeable file does not force a full init on every run");
  }
});

test("F5: --if-changed reruns when a permission rule is missing", () => {
  const root = fixtureCopy("go-api");
  runInit(root, "--if-changed");
  assert.equal(runInit(root, "--if-changed").json.skipped, true);

  const settings = readSettings(root);
  settings.permissions.allow = settings.permissions.allow.filter((rule) => rule !== "mcp__playwright");
  fs.writeFileSync(settingsFile(root), JSON.stringify(settings));
  const rerun = runInit(root, "--if-changed").json;
  assert.equal(rerun.skipped, false);
  assert.equal(rerun.permissionsAdded, true);
  assert.deepEqual(readSettings(root).permissions.allow, RULES);
  assert.equal(runInit(root, "--if-changed").json.skipped, true);

  fs.rmSync(settingsFile(root));
  assert.equal(runInit(root, "--if-changed").json.skipped, false);
  assert.deepEqual(readSettings(root).permissions.allow, RULES);
});

test("F5: --dry-run reports permissionsAdded without writing", () => {
  const root = fixtureCopy("go-api");
  const out = runInit(root, "--dry-run").json;
  assert.equal(out.permissionsAdded, true);
  assert.ok(!fs.existsSync(path.join(root, ".claude")));
});

test("F5: no shipped skill text contains $PWD or --prompt-file", () => {
  for (const name of ["init", "run", "clarify-intake"]) {
    const text = fs.readFileSync(path.join(repoRoot, "skills", name, "SKILL.md"), "utf8");
    assert.ok(!text.includes("$PWD"), `${name} has $PWD`);
    assert.ok(!text.includes("--prompt-file"), `${name} has --prompt-file`);
  }
});

test("F5: the skills declare the tools they may use without asking", () => {
  const field = (name, key) => new RegExp(`^${key}: (.*)$`, "m").exec(fs.readFileSync(path.join(repoRoot, "skills", name, "SKILL.md"), "utf8").split("\n---")[0])?.[1];
  assert.equal(field("run", "allowed-tools"), "Bash(node *), Bash(git rev-parse *)");
  assert.equal(field("clarify-intake", "allowed-tools"), "Bash(node *)");
  assert.equal(field("init", "allowed-tools"), "Bash(node *), Read");
});

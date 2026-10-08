import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STARTERS, starterById } from "../scripts/lib/starter.mjs";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { detectPackage, applySupersession } from "../scripts/lib/detect.mjs";
import { currentStack } from "../scripts/lib/stack.mjs";
import { selectVerifyEntry } from "../scripts/lib/verify.mjs";
import { tempDir, gitInit, git, runInit, fixtureCopy } from "./helpers/project.mjs";
import { runNode } from "./helpers/run.mjs";
import { readJson } from "../scripts/lib/json.mjs";

const catalog = loadCatalog();
const config = (root) => readJson(path.join(root, ".tenonry", "config.json"));

function emptyRepo() {
  const root = tempDir("tenonry-empty-");
  fs.writeFileSync(path.join(root, "README.md"), "# Weather\n");
  gitInit(root);
  return root;
}

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

// A minimal skeleton per starter, as its setup task would write it.
const SKELETONS = {
  "react-vite": { deps: ["react", "react-dom", "typescript", "vite", "vitest"], files: ["index.html", "src/index.css"] },
  "vue-vite": { deps: ["vue", "typescript", "vite", "vitest"], files: ["index.html", "src/style.css"] },
  sveltekit: { deps: ["svelte", "@sveltejs/kit", "typescript", "vite", "vitest"], files: ["src/app.html", "src/app.css"] },
  nextjs: { deps: ["next", "react", "react-dom", "typescript", "vitest"], files: ["app/globals.css"] },
  "node-api": { deps: ["express", "typescript", "vitest"], files: ["src/app.ts"] },
};

test("0.6.0: every starter names catalog specialists and has the fields the run skill shows", () => {
  const ids = new Set(catalog.map((spec) => spec.id));
  assert.equal(new Set(STARTERS.map((s) => s.id)).size, STARTERS.length);
  for (const starter of STARTERS) {
    for (const field of ["id", "title", "fits", "setup"]) assert.ok(typeof starter[field] === "string" && starter[field].length > 0, `${starter.id}.${field}`);
    for (const id of starter.specialists) assert.ok(ids.has(id), `${starter.id}: ${id}`);
    assert.deepEqual(applySupersession(starter.specialists, catalog).sort(), [...starter.specialists].sort(), `${starter.id}: nothing superseded`);
    assert.ok(starter.ignore.includes("node_modules/"), starter.id);
    const emDash = String.fromCharCode(0x2014);
    assert.ok(!starter.setup.includes(emDash) && !starter.fits.includes(emDash));
  }
  assert.equal(STARTERS[0].id, "react-vite");
  assert.equal(starterById("nope"), null);
});

test("0.6.0: once its files exist, detection finds every specialist the starter chose", () => {
  for (const starter of STARTERS) {
    const skeleton = SKELETONS[starter.id];
    assert.ok(skeleton, `a skeleton for ${starter.id}`);
    const root = tempDir();
    const deps = Object.fromEntries(skeleton.deps.map((name) => [name, "*"]));
    write(root, { "package.json": JSON.stringify({ name: "app", dependencies: deps }), ...Object.fromEntries(skeleton.files.map((f) => [f, "x\n"])) });
    const found = detectPackage(root, ".", catalog).specialists;
    for (const id of starter.specialists) assert.ok(found.includes(id), `${starter.id}: ${id} detected again (found ${found.join(", ")})`);
  }
});

test("0.6.0: init in an empty project reports it empty and lists the starters", () => {
  const root = emptyRepo();
  const result = runInit(root).json;
  assert.equal(result.ok, true);
  assert.equal(result.empty, true);
  assert.equal(result.starter, null);
  assert.deepEqual(result.active, []);
  assert.deepEqual(result.starters, STARTERS.map(({ id, title, fits }) => ({ id, title, fits })));
  assert.equal(config(root).starter, undefined);
  const skipped = runInit(root, "--if-changed").json;
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.empty, true, "a skipped init still asks for a starter");
  assert.equal(skipped.starters.length, STARTERS.length);
});

test("0.6.0: --starter renders the starter's builders, records it, and ignores its generated directories", () => {
  const root = emptyRepo();
  const first = runInit(root).json;
  assert.equal(first.agentsDirCreated, true);
  const result = runInit(root, "--starter", "react-vite").json;
  assert.equal(result.ok, true);
  assert.equal(result.empty, false);
  assert.equal(result.starter, "react-vite");
  assert.equal(result.starters, undefined);
  assert.deepEqual(result.active, ["css", "html", "nodejs", "react", "typescript"]);
  const cfg = config(root);
  assert.deepEqual(cfg.starter, { id: "react-vite", title: starterById("react-vite").title, setup: starterById("react-vite").setup });
  assert.deepEqual(cfg.packages, [{ root: ".", packageManager: null, specialists: ["react", "typescript", "css", "html", "nodejs"].filter((id) => cfg.activeSpecialists.includes(id)).sort((a, b) => catalog.findIndex((s) => s.id === a) - catalog.findIndex((s) => s.id === b)) }]);
  for (const name of ["tenonry-react", "tenonry-review-react", "tenonry-nodejs", "tenonry-css", "tenonry-html", "tenonry-typescript", "tenonry-design-reviewer"]) {
    assert.ok(fs.existsSync(path.join(root, ".claude", "agents", `${name}.md`)), name);
  }
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n");
  for (const line of ["node_modules/", "dist/", ".tenonry/runs/"]) assert.ok(gitignore.includes(line), line);
  const rules = readJson(path.join(root, ".tenonry", "ownership.json")).rules;
  assert.ok(rules.some((r) => r.glob === "**/*.tsx" && r.owner === "tenonry-react"));

  const again = runInit(root, "--if-changed").json;
  assert.equal(again.skipped, true);
  assert.equal(again.empty, false);
  assert.equal(again.starter, "react-vite");
});

test("0.6.0: real files replace the starter on the next init", () => {
  const root = emptyRepo();
  runInit(root, "--starter", "react-vite");
  write(root, {
    "package.json": JSON.stringify({ name: "weather", scripts: { dev: "vite", test: "vitest run" }, dependencies: { react: "^19" }, devDependencies: { vite: "^7", vitest: "^3" } }),
    "index.html": "<div id=root></div>\n",
  });
  const result = runInit(root, "--if-changed").json;
  assert.equal(result.skipped, false);
  assert.equal(result.starter, null);
  assert.equal(result.empty, false);
  assert.deepEqual(result.active, ["html", "nodejs", "react"]);
  assert.equal(config(root).starter, undefined);
  assert.equal(config(root).verify[0].testFiles, "npx vitest run {files}");
});

test("0.6.0: an unknown starter fails, and a project that already has code ignores a starter", () => {
  const root = emptyRepo();
  const unknown = runInit(root, "--starter", "cobol-mainframe");
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.error, "unknown_starter: cobol-mainframe");

  const existing = fixtureCopy("laravel-vue");
  const before = runInit(existing).json.active;
  const result = runInit(existing, "--starter", "react-vite").json;
  assert.equal(result.starter, null);
  assert.deepEqual(result.active, before);
  assert.ok(result.warnings.includes("the project already has a stack, so the starter react-vite was not applied"));
  assert.equal(config(existing).starter, undefined);
});

test("0.6.0: on a starter, verify commands and the preview come from the files a task wrote", () => {
  const root = tempDir();
  const stored = { starter: { id: "react-vite" }, verify: [], preview: null };
  assert.deepEqual(currentStack(root, stored).verify, [], "nothing written yet");
  write(root, { "package.json": JSON.stringify({ scripts: { dev: "vite", test: "vitest run" }, devDependencies: { vite: "^7", vitest: "^3" } }) });
  const live = currentStack(root, stored);
  assert.deepEqual(live.verify, [{ root: ".", ecosystem: "js", test: "npm test", testFiles: "npx vitest run {files}", typecheck: null, lint: null }]);
  assert.deepEqual(live.preview, { command: "npm run dev", url: "http://localhost:5173", cwd: "." });
  const def = { id: "T2", files: ["src/App.tsx"], tests: ["src/App.test.tsx"] };
  assert.equal(selectVerifyEntry(live, def).testFiles, "npx vitest run {files}");

  const withoutStarter = { verify: [], preview: null };
  assert.equal(currentStack(root, withoutStarter), withoutStarter, "projects not on a starter keep what init stored");
  const complete = { starter: { id: "react-vite" }, verify: [{ root: ".", test: "x" }], preview: { command: "y", url: "z", cwd: "." } };
  assert.equal(currentStack(root, complete), complete);
});

test("0.6.0: the setup task of a starter project installs, keeps its lockfile, and commits", () => {
  const root = emptyRepo();
  runInit(root);
  runInit(root, "--starter", "react-vite");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "tenonry setup");
  const env = { TENONRY_JEV_DISABLE: "1" };
  const cli = (...args) => runNode(path.join(root, ".tenonry", "bin", "tenonry.mjs"), args, { cwd: root, env }).json;
  const { runId } = cli("new-run", "--prompt", "build a weather dashboard");
  fs.writeFileSync(
    path.join(root, ".tenonry", "runs", runId, "contract.json"),
    JSON.stringify({
      version: 1, runId, title: "Weather", summary: "", interfaces: [], notes: "",
      tasks: [{ id: "T1", title: "Set up Vite", owner: "tenonry-nodejs", summary: "Manifest, Vite config, install.", files: ["package.json", "vite.config.ts"], dependsOn: [], acceptance: [], tests: [], ui: false, newScreen: false, interfaces: [] }],
    }),
  );
  assert.equal(cli("contract-check", runId).valid, true);
  assert.equal(cli("next", runId).ready[0].task, "T1");
  write(root, {
    "package.json": JSON.stringify({ name: "weather", scripts: { dev: "vite" }, devDependencies: { vite: "^7" } }),
    "vite.config.ts": "export default {};\n",
    "package-lock.json": "{}\n",
    "node_modules/vite/index.js": "x\n",
  });
  const check = cli("ownership-check", runId, "T1");
  assert.deepEqual(check, { ok: true, files: ["package-lock.json", "package.json", "vite.config.ts"], violations: [] });
  assert.equal(cli("verify", runId, "T1").result, "pass");
  assert.ok(cli("checkpoint", runId, "T1").sha);
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["package-lock.json", "package.json", "vite.config.ts"]);
  assert.equal(git(root, "status", "--porcelain", "--", "node_modules"), "", "node_modules is ignored");
});

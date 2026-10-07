import fs from "node:fs";
import path from "node:path";
import { runNode } from "./run.mjs";
import { fixtureCopy, runInit, git } from "./project.mjs";
import { writeFixture } from "./jev.mjs";
import { readJson, writeJsonAtomic } from "../../scripts/lib/json.mjs";

export const FLAG = ".tenonry/logs/flag-pass";
const FAKE_TEST = `sh -c 'echo "FAIL: spec not met"; test -e ${FLAG}'`;

export const defaultVerify = () => [
  { root: ".", ecosystem: "php", test: FAKE_TEST, testFiles: `${FAKE_TEST} sh {files}`, typecheck: null, lint: null },
];

export function contractFor(runId, overrides = {}) {
  return {
    version: 1,
    runId,
    title: "Loyalty points",
    summary: "Customers earn points.",
    interfaces: [
      {
        name: "GET /api/loyalty/balance",
        kind: "http",
        definition: "Response 200: {points: integer}.",
        provider: "tenonry-laravel",
        consumers: ["tenonry-vue"],
      },
    ],
    tasks: [
      {
        id: "T1", title: "Points model", owner: "tenonry-eloquent", summary: "Model for points.",
        files: ["app/Models/LoyaltyPoint.php"], dependsOn: [], acceptance: ["A point row belongs to a user."],
        tests: ["tests/Unit/LoyaltyPointTest.php"], ui: false, newScreen: false, interfaces: [],
      },
      {
        id: "T2", title: "Points API", owner: "tenonry-laravel", summary: "Balance endpoint.",
        files: ["app/Http/Controllers/LoyaltyController.php"], dependsOn: ["T1"], acceptance: ["Balance is returned."],
        tests: ["tests/Feature/LoyaltyTest.php"], ui: false, newScreen: false, interfaces: ["GET /api/loyalty/balance"],
      },
      {
        id: "T3", title: "Loyalty page", owner: "tenonry-vue", summary: "Page.",
        files: ["resources/js/Pages/Loyalty.vue"], dependsOn: ["T2"], acceptance: ["Balance is shown."],
        tests: [], ui: true, newScreen: true, interfaces: ["GET /api/loyalty/balance"],
      },
    ],
    notes: "",
    ...overrides,
  };
}

// A laravel-vue project, initialized, with committed test files and fake verification commands.
export function setupScenario({ fixture = "laravel-vue", verify = defaultVerify(), config = {}, jev = {}, contract = true } = {}) {
  const root = fixtureCopy(fixture);
  runInit(root);
  for (const file of ["tests/Unit/LoyaltyPointTest.php", "tests/Feature/LoyaltyTest.php"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "<?php\n");
  }
  const configFile = path.join(root, ".tenonry", "config.json");
  const current = readJson(configFile);
  writeJsonAtomic(configFile, { ...current, verify, ...config });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "tenonry setup");

  const env = { TENONRY_JEV_FIXTURE: writeFixture(jev) };
  const cli = (...args) => {
    const result = runNode(path.join(root, ".tenonry", "bin", "tenonry.mjs"), args.map(String), { cwd: root, env: { ...env, ...(cli.env ?? {}) } });
    if (result.json === null) throw new Error(`no JSON from ${args.join(" ")}: ${result.stdout}${result.stderr}`);
    return result.json;
  };
  cli.raw = (...args) => runNode(path.join(root, ".tenonry", "bin", "tenonry.mjs"), args.map(String), { cwd: root, env: { ...env, ...(cli.env ?? {}) } });

  const { runId } = cli("new-run", "--prompt", "add loyalty points");
  const scenario = {
    root,
    runId,
    cli,
    env,
    runDir: path.join(root, ".tenonry", "runs", runId),
    write: (file, text = "x\n") => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    },
    flag: (on) => {
      const file = path.join(root, FLAG);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (on) fs.writeFileSync(file, "");
      else fs.rmSync(file, { force: true });
    },
    run: () => readJson(path.join(root, ".tenonry", "runs", runId, "run.json")),
    contract: () => readJson(path.join(root, ".tenonry", "runs", runId, "contract.json")),
    writeContract: (value) => writeJsonAtomic(path.join(root, ".tenonry", "runs", runId, "contract.json"), value),
    report: (taskId, value) => writeJsonAtomic(path.join(root, ".tenonry", "runs", runId, "reports", `${taskId}.json`), value),
    review: (taskId, kind, value) => writeJsonAtomic(path.join(root, ".tenonry", "runs", runId, "reviews", `${taskId}.${kind}.json`), value),
    setConfig: (patch) => writeJsonAtomic(configFile, { ...readJson(configFile), ...patch }),
    log: () => {
      try {
        return fs.readFileSync(path.join(root, ".tenonry", "logs", "jev-decisions.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
  if (contract) {
    scenario.writeContract(contractFor(runId));
    const checked = cli("contract-check", runId);
    if (!checked.valid) throw new Error(`scenario contract invalid: ${checked.errors.join("; ")}`);
  }
  return scenario;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { systemRules, testRules, loadRules, resolveOwner, ownerAllows, catalogRules, isBuilderAgent } from "../scripts/lib/ownership.mjs";
import { fixtureCopy, runInit } from "./helpers/project.mjs";

const catalog = loadCatalog();

function ownerIn(root, relPath, runId) {
  return resolveOwner(loadRules(root, runId), relPath)?.owner ?? "unowned";
}

test("laravel-vue ownership examples", () => {
  const root = fixtureCopy("laravel-vue");
  assert.equal(runInit(root).json.ok, true);
  const expected = {
    "app/Models/User.php": "tenonry-eloquent",
    "app/Http/Controllers/HomeController.php": "tenonry-laravel",
    "resources/views/welcome.blade.php": "tenonry-html",
    "resources/js/app.js": "tenonry-vue",
    "resources/css/app.css": "tenonry-tailwind",
    "tests/Feature/ExampleTest.php": "tenonry-test-author",
    ".env": "none",
    ".env.example": "*",
    "composer.lock": "none",
    "composer.json": "*",
  };
  for (const [file, owner] of Object.entries(expected)) assert.equal(ownerIn(root, file), owner, file);
});

test("next-prisma and monorepo ownership examples", () => {
  const next = fixtureCopy("next-prisma");
  runInit(next);
  assert.equal(ownerIn(next, "app/page.tsx"), "tenonry-nextjs");
  assert.equal(ownerIn(next, "prisma/schema.prisma"), "tenonry-prisma");

  const mono = fixtureCopy("monorepo");
  runInit(mono);
  assert.equal(ownerIn(mono, "apps/api/src/app.module.ts"), "tenonry-nestjs");
  assert.equal(ownerIn(mono, "apps/web/app/page.tsx"), "tenonry-nextjs");
  assert.equal(ownerIn(mono, "apps/api/prisma/schema.prisma"), "tenonry-prisma");
});

test("catalog globs are prefixed with the package root", () => {
  const rules = catalogRules([{ root: "apps/web", specialists: ["nextjs"] }], catalog);
  assert.ok(rules.some((r) => r.glob === "apps/web/app/**" && r.owner === "tenonry-nextjs" && r.source === "catalog:nextjs"));
  assert.ok(rules.every((r) => r.glob.startsWith("apps/web/")));
});

test("system rules protect state and secrets and share manifests", () => {
  const rules = [...systemRules(), ...testRules()];
  const owner = (p) => resolveOwner(rules, p)?.owner;
  assert.equal(owner(".env.local"), "none");
  assert.equal(owner("apps/api/.env"), "none");
  assert.equal(owner(".git/config"), "none");
  assert.equal(owner(".claude/agents/tenonry-vue.md"), "none");
  assert.equal(owner("node_modules/x/index.js"), "none");
  assert.equal(owner(".tenonry/ownership.json"), "none");
  assert.equal(owner(".tenonry/runs/r-1/run.json"), "none");
  assert.equal(owner(".tenonry/runs/r-1/plan.md"), "tenonry-planner");
  assert.equal(owner(".tenonry/design-direction.md"), "tenonry-art-director");
  assert.equal(owner(".tenonry/runs/r-1/contract.json"), "tenonry-test-author");
  assert.equal(owner(".tenonry/runs/r-1/reports/T1.json"), "*");
  assert.deepEqual(owner(".tenonry/runs/r-1/reviews/T1.code.json"), ["tenonry-design-reviewer", "tenonry-review-*"]);
  assert.equal(owner("web/package.json"), "*");
  assert.equal(owner("Api/Api.csproj"), "*");
  assert.equal(owner("pnpm-lock.yaml"), "none");
  assert.equal(owner("src/a.test.ts"), "tenonry-test-author");
  assert.equal(owner("phpunit.xml"), "tenonry-test-author");
  assert.equal(owner("src/unknown.xyz"), undefined);
});

test("resolveOwner prefers priority, then the longer glob, then the earlier rule", () => {
  const rules = [
    { glob: "a/**", owner: "low", priority: 10 },
    { glob: "a/b/**", owner: "longer", priority: 10 },
    { glob: "a/**/*", owner: "first-of-equal", priority: 10 },
    { glob: "**", owner: "high", priority: 20 },
  ];
  assert.equal(resolveOwner(rules, "a/b/c").owner, "high");
  assert.equal(resolveOwner(rules.slice(0, 3), "a/b/c").owner, "longer");
  const tied = [{ glob: "x/**", owner: "first", priority: 1 }, { glob: "x/**", owner: "second", priority: 1 }];
  assert.equal(resolveOwner(tied, "x/y").owner, "first");
  assert.equal(resolveOwner([], "x"), null);
});

test("ownerAllows handles names, wildcards, arrays, and none", () => {
  assert.equal(ownerAllows("tenonry-vue", "tenonry-vue"), true);
  assert.equal(ownerAllows("tenonry-vue", "tenonry-php"), false);
  assert.equal(ownerAllows("*", "anything"), true);
  assert.equal(ownerAllows("none", "*"), false);
  assert.equal(ownerAllows(["tenonry-design-reviewer", "tenonry-review-*"], "tenonry-review-vue"), true);
  assert.equal(ownerAllows(["tenonry-design-reviewer", "tenonry-review-*"], "tenonry-vue"), false);
  assert.equal(ownerAllows(undefined, "x"), false);
});

test("run-scoped rules are loaded for the run only", () => {
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const runDir = path.join(root, ".tenonry", "runs", "r-1");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "owner-rules.json"), JSON.stringify({ version: 1, rules: [{ glob: "src/new.xyz", owner: "tenonry-vue", priority: 950, source: "jev:r-1" }] }));
  assert.equal(ownerIn(root, "src/new.xyz"), "unowned");
  assert.equal(ownerIn(root, "src/new.xyz", "r-1"), "tenonry-vue");
});

test("isBuilderAgent excludes core and reviewer agents", () => {
  assert.equal(isBuilderAgent("tenonry-vue"), true);
  for (const name of ["tenonry-planner", "tenonry-art-director", "tenonry-test-author", "tenonry-design-reviewer", "tenonry-review-vue"]) {
    assert.equal(isBuilderAgent(name), false);
  }
});

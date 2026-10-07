import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { renderAgents } from "../scripts/lib/agents.mjs";
import { repoRoot } from "./helpers/docs.mjs";

const catalog = loadCatalog();
const libraryDir = path.join(repoRoot, "library");
const GENERATOR_SENTENCE =
  "You may run the project's own code generators and migration tools (for example `php artisan make:migration`, `prisma migrate dev --create-only`, `drizzle-kit generate`, `alembic revision --autogenerate`, `python manage.py makemigrations`) when everything they write is in files you own.";

export function render(packages, verify = []) {
  return renderAgents({ libraryDir, catalog, packages, verify });
}

test("F1: rendered data specialists may run generators for files they own", () => {
  const agents = render([{ root: ".", specialists: ["eloquent", "prisma"] }]);
  for (const name of ["tenonry-eloquent", "tenonry-prisma"]) {
    const text = agents.get(name);
    assert.ok(text.includes(GENERATOR_SENTENCE), name);
    assert.ok(text.includes("Do not change files with ad hoc shell commands such as sed, echo, or cp."), name);
    assert.ok(text.includes("If a generator names a file differently from the contract, such as a different migration timestamp, keep the generated name."), name);
    assert.ok(!text.includes("Never edit files through shell commands"), `${name} no longer forbids every shell-written file`);
  }
});

test("F1: the test author is told how to list generator-named files", () => {
  const text = fs.readFileSync(path.join(libraryDir, "core", "test-author.md"), "utf8");
  assert.ok(
    text.includes(
      "- Use exact relative paths. No globs in `files`.\n- For files whose names a generator decides, such as timestamped migrations, list the name the project's naming convention would produce. A builder may produce a different timestamp; that is expected and needs no contract change.\n",
    ),
  );
});

const LARAVEL_VERIFY = [{ root: ".", ecosystem: "php", test: "php artisan test", testFiles: "php artisan test {files}", typecheck: null, lint: "./vendor/bin/pint --test" }];
const verifyBlock = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("5. Check your work with your task's tests only."));
  const end = lines.findIndex((line) => line.startsWith("6. If you need a change in a file you do not own"));
  return lines.slice(start + 1, end);
};

test("F2: laravel specialists get the task test command and lint, never the project-wide test command", () => {
  const agents = render([{ root: ".", specialists: ["laravel", "eloquent", "vue"] }], LARAVEL_VERIFY);
  for (const name of ["tenonry-laravel", "tenonry-eloquent", "tenonry-vue"]) {
    const text = agents.get(name);
    assert.deepEqual(verifyBlock(text), ["- task tests: php artisan test {files}", "- lint: ./vendor/bin/pint --test"], name);
    assert.ok(!text.split("\n").some((line) => line === "- test: php artisan test" || line === "php artisan test" || line === "- php artisan test"), name);
    assert.ok(text.includes("never run the whole test suite, and never try to fix another task's failures"), name);
    assert.ok(!text.includes("{{"), name);
  }
});

test("F2: the rendering from a real init of laravel-vue matches", async () => {
  const { fixtureCopy, runInit } = await import("./helpers/project.mjs");
  const root = fixtureCopy("laravel-vue");
  runInit(root);
  const text = fs.readFileSync(path.join(root, ".claude", "agents", "tenonry-laravel.md"), "utf8");
  assert.deepEqual(verifyBlock(text), ["- task tests: php artisan test {files}", "- lint: ./vendor/bin/pint --test"]);
});

test("F2: a package below the root gets the run-from suffix", async () => {
  const { fixtureCopy, runInit } = await import("./helpers/project.mjs");
  const root = fixtureCopy("monorepo");
  runInit(root);
  const nest = fs.readFileSync(path.join(root, ".claude", "agents", "tenonry-nestjs.md"), "utf8");
  assert.deepEqual(verifyBlock(nest), ["- task tests: npx vitest run {files} (run from apps/api; test paths relative to apps/api)"]);
  const next = fs.readFileSync(path.join(root, ".claude", "agents", "tenonry-nextjs.md"), "utf8");
  assert.deepEqual(verifyBlock(next), ["- No verification commands are configured for your files."]);
});

test("F2: a null testFiles renders the no-command line, then typecheck and lint", () => {
  const verify = [{ root: ".", ecosystem: "rust", test: "cargo test", testFiles: null, typecheck: "cargo check", lint: null }];
  const text = render([{ root: ".", specialists: ["rust-axum"] }], verify).get("tenonry-rust-axum");
  assert.deepEqual(verifyBlock(text), [
    "- task tests: no task-scoped test command is configured; do not run tests, Tenonry runs them after you finish.",
    "- typecheck: cargo check",
  ]);
  assert.ok(!text.includes("cargo test"));
});

test("F2: one block per verify entry of the specialist's packages, in config order", () => {
  const verify = [
    { root: ".", ecosystem: "js", test: "npm test", testFiles: "npx vitest run {files}", typecheck: "npx tsc --noEmit", lint: "npm run lint" },
    { root: ".", ecosystem: "php", test: "php artisan test", testFiles: "php artisan test {files}", typecheck: null, lint: null },
    { root: "apps/other", ecosystem: "go", test: "go test ./...", testFiles: "go test {packages}", typecheck: "go vet ./...", lint: null },
  ];
  const text = render([{ root: ".", specialists: ["vue"] }, { root: "apps/other", specialists: ["go"] }], verify).get("tenonry-vue");
  assert.deepEqual(verifyBlock(text), [
    "- task tests: npx vitest run {files}",
    "- typecheck: npx tsc --noEmit",
    "- lint: npm run lint",
    "- task tests: php artisan test {files}",
  ]);
});

test("F2: no rendered agent keeps an unrendered placeholder", () => {
  const agents = render([{ root: ".", specialists: catalog.map((spec) => spec.id) }], LARAVEL_VERIFY);
  assert.equal(agents.size, 4 + 2 * catalog.length);
  for (const [name, text] of agents) assert.ok(!text.includes("{{"), name);
});

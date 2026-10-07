import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { detectAll } from "../scripts/lib/detect.mjs";
import { verifyEntries, detectPreview, expandTestFiles } from "../scripts/lib/stack.mjs";
import { fixturePath, tempDir } from "./helpers/project.mjs";

const catalog = loadCatalog();

function stack(name) {
  const root = fixturePath(name);
  const { packages } = detectAll(root, catalog);
  return { root, packages, verify: packages.flatMap((pkg) => verifyEntries(root, pkg)), preview: detectPreview(root, packages) };
}

const strip = ({ ecosystem, ...rest }) => rest;

test("laravel-vue verifies with artisan and pint", () => {
  const { verify, preview } = stack("laravel-vue");
  assert.deepEqual(verify.map(strip), [
    { root: ".", test: "php artisan test", testFiles: "php artisan test {files}", typecheck: null, lint: "./vendor/bin/pint --test" },
  ]);
  assert.deepEqual(preview, { command: "composer run dev", url: "http://127.0.0.1:8000", cwd: "." });
});

test("next-prisma uses the test script, vitest, and tsc", () => {
  const { verify, preview } = stack("next-prisma");
  assert.deepEqual(verify.map(strip), [
    { root: ".", test: "npm test", testFiles: "npx vitest run {files}", typecheck: "npx tsc --noEmit", lint: null },
  ]);
  assert.deepEqual(preview, { command: "npm run dev", url: "http://localhost:3000", cwd: "." });
});

test("monorepo has one entry per package with the right preview and port", () => {
  const { verify, preview } = stack("monorepo");
  assert.deepEqual(verify.map((v) => [v.root, v.test]), [["apps/api", "npm test"]]);
  assert.deepEqual(preview, { command: "npm run dev", url: "http://localhost:3100", cwd: "apps/web" });
});

test("django uses pytest", () => {
  const { verify, preview } = stack("django");
  assert.deepEqual(verify.map(strip), [{ root: ".", test: "pytest -q", testFiles: "pytest -q {files}", typecheck: null, lint: null }]);
  assert.deepEqual(preview, { command: "python manage.py runserver", url: "http://127.0.0.1:8000", cwd: "." });
});

test("go-api uses go test and go vet", () => {
  const { verify, preview } = stack("go-api");
  assert.deepEqual(verify.map(strip), [{ root: ".", test: "go test ./...", testFiles: "go test {packages}", typecheck: "go vet ./...", lint: null }]);
  assert.equal(preview, null);
});

test("flutter-app uses flutter test and analyze", () => {
  const { verify } = stack("flutter-app");
  assert.deepEqual(verify.map(strip), [{ root: ".", test: "flutter test", testFiles: "flutter test {files}", typecheck: "flutter analyze", lint: null }]);
});

test("three-landing has no verify commands and previews on the script's port", () => {
  const { verify, preview } = stack("three-landing");
  assert.deepEqual(verify, []);
  assert.deepEqual(preview, { command: "npm run dev", url: "http://localhost:3001", cwd: "." });
});

function packageJson(scripts, deps = {}, dev = {}) {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts, dependencies: deps, devDependencies: dev }));
  return root;
}

test("package manager shapes the commands", () => {
  const cases = [
    ["pnpm-lock.yaml", "pnpm test", "pnpm exec vitest run {files}", "pnpm dev"],
    ["yarn.lock", "yarn test", "yarn vitest run {files}", "yarn dev"],
    ["bun.lockb", "bun run test", "bunx vitest run {files}", "bun run dev"],
    ["package-lock.json", "npm test", "npx vitest run {files}", "npm run dev"],
  ];
  for (const [lock, test_, files, dev] of cases) {
    const root = packageJson({ test: "vitest", dev: "vite" }, {}, { vitest: "1", vite: "1" });
    fs.writeFileSync(path.join(root, lock), "");
    const { packages } = detectAll(root, catalog);
    const [entry] = verifyEntries(root, packages[0]);
    assert.equal(entry.test, test_);
    assert.equal(entry.testFiles, files);
    assert.equal(detectPreview(root, packages).command, dev);
  }
});

test("without a test script vitest and jest get direct commands", () => {
  const vitest = packageJson({}, {}, { vitest: "1" });
  assert.equal(verifyEntries(vitest, detectAll(vitest, catalog).packages[0])[0].test, "npx vitest run");
  const jest = packageJson({}, {}, { jest: "1" });
  const entry = verifyEntries(jest, detectAll(jest, catalog).packages[0])[0];
  assert.deepEqual([entry.test, entry.testFiles], ["npx jest", "npx jest {files}"]);
});

test("the default npm init test script is ignored and all-null entries are dropped", () => {
  const root = packageJson({ test: 'echo "Error: no test specified" && exit 1' });
  assert.deepEqual(verifyEntries(root, detectAll(root, catalog).packages[0]), []);
});

test("typecheck and lint scripts win over defaults", () => {
  const root = packageJson({ typecheck: "tsc -p .", lint: "eslint ." }, {}, { typescript: "5" });
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
  const [entry] = verifyEntries(root, detectAll(root, catalog).packages[0]);
  assert.equal(entry.typecheck, "npm run typecheck");
  assert.equal(entry.lint, "npm run lint");
});

test("a project matching several ecosystems gets one entry each in table order", () => {
  const root = packageJson({ test: "vitest" }, {}, { vitest: "1" });
  fs.writeFileSync(path.join(root, "composer.json"), JSON.stringify({ require: { "phpunit/phpunit": "^11" } }));
  fs.writeFileSync(path.join(root, "go.mod"), "module x\n");
  const entries = verifyEntries(root, detectAll(root, catalog).packages[0]);
  assert.deepEqual(entries.map((e) => e.ecosystem), ["js", "php", "go"]);
  assert.equal(entries[1].test, "./vendor/bin/phpunit");
});

test("other ecosystems resolve their commands", () => {
  const cases = [
    [{ "Cargo.toml": "[package]" }, "cargo test", "cargo check"],
    [{ Gemfile: "gem 'rspec'\ngem 'rubocop'" }, "bundle exec rspec", null],
    [{ Gemfile: "gem 'rails'" }, "bin/rails test", null],
    [{ "mix.exs": "defmodule X" }, "mix test", null],
    [{ "App.csproj": "<Project/>" }, "dotnet test", "dotnet build"],
    [{ "pom.xml": "<project/>" }, "mvn -q test", null],
    [{ "build.gradle": "", gradlew: "" }, "./gradlew test", null],
    [{ "build.gradle.kts": "" }, "gradle test", null],
    [{ "pubspec.yaml": "name: x" }, "dart test", "dart analyze"],
  ];
  for (const [files, test_, typecheck] of cases) {
    const root = tempDir();
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
    const entries = verifyEntries(root, detectAll(root, catalog).packages[0]);
    assert.equal(entries[0].test, test_, JSON.stringify(files));
    assert.equal(entries[0].typecheck, typecheck, JSON.stringify(files));
  }
});

test("php entries detect pest, phpstan, and pint", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "composer.json"), JSON.stringify({ "require-dev": { "pestphp/pest": "^3", "larastan/larastan": "^3", "laravel/pint": "^1" } }));
  const [entry] = verifyEntries(root, detectAll(root, catalog).packages[0]);
  assert.deepEqual(strip(entry), {
    root: ".", test: "./vendor/bin/pest", testFiles: "./vendor/bin/pest {files}",
    typecheck: "./vendor/bin/phpstan analyse --no-progress", lint: "./vendor/bin/pint --test",
  });
});

test("python entries read mypy and ruff settings", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.mypy]\n[tool.ruff]\n");
  const [entry] = verifyEntries(root, detectAll(root, catalog).packages[0]);
  assert.deepEqual([entry.test, entry.typecheck, entry.lint], ["pytest -q", "mypy .", "ruff check ."]);
});

test("preview rows follow the documented order and ports", () => {
  const cases = [
    [{ dev: "nuxt dev" }, { nuxt: "3" }, "http://localhost:3000"],
    [{ dev: "astro dev" }, { astro: "5" }, "http://localhost:4321"],
    [{ dev: "react-router dev" }, { "@react-router/dev": "7" }, "http://localhost:5173"],
    [{ start: "ng serve" }, { "@angular/core": "19" }, "http://localhost:4200"],
    [{ dev: "vite -p 4000" }, { vite: "6" }, "http://localhost:4000"],
  ];
  for (const [scripts, deps, url] of cases) {
    const root = packageJson(scripts, deps);
    assert.equal(detectPreview(root, detectAll(root, catalog).packages).url, url);
  }
});

test("a laravel project without a dev script uses artisan serve", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "composer.json"), "{}");
  fs.writeFileSync(path.join(root, "artisan"), "");
  assert.equal(detectPreview(root, detectAll(root, catalog).packages).command, "php artisan serve");
});

test("expandTestFiles quotes paths relative to the package root", () => {
  assert.equal(expandTestFiles("pytest -q {files}", ["tests/a b.py", "tests/it's.py"], "."), "pytest -q 'tests/a b.py' 'tests/it'\\''s.py'");
  assert.equal(expandTestFiles("vitest run {files}", ["apps/api/test/a.test.ts"], "apps/api"), "vitest run 'test/a.test.ts'");
  assert.equal(expandTestFiles("go test {packages}", ["internal/a/x_test.go", "internal/a/y_test.go", "cmd/z_test.go"], "."), "go test './internal/a' './cmd'");
});

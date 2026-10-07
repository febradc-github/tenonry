import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { detectAll, findPackageRoots, applySupersession, packageManager, manifestHash } from "../scripts/lib/detect.mjs";
import { fixturePath, tempDir } from "./helpers/project.mjs";

const catalog = loadCatalog();
const detect = (name) => detectAll(fixturePath(name), catalog);
const specialists = (result, root = ".") => result.packages.find((p) => p.root === root).specialists;

function assertIncludes(actual, expected) {
  for (const id of expected) assert.ok(actual.includes(id), `expected ${id} in ${actual.join(", ")}`);
}

test("laravel-vue activates laravel stack and supersedes css with tailwind", () => {
  const ids = specialists(detect("laravel-vue"));
  assertIncludes(ids, ["laravel", "eloquent", "php", "vue", "tailwind", "html", "nodejs"]);
  assert.ok(!ids.includes("css"));
  assert.ok(!ids.includes("react"));
});

test("next-prisma supersedes react with nextjs", () => {
  const ids = specialists(detect("next-prisma"));
  assertIncludes(ids, ["nextjs", "prisma", "typescript", "nodejs"]);
  assert.ok(!ids.includes("react"));
});

test("monorepo finds workspace packages and detects per package", () => {
  const result = detect("monorepo");
  assert.deepEqual(result.packages.map((p) => p.root), [".", "apps/api", "apps/web"]);
  assertIncludes(specialists(result, "apps/web"), ["nextjs"]);
  assertIncludes(specialists(result, "apps/api"), ["nestjs", "prisma"]);
  assert.ok(!specialists(result, "apps/web").includes("nestjs"));
  assert.ok(!specialists(result, ".").includes("nextjs"));
});

test("django activates the python web stack", () => {
  assertIncludes(specialists(detect("django")), ["django", "django-orm", "python", "html"]);
});

test("go-api activates go", () => {
  assertIncludes(specialists(detect("go-api")), ["go"]);
});

test("flutter-app activates flutter", () => {
  assertIncludes(specialists(detect("flutter-app")), ["flutter"]);
});

test("three-landing activates 3d, html, and nodejs", () => {
  assertIncludes(specialists(detect("three-landing")), ["3d", "html", "nodejs"]);
});

test("supersession is applied once, in catalog order", () => {
  assert.deepEqual(applySupersession(["react", "nextjs"], catalog), ["nextjs"]);
  assert.deepEqual(applySupersession(["css", "tailwind", "vue", "nuxt"], catalog), ["nuxt", "tailwind"]);
});

test("package roots include pnpm workspaces and depth-1 manifest directories", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "packages", "ui"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "deep", "inner"), { recursive: true });
  fs.mkdirSync(path.join(root, "backend"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n  - \"!packages/deep\"\nother: 1\n");
  fs.writeFileSync(path.join(root, "backend", "go.mod"), "module x\n");
  assert.deepEqual(findPackageRoots(root), [".", "backend", "packages/deep", "packages/ui"]);
});

test("workspace /** patterns list two levels of directories", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "libs", "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: { packages: ["libs/**"] } }));
  assert.deepEqual(findPackageRoots(root), [".", "libs/a", "libs/a/b"]);
});

test("package manager comes from the lockfile, searching up to the project root", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "apps", "web"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "web", "package.json"), "{}");
  assert.equal(packageManager(path.join(root, "apps", "web"), root), "npm");
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
  assert.equal(packageManager(path.join(root, "apps", "web"), root), "pnpm");
  fs.rmSync(path.join(root, "pnpm-lock.yaml"));
  fs.writeFileSync(path.join(root, "apps", "web", "yarn.lock"), "");
  assert.equal(packageManager(path.join(root, "apps", "web"), root), "yarn");
  fs.rmSync(path.join(root, "apps", "web", "yarn.lock"));
  fs.writeFileSync(path.join(root, "apps", "web", "bun.lockb"), "");
  assert.equal(packageManager(path.join(root, "apps", "web"), root), "bun");
  assert.equal(packageManager(root), null);
});

test("generated directories are not scanned", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "node_modules", "x", "a.vue"), "");
  fs.writeFileSync(path.join(root, "dist", "a.css"), "");
  fs.writeFileSync(path.join(root, "main.py"), "");
  const ids = specialists(detectAll(root, catalog));
  assert.ok(ids.includes("python"));
  assert.ok(!ids.includes("css"));
});

test("text signals read manifests at directory depth two or less", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "svc", "api"), { recursive: true });
  fs.writeFileSync(path.join(root, "svc", "api", "requirements.txt"), "fastapi\n");
  assert.ok(specialists(detectAll(root, catalog)).includes("fastapi"));
});

test("the manifest hash changes with manifests and the plugin version only", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"a"}');
  const base = manifestHash(root, "0.1.0");
  assert.equal(manifestHash(root, "0.1.0"), base);
  assert.notEqual(manifestHash(root, "0.2.0"), base);
  fs.writeFileSync(path.join(root, "README.md"), "x");
  assert.equal(manifestHash(root, "0.1.0"), base);
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"b"}');
  assert.notEqual(manifestHash(root, "0.1.0"), base);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMap, namesIn, receivesMap, MAP_HEADER } from "../scripts/lib/map.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";
import { makeProject, tempDir, git, gitInit } from "./helpers/project.mjs";

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

test("0.5.0: names come from each language's top-level definitions", () => {
  const js = "export function formatPoints() {}\nexport const MAX = 1;\nexport default class Wallet {}\nexport { a, b as renamed, type Shape, c as default };\nfunction hidden() {}\n";
  assert.deepEqual(namesIn("src/a.ts", js), ["formatPoints", "MAX", "Wallet", "a", "renamed", "Shape"]);
  assert.deepEqual(namesIn("app/x.py", "def top():\n    def inner(): pass\nclass Order:\n    def method(self): pass\ndef _private(): pass\n"), ["top", "Order"]);
  assert.deepEqual(namesIn("x.go", "func Exported() {}\nfunc hidden() {}\nfunc (s *Svc) Run() {}\ntype Order struct {}\n"), ["Exported", "Run", "Order"]);
  assert.deepEqual(namesIn("x.php", "<?php\nfinal class PointsService {}\ninterface Ledger {}\nfunction points_helper() {}\n"), ["PointsService", "Ledger", "points_helper"]);
  assert.deepEqual(namesIn("x.kt", "enum class Tier { GOLD }\ndata class Points(val n: Int)\nobject Registry\n"), ["Tier", "Points", "Registry"]);
  assert.deepEqual(namesIn("x.cs", "public static partial class Helpers {}\npublic record Total(int N);\n"), ["Helpers", "Total"]);
  assert.deepEqual(namesIn("x.ex", "defmodule Shop.Points do\nend\n"), ["Shop.Points"]);
  assert.deepEqual(namesIn("x.dart", "abstract class Repo {}\nmixin Logs {}\nvoid main() {}\n"), ["Repo", "Logs"]);
  assert.deepEqual(namesIn("x.rs", "pub fn total() {}\nfn private() {}\npub struct Ledger;\n"), ["total", "Ledger"]);
  assert.deepEqual(namesIn("components/PointsBadge.vue", ""), ["PointsBadge"]);
  assert.deepEqual(namesIn("README.md", "export function no() {}"), []);
});

test("0.5.0: the map lists source folders, shared code first, and skips tests, vendored, generated, and hidden files", () => {
  const root = makeProject();
  write(root, {
    "app/pages/home.ts": "export function HomePage() {}\n",
    "src/utils/money.ts": "export function formatMoney() {}\n",
    "src/utils/money.test.ts": "export function testOnly() {}\n",
    "src/types/api.d.ts": "export interface Generated {}\n",
    "tests/helpers.ts": "export function testHelper() {}\n",
    "node_modules/pkg/index.js": "export function vendored() {}\n",
    "vendor/lib/x.php": "<?php class Vendored {}\n",
    "dist/app.js": "export function built() {}\n",
    "public/app.min.js": "export function minified() {}\n",
    ".storybook/main.ts": "export const hidden = 1;\n",
    "db/migrations/001.ts": "export function up() {}\n",
    "src/empty.ts": "const nothing = 1;\n",
  });
  const map = buildMap(root);
  assert.equal(map, [MAP_HEADER, "src/utils/: formatMoney", "app/pages/: HomePage"].join("\n"));
});

test("0.5.0: a folder of many files lists one name per file; a long folder is cut at 30 names", () => {
  const root = makeProject();
  const many = {};
  for (let i = 0; i < 40; i++) many[`ui/components/C${i}.ts`] = `export function c${i}() {}\nexport function extra${i}() {}\n`;
  for (let i = 0; i < 3; i++) many[`ui/small/S${i}.ts`] = `export const s${i}a = 1;\nexport const s${i}b = 1;\nexport const s${i}c = 1;\nexport const s${i}d = 1;\n`;
  write(root, many);
  const lines = buildMap(root, { maxChars: 5000 }).split("\n");
  const components = lines.find((line) => line.startsWith("ui/components/: "));
  assert.equal(components.split(": ")[1].split(", ").length, 31, "30 names and the ellipsis");
  assert.ok(components.endsWith(", ..."));
  assert.ok(!components.includes("extra"), "one name per file in a large folder");
  assert.equal(lines.find((line) => line.startsWith("ui/small/: ")), "ui/small/: s0a, s0b, s0c, s1a, s1b, s1c, s2a, s2b, s2c");
});

test("0.5.0: the map stays inside its character budget and says how many folders it left out", () => {
  const root = makeProject();
  const files = {};
  for (let i = 0; i < 60; i++) files[`features/f${String(i).padStart(2, "0")}/index.ts`] = `export function feature${i}() {}\n`;
  write(root, files);
  const map = buildMap(root, { maxChars: 300 });
  const lines = map.split("\n");
  assert.equal(lines[0], MAP_HEADER);
  const body = lines.slice(1, -1);
  assert.ok(body.length > 0);
  assert.ok(body.join("\n").length <= 300);
  assert.equal(lines.at(-1), `(${60 - body.length} more folders not listed)`);
});

test("0.5.0: in a git repository only tracked files are listed", () => {
  const root = tempDir();
  write(root, { "src/lib/tracked.ts": "export function tracked() {}\n" });
  gitInit(root);
  write(root, { "src/lib/untracked.ts": "export function untracked() {}\n" });
  assert.equal(buildMap(root), `${MAP_HEADER}\nsrc/lib/: tracked`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "more");
  assert.equal(buildMap(root), `${MAP_HEADER}\nsrc/lib/: tracked, untracked`);
});

test("0.5.0: an invalid budget falls back to 2000 characters", () => {
  const root = makeProject();
  write(root, { "src/lib/a.ts": "export function a() {}\n" });
  for (const maxChars of ["abc", -5, 0, null]) assert.equal(buildMap(root, { maxChars }), buildMap(root), String(maxChars));
});

test("0.5.0: a project without definitions gets no map", () => {
  const root = makeProject();
  write(root, { "index.html": "<p>hi</p>\n", "main.py": "print('hi')\n" });
  assert.equal(buildMap(root), "");
});

test("0.5.0: builders, code reviewers, the planner, and the test author receive the map; the visual agents do not", () => {
  for (const name of ["tenonry-vue", "tenonry-review-vue", "tenonry-planner", "tenonry-test-author", "tenonry-laravel"]) assert.equal(receivesMap(name), true, name);
  for (const name of ["tenonry-art-director", "tenonry-design-reviewer", "Explore", "general-purpose", "", undefined, null, 42]) assert.equal(receivesMap(name), false, String(name));
});

test("0.5.0: the codebase map is on by default with a 2000 character budget", () => {
  assert.deepEqual(loadConfig(makeProject()).codebaseMap, { enabled: true, maxChars: 2000 });
  assert.deepEqual(loadConfig(makeProject({ config: { codebaseMap: { enabled: false } } })).codebaseMap, { enabled: false, maxChars: 2000 });
});

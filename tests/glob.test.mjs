import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGlob, matchGlob } from "../scripts/lib/glob.mjs";

const cases = [
  ["**/*.vue", "App.vue", true],
  ["**/*.vue", "src/components/Btn.vue", true],
  ["app/**", "app/Http/Kernel.php", true],
  ["app/**", "app", true],
  ["app/**", "apps/x.php", false],
  ["**/*.{ts,tsx}", "src/a.tsx", true],
  ["**/*.{ts,tsx}", "src/a.ts.bak", false],
  ["*.md", "docs/a.md", false],
  ["src/**/test_*.py", "src/pkg/test_api.py", true],
  [".tenonry/runs/*/plan.md", ".tenonry/runs/r-1/plan.md", true],
  [".env.*", ".env.local", true],
  ["**/package.json", "package.json", true],
];

for (const [glob, path, expected] of cases) {
  test(`glob ${glob} ${expected ? "matches" : "does not match"} ${path}`, () => {
    assert.equal(matchGlob(glob, path), expected);
  });
}

test("glob escapes regex metacharacters", () => {
  assert.equal(matchGlob("a.b", "aXb"), false);
  assert.equal(matchGlob("a+b(1)", "a+b(1)"), true);
});

test("glob ? matches one non-slash character", () => {
  assert.equal(matchGlob("a?c", "abc"), true);
  assert.equal(matchGlob("a?c", "a/c"), false);
});

test("glob braces may hold wildcards", () => {
  assert.equal(matchGlob("**/{vitest,jest}.config.*", "web/jest.config.ts"), true);
  assert.equal(matchGlob("{a*,b}", "abc"), true);
});

test("a ** in the middle of a segment matches across directories", () => {
  assert.equal(matchGlob("src/**.js", "src/a/b.js"), true);
});

test("a ** directory in the middle may match zero directories", () => {
  assert.equal(matchGlob("a/**/b", "a/b"), true);
  assert.equal(matchGlob("a/**/b", "a/x/y/b"), true);
});

test("invalid globs throw", () => {
  assert.throws(() => compileGlob("{a,b"));
  assert.throws(() => compileGlob("a}"));
  assert.throws(() => compileGlob(""));
});

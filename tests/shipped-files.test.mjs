import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, extractBlock, TEXT_SOURCES } from "./helpers/docs.mjs";
import { MARKER } from "../scripts/lib/render.mjs";

const EM_DASH = "\u2014";
const SHIPPED_DIRS = ["library", "skills", "scripts", "hooks", ".claude-plugin"];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("no shipped file contains an em dash", () => {
  const files = [...SHIPPED_DIRS.flatMap((d) => walk(path.join(repoRoot, d))), path.join(repoRoot, "README.md")];
  assert.ok(files.length > 10);
  for (const file of files) {
    assert.ok(!fs.readFileSync(file, "utf8").includes(EM_DASH), `${file} contains U+2014`);
  }
});

test("shipped text files use LF line endings", () => {
  for (const file of SHIPPED_DIRS.flatMap((d) => walk(path.join(repoRoot, d)))) {
    assert.ok(!fs.readFileSync(file, "utf8").includes("\r"), `${file} contains CR`);
  }
});

test("every core and template file ends with the generated marker, except ui-rules", () => {
  for (const dir of ["library/core", "library/templates"]) {
    for (const name of fs.readdirSync(path.join(repoRoot, dir))) {
      if (name === "ui-rules.md") continue;
      const lines = fs.readFileSync(path.join(repoRoot, dir, name), "utf8").trimEnd().split("\n");
      assert.equal(lines.at(-1), MARKER, `${dir}/${name}`);
    }
  }
});

test("shipped texts match docs/06 and docs/07 verbatim", () => {
  for (const source of TEXT_SOURCES) {
    const expected = extractBlock(source.doc, source.heading);
    const actual = fs.readFileSync(path.join(repoRoot, source.target), "utf8");
    assert.equal(actual, expected, source.target);
  }
});

test("agent and skill descriptions stay under 30 words", () => {
  const files = TEXT_SOURCES.map((s) => s.target).filter((t) => t.endsWith(".md") && !t.includes("rubrics") && !t.includes("ui-rules"));
  for (const target of files) {
    const text = fs.readFileSync(path.join(repoRoot, target), "utf8");
    const description = /^description: (.*)$/m.exec(text)?.[1] ?? "";
    assert.ok(description.split(/\s+/).length < 30, `${target}: ${description}`);
  }
});

test("no package.json declares runtime dependencies", () => {
  for (const file of walk(repoRoot).filter((f) => f.endsWith("package.json") && !f.includes("node_modules") && !f.includes(`${path.sep}.git${path.sep}`) && !f.includes(`${path.sep}fixtures${path.sep}`))) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(pkg.dependencies, undefined, file);
  }
});

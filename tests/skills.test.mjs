import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./helpers/docs.mjs";

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");
const doc06 = read("docs", "06-AGENT-AND-SKILL-TEXTS.md");

function frontmatter(text) {
  const lines = text.split("\n");
  assert.equal(lines[0], "---");
  const end = lines.indexOf("---", 1);
  assert.ok(end > 1);
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+): (.*)$/.exec(line);
    if (match) fields[match[1]] = match[2];
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

const SKILLS = [
  ["init", "TENONRY_INIT_SKILL"],
  ["run", "TENONRY_RUN_SKILL"],
  ["clarify-intake", "TENONRY_CLARIFY_SKILL"],
];

for (const [name, marker] of SKILLS) {
  test(`skill ${name} exists with valid frontmatter and its marker line`, () => {
    const { fields, body } = frontmatter(read("skills", name, "SKILL.md"));
    assert.equal(fields.name, name);
    assert.ok(fields.description && fields.description.split(/\s+/).length < 30);
    assert.ok(body.split("\n").includes(marker), `${marker} is on a line by itself`);
  });
}

test("the user-facing skills are user-invoked only", () => {
  for (const name of ["init", "run"]) assert.equal(frontmatter(read("skills", name, "SKILL.md")).fields["disable-model-invocation"], "true");
  assert.equal(frontmatter(read("skills", "clarify-intake", "SKILL.md")).fields["disable-model-invocation"], undefined);
  assert.equal(frontmatter(read("skills", "run", "SKILL.md")).fields["argument-hint"], "<what you want> | resume | undo | help");
});

test("the run skill contains the help block verbatim", () => {
  const help = /Help block:\n\n```\n([\s\S]*?)\n```/.exec(doc06)[1];
  assert.ok(read("skills", "run", "SKILL.md").includes(help));
  assert.match(help, /^Tenonry\n {2}\/tenonry:run <what you want>/);
});

test("the run skill contains every progress line from docs/06 section 2", () => {
  const section = /## Progress lines\n\nPrint each line when its event happens:\n\n([\s\S]*?)\n\n## Step 0/.exec(doc06)[1];
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.ok(lines.length >= 14, `found ${lines.length} progress lines`);
  const skill = read("skills", "run", "SKILL.md");
  for (const line of lines) assert.ok(skill.includes(line), line);
});

test("the run skill drives every tenonry.mjs command it names", async () => {
  const { COMMANDS } = await import("../scripts/lib/commands.mjs");
  const skill = read("skills", "run", "SKILL.md");
  const named = new Set([...skill.matchAll(/`tenonry\.mjs ([a-z-]+)/g)].map((m) => m[1]));
  assert.ok(named.size >= 15);
  for (const command of named) assert.ok(COMMANDS[command], `${command} is implemented`);
});

test("every agent mentioned in delegations exists in the library", () => {
  const skill = read("skills", "run", "SKILL.md");
  for (const [agent, file] of [["tenonry-planner", "planner.md"], ["tenonry-art-director", "art-director.md"], ["tenonry-test-author", "test-author.md"]]) {
    assert.ok(skill.includes(agent));
    assert.ok(fs.existsSync(path.join(repoRoot, "library", "core", file)));
  }
});

test("the plugin manifests carry the documented metadata", () => {
  const plugin = JSON.parse(read(".claude-plugin", "plugin.json"));
  assert.equal(plugin.name, "tenonry");
  assert.equal(plugin.version, "0.1.0");
  assert.deepEqual(plugin.author, { name: "Dan Christian Febra" });
  assert.equal(plugin.license, undefined);
  assert.equal(plugin.repository, undefined);
  const market = JSON.parse(read(".claude-plugin", "marketplace.json"));
  assert.equal(market.name, "tenonry-local");
  assert.deepEqual(market.plugins[0], { name: "tenonry", source: "./", description: "Specialist multi-agent pipeline with Jev routing.", version: "0.1.0" });
});

test("the user README follows the required order and says the license is not chosen", () => {
  const readme = read("README.md");
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings.slice(0, 4), ["Quick start", "Commands", "What to expect on the first run", "Optional: smarter model routing"]);
  assert.ok(headings.includes("What gets created"));
  assert.ok(headings.includes("Optional settings"));
  assert.ok(headings.includes("Requirements"));
  assert.ok(headings.includes("Remove Tenonry from a project"));
  assert.equal(headings.at(-1), "License");
  const quickStart = /## Quick start\n\n([\s\S]*?)\n\n## /.exec(readme)[1];
  assert.equal(quickStart.split("\n").filter((l) => /^\d+\. /.test(l)).length, 3);
  assert.match(readme, /OPENROUTER_API_KEY/);
  assert.match(readme, /calibrate/);
  assert.match(readme, /Not chosen yet\.$/m);
  const table = /\| Command \| What happens \|\n\|---\|---\|\n([\s\S]*?)\n\nExamples/.exec(readme)[1];
  assert.equal(table.split("\n").length, 6);
});

test("the command table matches docs/01 section 2.0", () => {
  const architecture = read("docs", "01-ARCHITECTURE.md");
  const docTable = /### 2\.0 What the user types\n\n([\s\S]*?)\n\n### 2\.1/.exec(architecture)[1];
  assert.ok(read("README.md").includes(docTable));
});

test("claude plugin validate passes when the CLI is available", { skip: spawnSync("claude", ["--version"]).status !== 0 && "claude CLI not available" }, () => {
  const result = spawnSync("claude", ["plugin", "validate", "."], { cwd: repoRoot, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Validation passed/);
  assert.doesNotMatch(result.stdout, /warning/i);
});

test("claude plugin validate --strict also passes", { skip: spawnSync("claude", ["--version"]).status !== 0 && "claude CLI not available" }, () => {
  const result = spawnSync("claude", ["plugin", "validate", ".", "--strict"], { cwd: repoRoot, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

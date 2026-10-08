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
  assert.equal(plugin.version, "0.6.0");
  assert.deepEqual(plugin.author, { name: "Dan Christian Febra" });
  assert.equal(plugin.license, "MIT");
  assert.equal(plugin.repository, undefined);
  const market = JSON.parse(read(".claude-plugin", "marketplace.json"));
  assert.equal(market.name, "tenonry-local");
  assert.deepEqual(market.plugins[0], { name: "tenonry", source: "./", description: "Specialist multi-agent pipeline with Jev routing.", version: "0.6.0" });
});

test("the user README follows the required order and names the license", () => {
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
  assert.match(readme, /^MIT\. See \[LICENSE\]\(LICENSE\)\.$/m);
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

test("F12: the README changelog lists the eleven 0.2.0 changes and the automatic re-render", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.2.0"), readme.indexOf("### 0.1.0"));
  assert.equal(section.split("\n").filter((line) => line.startsWith("- ")).length, 11);
  assert.match(section, /re-renders that project's agents/);
  assert.ok(readme.indexOf("## Changelog") < readme.indexOf("## License"));
});

test("F12: every manifest and the dev package agree on the version", () => {
  const version = JSON.parse(read(".claude-plugin", "plugin.json")).version;
  assert.equal(version, "0.6.0");
  assert.equal(JSON.parse(read(".claude-plugin", "marketplace.json")).plugins[0].version, version);
  assert.equal(JSON.parse(read("package.json")).version, version);
});

test("F12: no document still tells anyone to run node --test with a directory", () => {
  for (const file of ["CLAUDE.md", "README.md", path.join("docs", "08-BUILD-PLAN-AND-TESTS.md"), path.join("docs", "00-START-PROMPT.md")]) {
    // The directory form fails on Node 22 and newer (D-044); naming one test file is fine.
    assert.doesNotMatch(read(file), /node --test tests\/(?![\w.-])/, file);
  }
});

test("0.3.0: the run skill skips the planner only when route.json says plan: no", () => {
  const skill = read("skills", "run", "SKILL.md");
  const step = /## Step 4: planning\n\n([\s\S]*?)\n\n## Step 5/.exec(skill)[1];
  const [setup, direct, planned] = step.split("\n\n");
  assert.equal(setup, "Run `tenonry.mjs phase <id> planning`. Then read `plan` in `route.json`.");
  assert.match(direct, /^`plan: no` means/);
  assert.ok(direct.includes("Print `Small request: skipping the plan.` and run `tenonry.mjs direct-plan <id>`."));
  assert.ok(direct.includes("Do not spawn the planner."));
  assert.ok(direct.includes("If it returns `ok: false`, plan as below instead."));
  assert.match(planned, /^Anything else \(`plan: yes`, or no `plan` field\): print `Planning\.\.\.`\. Spawn `tenonry-planner` with model `opus`/);
  assert.ok(skill.includes("- `Small request: skipping the plan.`"), "the skip has its own progress line");
});

test("0.3.0: the README changelog and the routing section say when the plan is skipped", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.3.0"), readme.indexOf("### 0.2.0"));
  assert.ok(readme.indexOf("### 0.3.0") > readme.indexOf("## Changelog"));
  assert.equal(section.split("\n").filter((line) => line.startsWith("- ")).length, 1);
  assert.match(section, /Jev decides whether a request needs a plan/);
  assert.match(section, /re-renders that project's agents/);
  assert.match(readme, /Without a key everything still works and nothing is skipped: every request is planned/);
});

test("0.3.1: the README changelog says simple tasks no longer reach Opus", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.3.1"), readme.indexOf("### 0.3.0"));
  assert.ok(readme.indexOf("### 0.3.1") > readme.indexOf("## Changelog"));
  assert.equal(section.split("\n").filter((line) => line.startsWith("- ")).length, 1);
  assert.match(section, /Opus builds only complex tasks/);
  assert.match(section, /re-renders that project's agents/);
});

const stepOf = (skill, from, to) => new RegExp(`## Step ${from}[^\\n]*\\n\\n([\\s\\S]*?)\\n\\n## Step ${to}`).exec(skill)[1];

test("0.4.0: the run skill answers a question directly and closes the run", () => {
  const skill = read("skills", "run", "SKILL.md");
  const [answer, otherwise] = stepOf(skill, 3, 4).split("\n\n");
  assert.match(answer, /^If `route\.json` has `lane: answer`, the request is a question, not a change\./);
  assert.ok(answer.includes("Print `This is a question, so no code will change. Answering directly.` and run `tenonry.mjs phase <id> done`."));
  assert.ok(answer.includes("change nothing, and spawn no agent"));
  assert.ok(answer.includes("End with the line `No files were changed. To change something, type /tenonry:run <what to change>.` and stop."));
  assert.equal(otherwise, "Otherwise:");
  assert.ok(skill.includes("Do not summarize agent output or add commentary. The one exception is the direct answer in step 3."));
});

test("0.4.0: the run skill lets design-check decide the design step", () => {
  const skill = read("skills", "run", "SKILL.md");
  assert.ok(skill.includes("\n## Step 5: design\n"));
  const [check, skip, run] = stepOf(skill, 5, 6).split("\n\n");
  assert.equal(check, "Run `tenonry.mjs design-check <id>`. It reads the plan and returns `design` and `ui`.");
  assert.match(skip, /^`design: skip` means there is nothing for the art director to do/);
  assert.ok(skip.includes("When `reason` is `no_new_design`, print `Keeping the current look: no new design needed.` Go to step 6."));
  assert.match(run, /^`design: run`: print `Designing the look\.\.\.`\. Run `tenonry\.mjs phase <id> design`\. Spawn `tenonry-art-director` with model `opus`:$/);
  assert.ok(skill.includes("mode: <the mode design-check returned>"));
  assert.ok(!skill.includes("note `ui`"), "the orchestrator no longer reads the plan's metadata itself");
});

test("0.4.0: the run skill tries the quick contract first and routes the test author's model", () => {
  const skill = read("skills", "run", "SKILL.md");
  const [phase, quick, author] = stepOf(skill, 6, 7).split("\n\n");
  assert.equal(phase, "Run `tenonry.mjs phase <id> contract`.");
  assert.match(quick, /^If `route\.json` has `lane: quick`, Jev judged the request a small mechanical change\. Run `tenonry\.mjs quick-contract <id>`\./);
  assert.ok(quick.includes("`ok: true`: print `Quick change: one task, no new tests.`, run `tenonry.mjs phase <id> building`, and go to step 7 without spawning the test author."));
  assert.ok(quick.includes("`ok: false`: continue below."));
  assert.equal(author, "Spawn `tenonry-test-author` with the model named in `contractModel` of `route.json` (`opus` when the field is missing):");
});

test("0.4.0: the README changelog lists the six decisions handed to Jev", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.4.0"), readme.indexOf("### 0.3.1"));
  assert.ok(readme.indexOf("### 0.4.0") > readme.indexOf("## Changelog"));
  assert.equal(section.split("\n").filter((line) => line.startsWith("- ")).length, 6);
  assert.match(section, /re-renders that project's agents/);
});

test("the repository carries the MIT license, and every manifest names it", () => {
  const license = read("LICENSE");
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Dan Christian Febra\n/);
  assert.match(license, /Permission is hereby granted, free of charge, to any person obtaining a copy/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
  assert.equal(JSON.parse(read("package.json")).license, "MIT");
});

test("0.5.0: the README changelog lists the least-code changes and credits ponytail", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.5.0"), readme.indexOf("### 0.4.0"));
  assert.ok(readme.indexOf("### 0.5.0") > readme.indexOf("## Changelog"));
  for (const needle of ["least-code ladder", "codebase map", "codebaseMap.enabled: false", "one line", "C8", "https://github.com/dietrichgebert/ponytail"]) {
    assert.ok(section.includes(needle), needle);
  }
  assert.ok(readme.includes("- `codebaseMap`: "), "the optional settings list the knob");
});

test("0.6.0: the run skill picks a starter for an empty project before the restart check", () => {
  const skill = read("skills", "run", "SKILL.md");
  const step1 = skill.slice(skill.indexOf("## Step 1: setup"), skill.indexOf("## Step 2: run directory"));
  for (const needle of [
    "`empty: true`: the project has no code Tenonry recognizes yet, so it starts from a starter.",
    "From `starters`, choose the one the request names, otherwise the one whose `fits` matches the request best.",
    "run `node \"<plugin root>/scripts/init.mjs\" --starter <id>` and print `New project: starting a <title>.`",
    "treat `agentsDirCreated` as true if either result says so",
    "Tenonry cannot start a <name> project in an empty folder yet.",
  ]) {
    assert.ok(step1.includes(needle), needle);
  }
  assert.ok(step1.indexOf("--starter <id>") < step1.indexOf("3. If `agentsDirCreated` is true"));
  assert.ok(skill.includes("- `New project: starting a <starter title>.`"));
  assert.ok(!skill.includes("print the two setup progress lines"));
  assert.ok(read("skills", "init", "SKILL.md").includes("- `empty: true`: tell the user the project has no code Tenonry recognizes yet"));
});

test("0.6.0: the README explains empty projects and lists the starters", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 0.6.0"), readme.indexOf("### 0.5.0"));
  assert.ok(readme.indexOf("### 0.6.0") > readme.indexOf("## Changelog"));
  for (const needle of ["empty folder", "lockfile", "react-vite", "node-api"]) assert.ok(section.includes(needle) || readme.includes(needle), needle);
  assert.ok(readme.includes("## Starting from an empty folder"));
});

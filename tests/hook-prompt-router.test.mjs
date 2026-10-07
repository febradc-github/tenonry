import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { makeProject } from "./helpers/project.mjs";
import { writeFixture, BASE_ANSWERS } from "./helpers/jev.mjs";
import { readState } from "../scripts/lib/state.mjs";
import { extractRequest } from "../scripts/hook-prompt-router.mjs";

const hook = script("hook-prompt-router.mjs");
const CLEAN_ENV = { TENONRY_JEV_FIXTURE: "", TENONRY_JEV_DISABLE: "", TENONRY_JEV_URL: "" };

function route(root, prompt, extra = {}, env = {}) {
  const input = { cwd: root, session_id: "s", prompt, ...extra };
  return runNode(hook, [], { input: JSON.stringify(input), cwd: root, env: { ...CLEAN_ENV, ...env } });
}

const routeFile = (root, runId) => JSON.parse(fs.readFileSync(path.join(root, ".tenonry", "runs", runId, "route.json"), "utf8"));
const runIdOf = (result) => /run=(\S+)/.exec(result.json.hookSpecificOutput.additionalContext)[1];

test("creates the run and route.json, and prints TENONRY_ROUTE", () => {
  const root = makeProject();
  const result = route(root, "/tenonry:run add a loyalty page", { model: "claude-sonnet-5-5" }, { TENONRY_JEV_FIXTURE: writeFixture() });
  assert.equal(result.status, 0);
  const out = result.json.hookSpecificOutput;
  assert.equal(out.hookEventName, "UserPromptSubmit");
  const runId = runIdOf(result);
  assert.equal(out.additionalContext, `TENONRY_ROUTE run=${runId} clarify=no route=.tenonry/runs/${runId}/route.json`);
  const saved = routeFile(root, runId);
  assert.equal(saved.prompt, "add a loyalty page");
  assert.equal(saved.jev, "ok");
  assert.deepEqual(saved.mainModel, { current: "sonnet", notice: false });
  assert.equal(readState(root).activeRun, runId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".tenonry", "runs", runId, "run.json"), "utf8")).prompt, "add a loyalty page");
});

test("high ambiguity asks to clarify", () => {
  const root = makeProject();
  const fixture = writeFixture({ intake: { ...BASE_ANSWERS.intake, ambiguity: { type: "noul", noul: 0.9 } } });
  const result = route(root, "/tenonry:run make it better", {}, { TENONRY_JEV_FIXTURE: fixture });
  assert.match(result.json.hookSpecificOutput.additionalContext, /clarify=yes/);
});

test("ignores prompts without /tenonry:run", () => {
  const root = makeProject();
  for (const prompt of ["hello", "please run /tenonry:run for me", "/tenonry:init", "/tenonry:runner x", ""]) {
    const result = route(root, prompt);
    assert.equal(result.status, 0, prompt);
    assert.equal(result.stdout, "", prompt);
  }
  assert.deepEqual(fs.existsSync(path.join(root, ".tenonry", "runs")), false);
});

test("ignores projects without config", () => {
  const root = makeProject();
  const plain = path.join(root, "..", `${path.basename(root)}-plain`);
  fs.mkdirSync(plain);
  const result = runNode(hook, [], { input: JSON.stringify({ cwd: plain, prompt: "/tenonry:run add x" }), env: CLEAN_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("ignores resume, continue, undo, help, status, and empty input in any case", () => {
  const root = makeProject();
  for (const argument of ["resume", "continue", "undo", "help", "status", "", "  ", "HELP", "Resume"]) {
    const result = route(root, `/tenonry:run ${argument}`);
    assert.equal(result.status, 0, argument);
    assert.equal(result.stdout, "", argument);
  }
  assert.equal(route(root, "/tenonry:run").stdout, "");
  assert.equal(fs.existsSync(path.join(root, ".tenonry", "runs")), false);
});

test("a request that merely starts with a keyword is a real request", () => {
  const root = makeProject();
  const result = route(root, "/tenonry:run help the customers find their orders", {}, { TENONRY_JEV_FIXTURE: writeFixture() });
  assert.ok(result.json);
});

test("never exits 2, whatever the input", () => {
  const root = makeProject();
  const inputs = ["", "not json", "{}", "[]", "null", '{"prompt":5}', '{"prompt":"/tenonry:run x","cwd":5}', '{"prompt":"/tenonry:run x","cwd":"/nonexistent"}', "x".repeat(100000)];
  for (const input of inputs) {
    const result = runNode(hook, [], { input, cwd: root, env: CLEAN_ENV });
    assert.notEqual(result.status, 2);
    assert.equal(result.status, 0);
  }
});

test("Haiku sessions set the notice; Sonnet and Opus do not", () => {
  for (const [model, notice] of [["claude-haiku-4-5-20251001", true], ["claude-sonnet-5-5", false], ["claude-opus-5-5", false]]) {
    const root = makeProject();
    const result = route(root, "/tenonry:run add x", { model }, { TENONRY_JEV_FIXTURE: writeFixture() });
    assert.equal(routeFile(root, runIdOf(result)).mainModel.notice, notice, model);
  }
});

test("reads the model from the transcript when the input has none", () => {
  const root = makeProject();
  const transcript = path.join(root, "t.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ message: { model: "claude-haiku-4-5-20251001" } }) + "\n");
  const result = route(root, "/tenonry:run add x", { transcript_path: transcript }, { TENONRY_JEV_FIXTURE: writeFixture() });
  assert.deepEqual(routeFile(root, runIdOf(result)).mainModel, { current: "haiku", notice: true });
});

test("falls back cleanly with no key", () => {
  const root = makeProject();
  const result = route(root, "/tenonry:run add x", { model: "claude-sonnet-5-5" });
  assert.equal(result.status, 0);
  assert.match(result.json.hookSpecificOutput.additionalContext, /clarify=auto/);
  const saved = routeFile(root, runIdOf(result));
  assert.equal(saved.jev, "fallback");
  assert.equal(saved.fallbackReason, "no_key");
  assert.equal(saved.clarify, "auto");
});

test("falls back when Jev is disabled or the fixture lacks the intake answers", () => {
  const root = makeProject();
  const disabled = route(root, "/tenonry:run add x", {}, { TENONRY_JEV_DISABLE: "1" });
  assert.equal(routeFile(root, runIdOf(disabled)).fallbackReason, "disabled");
  const broken = route(root, "/tenonry:run add y", {}, { TENONRY_JEV_FIXTURE: writeFixture({ intake: undefined }) });
  assert.equal(routeFile(root, runIdOf(broken)).fallbackReason, "invalid_response");
});

test("logs the intake decision without the key", () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, ".env"), "OPENROUTER_API_KEY=sk-or-never-logged\n");
  route(root, "/tenonry:run add x", {}, { TENONRY_JEV_DISABLE: "1" });
  const log = fs.readFileSync(path.join(root, ".tenonry", "logs", "jev-decisions.jsonl"), "utf8");
  assert.equal(JSON.parse(log.trim()).kind, "intake");
  assert.ok(!log.includes("sk-or-never-logged"));
});

test("extractRequest handles the typed command and the expanded skill text", () => {
  assert.equal(extractRequest("/tenonry:run add x"), "add x");
  assert.equal(extractRequest("  /tenonry:run   add   x  "), "add   x");
  assert.equal(extractRequest("/tenonry:run"), null);
  assert.equal(extractRequest("/tenonry:run undo"), null);
  assert.equal(extractRequest("hello"), null);
  assert.equal(extractRequest(undefined), null);
  const expanded = "TENONRY_RUN_SKILL\n\nYou are the Tenonry orchestrator. The user's input is: add a page\nwith two lines\n\n## Rules\n- x";
  assert.equal(extractRequest(expanded), "add a page\nwith two lines");
  assert.equal(extractRequest("TENONRY_RUN_SKILL\n\nThe user's input is: help\n\n## Rules"), null);
});

test("starting a second request stops the first unfinished run", () => {
  const root = makeProject();
  const first = runIdOf(route(root, "/tenonry:run one", {}, { TENONRY_JEV_DISABLE: "1" }));
  const second = runIdOf(route(root, "/tenonry:run two", {}, { TENONRY_JEV_DISABLE: "1" }));
  assert.notEqual(first, second);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".tenonry", "runs", first, "run.json"), "utf8")).phase, "stopped");
});

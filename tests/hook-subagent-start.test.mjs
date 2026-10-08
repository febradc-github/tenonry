import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runNode, script } from "./helpers/run.mjs";
import { makeProject, tempDir } from "./helpers/project.mjs";
import { MAP_HEADER } from "../scripts/lib/map.mjs";

const hook = script("hook-subagent-start.mjs");

function project(config = {}) {
  const root = makeProject({ config });
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "services", "points.ts"), "export function awardPoints() {}\n");
  return root;
}

const start = (root, agentType, extra = {}) =>
  runNode(hook, [], { input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: agentType, cwd: root, ...extra }), cwd: root });

test("0.5.0: a Tenonry builder starts with the codebase map", () => {
  const root = project();
  const result = start(root, "tenonry-vue");
  assert.equal(result.status, 0);
  assert.deepEqual(result.json, {
    hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: `${MAP_HEADER}\nsrc/services/: awardPoints` },
  });
});

test("0.5.0: the visual agents and other subagents get nothing", () => {
  const root = project();
  for (const agent of ["tenonry-art-director", "tenonry-design-reviewer", "Explore", undefined]) {
    const result = start(root, agent);
    assert.equal(result.status, 0, String(agent));
    assert.equal(result.stdout, "", String(agent));
  }
});

test("0.5.0: no output without a Tenonry project, with the map turned off, or with nothing to list", () => {
  const outside = tempDir();
  assert.equal(start(outside, "tenonry-vue").stdout, "");
  assert.equal(start(project({ codebaseMap: { enabled: false } }), "tenonry-vue").stdout, "");
  assert.equal(start(makeProject(), "tenonry-vue").stdout, "");
});

test("0.5.0: the project is found from CLAUDE_PROJECT_DIR when the input has no cwd", () => {
  const root = project();
  const result = runNode(hook, [], { input: JSON.stringify({ agent_type: "tenonry-planner" }), cwd: tempDir(), env: { CLAUDE_PROJECT_DIR: root } });
  assert.match(result.json.hookSpecificOutput.additionalContext, /awardPoints/);
});

test("0.5.0: the hook honors maxChars", () => {
  const root = project({ codebaseMap: { enabled: true, maxChars: 10 } });
  assert.equal(start(root, "tenonry-vue").stdout, "", "a budget too small for any line lists nothing");
});

test("0.5.0: invalid or missing stdin exits 0 silently", () => {
  for (const input of ["", "not json", "[]"]) {
    const result = runNode(hook, [], { input });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  }
});

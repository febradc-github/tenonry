import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { askJev, decideWithJev, fitState, validateAnswers, logPath, readDecisionLog } from "../scripts/lib/jev.mjs";
import { intakeQuestions, dispatchQuestions, riskQuestions, ownerQuestions } from "../scripts/lib/routing.mjs";
import { BASE_ANSWERS, answerWith, startServer, writeFixture } from "./helpers/jev.mjs";
import { makeProject } from "./helpers/project.mjs";

const KEY = "sk-or-test-key-123456";
let saved;

beforeEach(() => {
  saved = { ...process.env };
  delete process.env.TENONRY_JEV_DISABLE;
  delete process.env.TENONRY_JEV_FIXTURE;
  delete process.env.TENONRY_JEV_URL;
});
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

function projectWithKey(config = {}) {
  const root = makeProject({ config });
  fs.writeFileSync(path.join(root, ".env"), `OPENROUTER_API_KEY=${KEY}\n`);
  return root;
}

test("sends the documented request and returns validated answers", async () => {
  const server = await startServer(answerWith(BASE_ANSWERS.dispatch));
  try {
    process.env.TENONRY_JEV_URL = server.url;
    const root = projectWithKey();
    const questions = dispatchQuestions();
    const result = await askJev({ root, kind: "dispatch", state: { task: { title: "t" } }, questions });
    assert.equal(result.ok, true);
    assert.deepEqual(result.answers, BASE_ANSWERS.dispatch);
    assert.equal(result.cost, 0.00001);
    assert.ok(result.latencyMs >= 0);

    const [req] = server.requests;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/alpha/decisions");
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    assert.equal(req.headers["content-type"], "application/json");
    assert.deepEqual(Object.keys(req.body).sort(), ["model", "questions", "state"]);
    assert.equal(req.body.model, "typesafe/jev-1.13");
    assert.deepEqual(req.body.state, { task: { title: "t" } });
    assert.deepEqual(req.body.questions, questions);
  } finally {
    await server.close();
  }
});

test("uses the model pinned in config.routing.jevModel", async () => {
  const server = await startServer(answerWith(BASE_ANSWERS.dispatch));
  try {
    process.env.TENONRY_JEV_URL = server.url;
    const root = projectWithKey({ routing: { jevModel: "typesafe/jev-9.9", timeoutMs: 5000 } });
    await askJev({ root, kind: "dispatch", state: {}, questions: dispatchQuestions() });
    assert.equal(server.requests[0].body.model, "typesafe/jev-9.9");
  } finally {
    await server.close();
  }
});

test("a slow server produces timeout", async () => {
  const server = await startServer(() => {});
  try {
    process.env.TENONRY_JEV_URL = server.url;
    const root = projectWithKey();
    const result = await askJev({ root, kind: "dispatch", state: {}, questions: dispatchQuestions(), timeoutMs: 150 });
    assert.deepEqual(result, { ok: false, reason: "timeout" });
  } finally {
    await server.close();
  }
});

test("HTTP errors produce http_<status>", async () => {
  for (const status of [500, 401, 429]) {
    const server = await startServer((req, body, res) => {
      res.statusCode = status;
      res.end("{}");
    });
    try {
      process.env.TENONRY_JEV_URL = server.url;
      const result = await askJev({ root: projectWithKey(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
      assert.deepEqual(result, { ok: false, reason: `http_${status}` });
    } finally {
      await server.close();
    }
  }
});

test("malformed answers produce invalid_response", async () => {
  const bad = [
    "not json at all",
    JSON.stringify({}),
    JSON.stringify({ answers: {} }),
    JSON.stringify({ answers: { ...BASE_ANSWERS.dispatch, difficulty: { type: "noul", noul: 0.5 } } }),
    JSON.stringify({ answers: { ...BASE_ANSWERS.dispatch, fully_specified: { type: "noul", noul: "high" } } }),
    JSON.stringify({ answers: { ...BASE_ANSWERS.dispatch, blast_radius: { type: "score", score: 1 } } }),
  ];
  for (const payload of bad) {
    const server = await startServer((req, body, res) => res.end(payload));
    try {
      process.env.TENONRY_JEV_URL = server.url;
      const result = await askJev({ root: projectWithKey(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
      assert.deepEqual(result, { ok: false, reason: "invalid_response" }, payload);
    } finally {
      await server.close();
    }
  }
});

test("a choice answer outside the criteria is invalid", () => {
  const questions = ownerQuestions([{ agent: "tenonry-a", title: "A", owns: ["*.a"] }]);
  assert.equal(validateAnswers(questions, { owner: { type: "choice", choice: "tenonry-a", confidence: 0.9 } }), true);
  assert.equal(validateAnswers(questions, { owner: { type: "choice", choice: "tenonry-zzz", confidence: 0.9 } }), false);
  assert.equal(validateAnswers(questions, { owner: { type: "choice", choice: "tenonry-a" } }), false);
});

test("an unreachable server produces network", async () => {
  process.env.TENONRY_JEV_URL = "http://127.0.0.1:1/api/alpha/decisions";
  const result = await askJev({ root: projectWithKey(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
  assert.deepEqual(result, { ok: false, reason: "network" });
});

test("a missing key produces no_key and makes no request", async () => {
  const server = await startServer(answerWith(BASE_ANSWERS.dispatch));
  try {
    process.env.TENONRY_JEV_URL = server.url;
    const result = await askJev({ root: makeProject(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
    assert.deepEqual(result, { ok: false, reason: "no_key" });
    assert.equal(server.requests.length, 0);
    assert.deepEqual(await askJev({ root: null, kind: "x", state: {}, questions: {} }), { ok: false, reason: "no_key" });
  } finally {
    await server.close();
  }
});

test("a key in process.env is ignored", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-env";
  const result = await askJev({ root: makeProject(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
  assert.equal(result.reason, "no_key");
});

test("TENONRY_JEV_DISABLE=1 produces disabled", async () => {
  process.env.TENONRY_JEV_DISABLE = "1";
  const result = await askJev({ root: projectWithKey(), kind: "dispatch", state: {}, questions: dispatchQuestions() });
  assert.deepEqual(result, { ok: false, reason: "disabled" });
});

test("fixture mode returns fixture[kind] without a network call or key", async () => {
  process.env.TENONRY_JEV_FIXTURE = writeFixture();
  const result = await askJev({ root: makeProject(), kind: "risk", state: {}, questions: riskQuestions() });
  assert.deepEqual(result, { ok: true, answers: BASE_ANSWERS.risk, cost: 0, latencyMs: 0 });
});

test("fixture mode reports a missing kind or an unreadable fixture as invalid_response", async () => {
  process.env.TENONRY_JEV_FIXTURE = writeFixture({ dispatch: undefined });
  assert.deepEqual(await askJev({ root: makeProject(), kind: "dispatch", state: {}, questions: dispatchQuestions() }), { ok: false, reason: "invalid_response" });
  process.env.TENONRY_JEV_FIXTURE = "/nonexistent/fixture.json";
  assert.deepEqual(await askJev({ root: makeProject(), kind: "intake", state: {}, questions: intakeQuestions() }), { ok: false, reason: "invalid_response" });
});

test("the intake fixture validates against the intake questions", () => {
  assert.equal(validateAnswers(intakeQuestions(), BASE_ANSWERS.intake), true);
  assert.equal(validateAnswers(dispatchQuestions(), BASE_ANSWERS.dispatch), true);
  assert.equal(validateAnswers(riskQuestions(), BASE_ANSWERS.risk), true);
});

test("fitState truncates the longest strings until the state fits", () => {
  const state = { request: "a".repeat(5000), notes: ["b".repeat(3000), "short"], n: 1 };
  const fitted = fitState(state, 2000);
  assert.ok(JSON.stringify(fitted).length <= 2000);
  assert.ok(fitted.request.endsWith(" [truncated]"));
  assert.equal(fitted.notes[1], "short");
  assert.equal(fitted.n, 1);
  assert.equal(state.request.length, 5000, "input is not mutated");
  assert.deepEqual(fitState({ a: "x" }), { a: "x" });
  assert.ok(fitState("z".repeat(100), 50).endsWith(" [truncated]"));
});

test("an oversized state is truncated in the request body", async () => {
  const server = await startServer(answerWith(BASE_ANSWERS.dispatch));
  try {
    process.env.TENONRY_JEV_URL = server.url;
    await askJev({ root: projectWithKey(), kind: "dispatch", state: { big: "x".repeat(200000) }, questions: dispatchQuestions() });
    assert.ok(JSON.stringify(server.requests[0].body.state).length <= 60000);
    assert.ok(server.requests[0].body.state.big.endsWith(" [truncated]"));
  } finally {
    await server.close();
  }
});

test("decideWithJev logs one line per call, with the decision, and never the key", async () => {
  const server = await startServer(answerWith(BASE_ANSWERS.dispatch));
  try {
    process.env.TENONRY_JEV_URL = server.url;
    const root = projectWithKey();
    const ok = await decideWithJev({ root, kind: "dispatch", runId: "r-1", task: "T1", state: {}, questions: dispatchQuestions(), map: () => "haiku", fallback: () => "sonnet" });
    assert.equal(ok.decision, "haiku");
    process.env.TENONRY_JEV_DISABLE = "1";
    const failed = await decideWithJev({ root, kind: "dispatch", runId: "r-1", task: "T2", state: {}, questions: dispatchQuestions(), map: () => "haiku", fallback: (reason) => `fb-${reason}` });
    assert.equal(failed.decision, "fb-disabled");

    const lines = readDecisionLog(root);
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(lines[0]), ["ts", "runId", "task", "kind", "ok", "fallbackReason", "answers", "decision", "latencyMs", "cost"]);
    assert.deepEqual([lines[0].ok, lines[0].task, lines[0].decision, lines[0].fallbackReason], [true, "T1", "haiku", null]);
    assert.deepEqual([lines[1].ok, lines[1].task, lines[1].decision, lines[1].fallbackReason], [false, "T2", "fb-disabled", "disabled"]);
    assert.ok(!fs.readFileSync(logPath(root), "utf8").includes(KEY));
  } finally {
    await server.close();
  }
});

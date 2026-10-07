import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJson } from "./json.mjs";
import { openRouterKey } from "./env.mjs";
import { loadConfig, DEFAULT_ROUTING } from "./config.mjs";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MAX_STATE_CHARACTERS = 60000;
const TRUNCATION_SUFFIX = " [truncated]";
const MIN_TRUNCATABLE_LENGTH = 60;

export const logPath = (root) => path.join(root, ".tenonry", "logs", "jev-decisions.jsonl");

function collectStrings(value, found = []) {
  if (value === null || typeof value !== "object") return found;
  for (const key of Object.keys(value)) {
    if (typeof value[key] === "string") found.push({ holder: value, key, length: value[key].length });
    else collectStrings(value[key], found);
  }
  return found;
}

// Shrinks the longest string fields until the serialized state fits the model's context budget.
export function fitState(state, limit = MAX_STATE_CHARACTERS) {
  if (typeof state === "string") {
    return state.length <= limit ? state : state.slice(0, Math.max(0, limit - TRUNCATION_SUFFIX.length)) + TRUNCATION_SUFFIX;
  }
  const copy = structuredClone(state);
  while (JSON.stringify(copy).length > limit) {
    const longest = collectStrings(copy).sort((a, b) => b.length - a.length)[0];
    if (!longest || longest.length <= MIN_TRUNCATABLE_LENGTH) break;
    const keep = Math.max(MIN_TRUNCATABLE_LENGTH / 2, Math.floor(longest.length / 2));
    longest.holder[longest.key] = longest.holder[longest.key].slice(0, keep) + TRUNCATION_SUFFIX;
  }
  return copy;
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

function answerIsValid(question, answer) {
  if (typeof answer !== "object" || answer === null || answer.type !== question.type) return false;
  if (question.type === "noul") return isNumber(answer.noul);
  if (question.type === "choice") return typeof answer.choice === "string" && Object.hasOwn(question.criteria, answer.choice) && isNumber(answer.confidence);
  if (question.type === "score") return isNumber(answer.score) && isNumber(answer.confidence);
  return false;
}

export function validateAnswers(questions, answers) {
  if (typeof answers !== "object" || answers === null) return false;
  return Object.entries(questions).every(([id, question]) => answerIsValid(question, answers[id]));
}

function fromFixture(kind, questions) {
  try {
    const fixture = readJson(process.env.TENONRY_JEV_FIXTURE);
    const answers = fixture[kind];
    if (!answers) return { ok: false, reason: "invalid_response" };
    return validateAnswers(questions, answers) ? { ok: true, answers, cost: 0, latencyMs: 0 } : { ok: false, reason: "invalid_response" };
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
}

// Raw client. Never throws; failures come back as { ok: false, reason }.
export async function askJev({ root, kind, state, questions, timeoutMs }) {
  if (process.env.TENONRY_JEV_DISABLE === "1") return { ok: false, reason: "disabled" };
  if (process.env.TENONRY_JEV_FIXTURE) return fromFixture(kind, questions);

  const key = root ? openRouterKey(root) : null;
  if (!key) return { ok: false, reason: "no_key" };

  const routing = root ? loadConfig(root).routing : DEFAULT_ROUTING;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? routing.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(process.env.TENONRY_JEV_URL || ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: routing.jevModel, state: fitState(state), questions }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    const body = await response.json();
    if (!validateAnswers(questions, body?.answers)) return { ok: false, reason: "invalid_response" };
    return { ok: true, answers: body.answers, cost: isNumber(body.usage?.cost) ? body.usage.cost : 0, latencyMs: Date.now() - started };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: "timeout" };
    if (error instanceof SyntaxError) return { ok: false, reason: "invalid_response" };
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

// Asks Jev, maps the answers (or the fallback) to a decision, and logs one line (docs/03 section 4.9).
export async function decideWithJev({ root, kind, runId = null, task = null, state, questions, map, fallback, timeoutMs }) {
  const started = Date.now();
  const result = await askJev({ root, kind, state, questions, timeoutMs });
  const decision = result.ok ? map(result.answers) : fallback(result.reason);
  if (root) {
    appendJsonl(logPath(root), {
      ts: new Date().toISOString(),
      runId,
      task,
      kind,
      ok: result.ok,
      fallbackReason: result.ok ? null : result.reason,
      answers: result.ok ? result.answers : null,
      decision,
      latencyMs: result.latencyMs ?? Date.now() - started,
      cost: result.ok ? result.cost : 0,
    });
  }
  return { ok: result.ok, reason: result.ok ? null : result.reason, answers: result.ok ? result.answers : null, decision };
}

export function readDecisionLog(root) {
  try {
    return fs
      .readFileSync(logPath(root), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

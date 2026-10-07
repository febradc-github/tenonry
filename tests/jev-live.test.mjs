import { test } from "node:test";
import assert from "node:assert/strict";
import { askJev, validateAnswers } from "../scripts/lib/jev.mjs";
import { dispatchQuestions } from "../scripts/lib/routing.mjs";
import { openRouterKey } from "../scripts/lib/env.mjs";
import { repoRoot } from "./helpers/docs.mjs";

// One real call to the Decisions API. Opt-in: TENONRY_LIVE=1 and OPENROUTER_API_KEY in the repository's .env.
const hasKey = Boolean(openRouterKey(repoRoot));
const skip = process.env.TENONRY_LIVE !== "1" ? "set TENONRY_LIVE=1 to run the live Jev check" : !hasKey ? "no OPENROUTER_API_KEY in the repository .env" : false;

const STATE = {
  task: {
    title: "Points balance endpoint",
    summary: "Return the signed-in customer's loyalty points balance as JSON.",
    acceptance: ["GET /api/loyalty/balance returns 200 with {points: integer}.", "It returns 401 when unauthenticated."],
    files: ["app/Http/Controllers/LoyaltyController.php", "routes/api.php"],
    owner: "tenonry-laravel",
    layer: "backend",
  },
  interfaces: ["GET /api/loyalty/balance. Response 200: {\"points\": integer}. 401 when unauthenticated."],
  hasTests: true,
  fileCount: 2,
};

test("live: Jev answers the dispatch questions", { skip }, async () => {
  for (const name of ["TENONRY_JEV_DISABLE", "TENONRY_JEV_FIXTURE", "TENONRY_JEV_URL"]) delete process.env[name];
  const questions = dispatchQuestions();
  const result = await askJev({ root: repoRoot, kind: "dispatch", state: STATE, questions, timeoutMs: 20000 });

  // Print the outcome for the build report, never the key.
  const key = openRouterKey(repoRoot);
  const shown = JSON.stringify({ ok: result.ok, reason: result.reason, answers: result.answers, cost: result.cost, latencyMs: result.latencyMs });
  assert.ok(!shown.includes(key));
  console.log(`jev-live ${shown}`);

  assert.equal(result.ok, true, `Jev call failed: ${result.reason}`);
  assert.equal(validateAnswers(questions, result.answers), true);
  assert.equal(typeof result.cost, "number");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  TIERS, applyFloor, nextTier, mapIntake, fallbackIntake, mapDispatch, fallbackDispatch, mapOwner, mapRisk, fallbackRisk,
  currentModelFamily, runIntake, readRoute, ownerQuestions, riskQuestions, needsVisualReview, quickOwnerQuestions, intakeQuestions,
} from "../scripts/lib/routing.mjs";
import { DEFAULT_ROUTING } from "../scripts/lib/config.mjs";
import { BASE_ANSWERS, directIntake, quickIntake, answerIntake, dispatchAnswers, riskAnswers, writeFixture } from "./helpers/jev.mjs";
import { makeProject } from "./helpers/project.mjs";
import { newRun } from "../scripts/lib/state.mjs";

const thresholds = DEFAULT_ROUTING.thresholds;

test("tier helpers", () => {
  assert.deepEqual(TIERS, ["haiku", "sonnet", "opus"]);
  assert.equal(applyFloor("haiku", "sonnet"), "sonnet");
  assert.equal(applyFloor("opus", "sonnet"), "opus");
  assert.equal(applyFloor("haiku", "haiku"), "haiku");
  assert.equal(nextTier("haiku"), "sonnet");
  assert.equal(nextTier("sonnet"), "opus");
  assert.equal(nextTier("opus"), null);
});

test("intake: clarify yes at or above the ambiguity threshold, no below", () => {
  const answers = (noul) => ({ ...BASE_ANSWERS.intake, ambiguity: { type: "noul", noul } });
  assert.equal(mapIntake(answers(0.6), thresholds, "sonnet").clarify, "yes");
  assert.equal(mapIntake(answers(0.95), thresholds, "sonnet").clarify, "yes");
  assert.equal(mapIntake(answers(0.59), thresholds, "sonnet").clarify, "no");
});

test("intake maps difficulty, task type, and ui", () => {
  const mapped = mapIntake(BASE_ANSWERS.intake, thresholds, "opus");
  assert.deepEqual(mapped, {
    jev: "ok", fallbackReason: null, clarify: "no", plan: "yes", lane: "build", contractModel: "opus", design: "yes", difficulty: 1.1, difficultyConfidence: 0.85, taskType: "feature", ui: 0.9,
    mainModel: { current: "opus", notice: false },
  });
});

test("intake: plan no for a small, clear request; yes at or above the need threshold", () => {
  const plan = (needsPlan) => mapIntake(directIntake({ needsPlan }), thresholds, "sonnet").plan;
  assert.equal(plan(0.1), "no");
  assert.equal(plan(0.49), "no");
  assert.equal(plan(0.5), "yes");
  assert.equal(plan(0.95), "yes");
});

test("intake: a hard request is planned even when Jev says no plan is needed", () => {
  const plan = (difficulty) => mapIntake(directIntake({ needsPlan: 0.05, difficulty }), thresholds, "sonnet").plan;
  assert.equal(plan(1.99), "no");
  assert.equal(plan(2.0), "yes");
  assert.equal(plan(3), "yes");
});

test("intake: the planning thresholds are read from the config", () => {
  const always = { ...thresholds, planning: { ...thresholds.planning, minNeedsPlan: 0 } };
  assert.equal(mapIntake(directIntake({ needsPlan: 0 }), always, "sonnet").plan, "yes");
  const rarely = { ...thresholds, planning: { ...thresholds.planning, minNeedsPlan: 1.1 } };
  assert.equal(mapIntake(directIntake({ needsPlan: 1 }), rarely, "sonnet").plan, "no");
  assert.equal(mapIntake(directIntake({ needsPlan: 1, difficulty: 2.4 }), rarely, "sonnet").plan, "yes");
});

test("intake: the plan decision does not depend on the clarify decision", () => {
  const unclear = mapIntake({ ...directIntake(), ambiguity: { type: "noul", noul: 0.9 } }, thresholds, "sonnet");
  assert.deepEqual([unclear.clarify, unclear.plan], ["yes", "no"]);
});

test("intake fallback always plans, whatever the reason", () => {
  for (const reason of ["disabled", "no_key", "timeout", "http_500", "network", "invalid_response"]) assert.equal(fallbackIntake(reason, "sonnet").plan, "yes", reason);
});

test("0.4.0: the contract is written on sonnet exactly when the plan is skipped", () => {
  assert.equal(mapIntake(directIntake(), thresholds, "sonnet").contractModel, "sonnet");
  assert.equal(mapIntake(directIntake({ needsPlan: 0.5 }), thresholds, "sonnet").contractModel, "opus");
  assert.equal(mapIntake(directIntake({ difficulty: 2.0 }), thresholds, "sonnet").contractModel, "opus");
  assert.equal(fallbackIntake("no_key", "sonnet").contractModel, "opus");
});

test("0.4.0: design is no only when Jev says nothing new has to be designed", () => {
  const design = (newDesign) => mapIntake(directIntake({ newDesign }), thresholds, "sonnet").design;
  assert.equal(design(0.1), "no");
  assert.equal(design(0.49), "no");
  assert.equal(design(0.5), "yes");
  assert.equal(fallbackIntake("timeout", "sonnet").design, "yes");
  const never = { ...thresholds, design: { ...thresholds.design, minNewDesign: 0 } };
  assert.equal(mapIntake(directIntake({ newDesign: 0 }), never, "sonnet").design, "yes", "the knob turns the skip off");
});

test("0.4.0: a confident investigation is answered directly; anything else is built", () => {
  assert.equal(mapIntake(answerIntake(), thresholds, "sonnet").lane, "answer");
  assert.equal(mapIntake(answerIntake({ typeConfidence: 0.7 }), thresholds, "sonnet").lane, "answer");
  assert.equal(mapIntake(answerIntake({ typeConfidence: 0.69 }), thresholds, "sonnet").lane, "build");
  assert.equal(mapIntake(BASE_ANSWERS.intake, thresholds, "sonnet").lane, "build");
  assert.equal(fallbackIntake("no_key", "sonnet").lane, "build");
});

test("0.4.0: the quick lane needs a confident, easy, clear, non-ui mechanical change with no plan", () => {
  const lane = (options) => mapIntake(quickIntake(options), thresholds, "sonnet").lane;
  assert.equal(lane(), "quick");
  assert.equal(lane({ typeConfidence: 0.7, difficulty: 0.5, difficultyConfidence: 0.5, ui: 0.49, needsPlan: 0.49, ambiguity: 0.59 }), "quick", "every limit is inclusive on the safe side");
  assert.equal(lane({ type: "bugfix" }), "build", "only mechanical work");
  assert.equal(lane({ type: "feature" }), "build");
  assert.equal(lane({ typeConfidence: 0.69 }), "build", "Jev is not sure it is mechanical");
  assert.equal(lane({ difficulty: 0.51 }), "build", "not easy enough");
  assert.equal(lane({ difficultyConfidence: 0.49 }), "build", "Jev is not sure it is easy");
  assert.equal(lane({ ui: 0.5 }), "build", "interface changes keep their tests and design checks");
  assert.equal(lane({ needsPlan: 0.5 }), "build", "a planned request is never quick");
  assert.equal(lane({ ambiguity: 0.6 }), "build", "an unclear request is never quick");
  const off = { ...thresholds, quick: { ...thresholds.quick, maxDifficulty: -1 } };
  assert.equal(mapIntake(quickIntake(), off, "sonnet").lane, "build", "the knob turns the lane off");
});

test("0.4.0: the visual_change question is asked only when a design review is still undecided", () => {
  assert.deepEqual(Object.keys(riskQuestions()), ["risky", "blast_radius"]);
  assert.deepEqual(Object.keys(riskQuestions({ visual: true })), ["visual_change", "risky", "blast_radius"]);
  assert.equal(mapRisk(BASE_ANSWERS.risk, thresholds).visualChange, null, "an answer that was not asked for is ignored");
  assert.equal(mapRisk(BASE_ANSWERS.risk, thresholds, { visual: true }).visualChange, 0.9);
  assert.equal(fallbackRisk().visualChange, null);
});

test("0.4.0: needsVisualReview is true for a new screen, without an answer, and at the threshold", () => {
  const decision = (visualChange) => ({ visualChange });
  assert.equal(needsVisualReview(decision(0.49), thresholds), false);
  assert.equal(needsVisualReview(decision(0.5), thresholds), true);
  assert.equal(needsVisualReview(decision(null), thresholds), true);
  assert.equal(needsVisualReview(decision(0), thresholds, { newScreen: true }), true);
});

test("0.4.0: code review model: haiku only for a trivial, safe change", () => {
  const model = (risky, blast, confidence, trivial) => mapRisk(riskAnswers(risky, blast, confidence), thresholds, { trivial }).model;
  assert.equal(model(0.1, 0.4, 0.9, true), "haiku");
  assert.equal(model(0.2, 0.5, 0.5, true), "haiku");
  assert.equal(model(0.1, 0.4, 0.9, false), "sonnet");
  assert.equal(model(0.21, 0.4, 0.9, true), "sonnet");
  assert.equal(model(0.1, 0.51, 0.9, true), "sonnet");
  assert.equal(model(0.1, 0.4, 0.49, true), "sonnet");
  assert.equal(model(0.5, 0.1, 0.9, true), "opus");
  assert.equal(model(0.1, 1.5, 0.9, true), "opus");
});

test("0.4.0: the quick owner question lists every candidate like the owner question", () => {
  const candidates = [{ agent: "tenonry-x", title: "X specialist", owns: ["a", "b"] }, { agent: "tenonry-y", title: "Y specialist", owns: ["c"] }];
  const { owner } = quickOwnerQuestions(candidates);
  assert.equal(owner.type, "choice");
  assert.deepEqual(owner.criteria, { "tenonry-x": "X specialist. Owns: a, b", "tenonry-y": "Y specialist. Owns: c" });
  assert.deepEqual(Object.keys(intakeQuestions()), ["ambiguity", "difficulty", "needs_plan", "task_type", "ui", "new_design"]);
});

test("the Haiku notice is on for haiku and off for sonnet, opus, fable, and unknown", () => {
  for (const [family, notice] of [["haiku", true], ["sonnet", false], ["opus", false], ["fable", false], ["unknown", false]]) {
    assert.equal(mapIntake(BASE_ANSWERS.intake, thresholds, family).mainModel.notice, notice, family);
    assert.equal(fallbackIntake("no_key", family).mainModel.notice, notice, family);
  }
});

test("intake fallback asks the clarify skill to decide", () => {
  assert.deepEqual(fallbackIntake("timeout", "sonnet"), {
    jev: "fallback", fallbackReason: "timeout", clarify: "auto", plan: "yes", lane: "build", contractModel: "opus", design: "yes", difficulty: null, difficultyConfidence: null, taskType: null, ui: null,
    mainModel: { current: "sonnet", notice: false },
  });
});

test("dispatch picks haiku when fully specified, easy, and contained", () => {
  const { model, reason } = mapDispatch(dispatchAnswers(), thresholds, "haiku");
  assert.equal(model, "haiku");
  assert.equal(reason, "jev difficulty=0.30(c0.90) specified=0.92 blast=0.20(c0.90) -> haiku");
});

test("dispatch haiku boundaries are inclusive", () => {
  assert.equal(mapDispatch(dispatchAnswers({ specified: 0.8, difficulty: 0.6, blast: 0.5 }), thresholds, "haiku").model, "haiku");
  assert.equal(mapDispatch(dispatchAnswers({ specified: 0.79 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 0.61 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ blast: 0.51 }), thresholds, "haiku").model, "sonnet");
});

test("dispatch picks opus by difficulty", () => {
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 2.0, specified: 0.1 }), thresholds, "haiku").model, "opus");
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.99, specified: 0.1 }), thresholds, "haiku").model, "sonnet");
});

test("0.3.1: a wide blast radius alone never picks opus", () => {
  for (const blast of [1.0, 1.5, 2.0]) {
    assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.0, specified: 0.1, blast }), thresholds, "haiku").model, "sonnet", String(blast));
    assert.equal(mapDispatch(dispatchAnswers({ difficulty: 0.2, specified: 0.95, blast }), thresholds, "haiku").model, "sonnet", `easy, ${blast}`);
  }
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 2.0, specified: 0.1, blast: 2.0 }), thresholds, "haiku").model, "opus", "a complex task is still opus");
});

test("0.3.1: a retired opus.minBlastRadius left in a config is ignored", () => {
  const stale = { ...thresholds, opus: { minDifficulty: 2.0, minBlastRadius: 0.1 } };
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.0, specified: 0.1, blast: 1.9 }), stale, "haiku").model, "sonnet");
});

test("dispatch picks sonnet in the middle", () => {
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.2, specified: 0.5, blast: 1.0 }), thresholds, "haiku").model, "sonnet");
});

test("0.3.1: low confidence lifts haiku to sonnet and never lifts sonnet to opus", () => {
  assert.equal(mapDispatch(dispatchAnswers({ difficultyConfidence: 0.4 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ blastConfidence: 0.49 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ difficultyConfidence: 0.5 }), thresholds, "haiku").model, "haiku");
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.2, specified: 0.5, blast: 1.0, difficultyConfidence: 0.3 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 1.2, specified: 0.5, blast: 1.0, difficultyConfidence: 0.01, blastConfidence: 0.01 }), thresholds, "haiku").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers({ difficulty: 2.5, difficultyConfidence: 0.1 }), thresholds, "haiku").model, "opus", "a complex task stays on opus whatever the confidence");
});

test("0.3.1: the simple task that reached opus in a real run now gets sonnet", () => {
  // Logged answers for "create one small formatting module": easy, but Jev was unsure about the blast radius.
  const logged = dispatchAnswers({ difficulty: 0.52, difficultyConfidence: 0.52, specified: 0.9, blast: 0.67, blastConfidence: 0.34 });
  assert.deepEqual(mapDispatch(logged, thresholds, "haiku"), { model: "sonnet", reason: "jev difficulty=0.52(c0.52) specified=0.90 blast=0.67(c0.34) -> sonnet", difficulty: 0.52 });
});

test("0.3.1: every path to opus needs a complex task", () => {
  for (const difficulty of [0, 0.5, 1, 1.5, 1.99]) {
    for (const specified of [0, 0.5, 1]) {
      for (const blast of [0, 1, 2]) {
        for (const confidence of [0, 0.3, 0.9]) {
          const answers = dispatchAnswers({ difficulty, specified, blast, difficultyConfidence: confidence, blastConfidence: confidence });
          assert.notEqual(mapDispatch(answers, thresholds, "sonnet").model, "opus", JSON.stringify({ difficulty, specified, blast, confidence }));
        }
      }
    }
  }
});

test("model floors apply after rounding", () => {
  assert.equal(mapDispatch(dispatchAnswers(), thresholds, "sonnet").model, "sonnet");
  assert.equal(mapDispatch(dispatchAnswers(), thresholds, "opus").model, "opus");
  const floored = mapDispatch(dispatchAnswers(), thresholds, "sonnet");
  assert.match(floored.reason, /-> sonnet$/);
});

test("dispatch fallback is sonnet with the floor applied", () => {
  assert.deepEqual(fallbackDispatch("timeout", "haiku"), { model: "sonnet", reason: "fallback timeout -> sonnet", difficulty: null });
  assert.deepEqual(fallbackDispatch("no_key", "opus"), { model: "opus", reason: "fallback no_key -> opus", difficulty: null });
});

test("owner is accepted at or above the minimum confidence", () => {
  const answers = (confidence) => ({ owner: { type: "choice", choice: "tenonry-vue", confidence } });
  assert.deepEqual(mapOwner(answers(0.5), thresholds), { owner: "tenonry-vue", confidence: 0.5, accepted: true });
  assert.equal(mapOwner(answers(0.49), thresholds).accepted, false);
});

test("risk: opus when risky or wide, sonnet otherwise, opus on fallback", () => {
  assert.equal(mapRisk(riskAnswers(0.5, 0.2), thresholds).model, "opus");
  assert.equal(mapRisk(riskAnswers(0.1, 1.5), thresholds).model, "opus");
  assert.equal(mapRisk(riskAnswers(0.49, 1.49), thresholds).model, "sonnet");
  assert.equal(mapRisk(BASE_ANSWERS.risk, thresholds).model, "sonnet");
  assert.equal(fallbackRisk().model, "opus");
});

test("owner questions list every candidate with its first six globs", () => {
  const questions = ownerQuestions([{ agent: "tenonry-x", title: "X specialist", owns: ["a", "b", "c", "d", "e", "f", "g"] }]);
  assert.equal(questions.owner.criteria["tenonry-x"], "X specialist. Owns: a, b, c, d, e, f");
});

test("model family comes from input.model in any supported shape", () => {
  assert.equal(currentModelFamily({ model: "claude-opus-5-5" }), "opus");
  assert.equal(currentModelFamily({ model: "claude-sonnet-5-5[1m]" }), "sonnet");
  assert.equal(currentModelFamily({ model: "claude-haiku-4-5-20251001" }), "haiku");
  assert.equal(currentModelFamily({ model: "claude-fable-5-1" }), "fable");
  assert.equal(currentModelFamily({ model: { id: "claude-haiku-4-5" } }), "haiku");
  assert.equal(currentModelFamily({ model: { display_name: "Sonnet 5.5" } }), "sonnet");
  assert.equal(currentModelFamily({ model: "mystery" }), "unknown");
  assert.equal(currentModelFamily({}), "unknown");
  assert.equal(currentModelFamily(null), "unknown");
});

test("model family falls back to the newest model in the transcript tail", () => {
  const root = makeProject();
  const transcript = path.join(root, "t.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user" } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } }),
    JSON.stringify({ type: "assistant", message: { model: "<synthetic>" } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-haiku-4-5-20251001" } }),
    JSON.stringify({ type: "user", message: { role: "user" } }),
  ];
  fs.writeFileSync(transcript, lines.join("\n") + "\n");
  assert.equal(currentModelFamily({ transcript_path: transcript }), "haiku");
  assert.equal(currentModelFamily({ model: "", transcript_path: transcript }), "haiku");
  assert.equal(currentModelFamily({ model: "claude-sonnet-5-5", transcript_path: transcript }), "sonnet");
  assert.equal(currentModelFamily({ transcript_path: path.join(root, "missing.jsonl") }), "unknown");
});

test("the transcript fallback reads only the tail of a large file", () => {
  const root = makeProject();
  const transcript = path.join(root, "big.jsonl");
  const filler = JSON.stringify({ type: "user", message: { text: "x".repeat(1000) } }) + "\n";
  fs.writeFileSync(transcript, JSON.stringify({ message: { model: "claude-opus-5-5" } }) + "\n" + filler.repeat(400) + JSON.stringify({ message: { model: "claude-sonnet-5-5" } }) + "\n");
  assert.equal(currentModelFamily({ transcript_path: transcript }), "sonnet");
});

test("runIntake writes route.json from a fixture", async () => {
  const previous = process.env.TENONRY_JEV_FIXTURE;
  process.env.TENONRY_JEV_FIXTURE = writeFixture();
  try {
    const root = makeProject();
    const { runId } = newRun(root, "add points");
    const route = await runIntake(root, runId, "add points", "haiku");
    assert.deepEqual(readRoute(root, runId), route);
    assert.equal(route.runId, runId);
    assert.equal(route.prompt, "add points");
    assert.equal(route.jev, "ok");
    assert.equal(route.clarify, "no");
    assert.equal(route.plan, "yes");
    assert.equal(route.mainModel.notice, true);
    assert.deepEqual(route.answers, BASE_ANSWERS.intake);
  } finally {
    if (previous === undefined) delete process.env.TENONRY_JEV_FIXTURE;
    else process.env.TENONRY_JEV_FIXTURE = previous;
  }
});

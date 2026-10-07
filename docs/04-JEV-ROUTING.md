# 04. Jev routing

Jev answers narrow typed questions. Tenonry asks five question sets, at five fixed points, and maps the probabilities to decisions in plain code. Request and response formats are in `docs/02-PLATFORM-REFERENCE.md` section 1.4; the client is `scripts/lib/jev.mjs`.

## 1. Common rules

- Model: `config.routing.jevModel` (default `typesafe/jev-1.13`, pinned so thresholds stay stable).
- Timeout: `config.routing.timeoutMs` (default 8000).
- Key: `OPENROUTER_API_KEY` from `<project>/.env` only.
- Thresholds: `config.routing.thresholds` (defaults in `docs/03-COMPONENT-SPECS.md` section 4.1).
- Tier order: `haiku` < `sonnet` < `opus`. "Round up" means a `haiku` choice becomes `sonnet`; it never produces `opus`. "Apply floor" means `max(tier, modelFloor)`.
- Every call and every resulting decision is logged (section 7).

## 2. Shared criteria text

Difficulty levels (Score, lowest first). Labels used in messages are the text before the colon.

```json
[
  "Trivial: a small mechanical change in one place, such as a rename, copy edit, or config value.",
  "Routine: a standard feature or fix that follows patterns already in the codebase.",
  "Hard: new design decisions, changes across several modules, or tricky logic and edge cases.",
  "Frontier: novel architecture, security-critical or concurrency-heavy work, or a large migration."
]
```

Blast radius levels (Score, lowest first):

```json
[
  "Contained: one file or a leaf component that nothing else depends on.",
  "Local: one module or feature.",
  "Wide: shared code, public interfaces, or data used by many modules."
]
```

## 3. Intake (once per `/tenonry:run` request, from the hook or `tenonry.mjs intake`)

State:

```json
{
  "request": "<request text, at most 6000 characters>",
  "stack": ["<active specialist ids>"],
  "packageCount": 1
}
```

Questions:

```json
{
  "ambiguity": {
    "type": "noul",
    "instructions": "Would a competent engineer working in this repository need to ask the requester questions before building this, because scope, expected behavior, or success criteria are missing and cannot reasonably be inferred?",
    "criteria": {
      "true": "Key scope, behavior, or acceptance details are missing or contradictory.",
      "false": "The request is specific enough to plan and build, using reasonable defaults where needed."
    }
  },
  "difficulty": {
    "type": "score",
    "instructions": "How difficult is this request to implement well in this stack?",
    "criteria": "<difficulty levels from section 2>"
  },
  "needs_plan": {
    "type": "noul",
    "instructions": "Does this request need a written product plan (scope, user stories, behavior rules, and acceptance criteria) before engineers can split it into tasks and tests, or is it small and clear enough to build directly from the request?",
    "criteria": {
      "true": "Several behaviors, screens, roles, or modules must be worked out and agreed before the work can be split up.",
      "false": "A small or well-understood change: the request itself says what to build, and an engineer could go straight to the tasks and tests."
    }
  },
  "task_type": {
    "type": "choice",
    "instructions": "What kind of work is this request?",
    "criteria": {
      "mechanical": "Renames, copy edits, config tweaks, dependency bumps.",
      "bugfix": "Fixing incorrect existing behavior.",
      "feature": "Adding new user-facing or API behavior.",
      "refactor": "Restructuring code without changing behavior.",
      "architecture": "Changing system structure, data models, or cross-cutting design.",
      "investigation": "Analysis or research with little or no code change.",
      "ui_design": "Primarily the visual or interaction design of screens."
    }
  },
  "ui": {
    "type": "noul",
    "instructions": "Does this request create or visibly change a user interface: screens, layouts, components, styles, or 3D scenes?",
    "criteria": {
      "true": "Users will see new or changed interface elements.",
      "false": "Only behavior, data, APIs, tooling, or infrastructure change."
    }
  },
  "new_design": {
    "type": "noul",
    "instructions": "Does this request need new visual design decisions, such as a new screen, a new kind of component, a new layout, or a change to the look and feel? Or can it be built entirely with the interface's existing look?",
    "criteria": {
      "true": "Something has to be designed: a new screen or component, a new layout, or a changed visual style.",
      "false": "Nothing new to design: no interface change, or only text, a field or option added to an existing form or list, or existing elements shown, hidden, or reordered."
    }
  }
}
```

Mapping:

| Output | Rule |
|---|---|
| `clarify` | `yes` when `ambiguity.noul >= clarifyIfAmbiguity`, else `no`. Jev failed: `auto` |
| `plan` | `yes` when `needs_plan.noul >= planning.minNeedsPlan` or `difficulty.score >= planning.minDifficulty`, else `no`. Jev failed: `yes` |
| `lane` | `answer` when `task_type.choice` is `investigation` and `task_type.confidence >= answer.minConfidence`. Else `quick` when every one of these holds: `task_type.choice` is `mechanical`, `task_type.confidence >= quick.minConfidence`, `plan` is `no`, `clarify` is `no`, `difficulty.score <= quick.maxDifficulty`, `difficulty.confidence >= roundUpIfConfidenceBelow`, and `ui.noul < planning.minUi`. Else `build`. Jev failed: `build` |
| `contractModel` | `sonnet` when `plan` is `no`, else `opus`. Jev failed: `opus` |
| `design` | `yes` when `new_design.noul >= design.minNewDesign`, else `no`. Jev failed: `yes` |
| `difficulty`, `difficultyConfidence` | `difficulty.score`, `difficulty.confidence` |
| `taskType` | `task_type.choice` |
| `ui` | `ui.noul` (informational for the planner; on a direct run it decides the design step, see below) |
| `mainModel.current` | the main session's model family (not a Jev answer; see `docs/03-COMPONENT-SPECS.md` section 8.2) |
| `mainModel.notice` | true when the family is `haiku`. Nothing is ever blocked |

`plan: no` makes the run a direct run: the `run` skill skips the planner (an Opus agent) and `tenonry.mjs direct-plan` writes `plan.md` from the brief in plain code, so the test author goes straight to the contract and tests. The difficulty clause is a safety net: a request Jev scores as Hard or above is always planned, whatever `needs_plan` says. On a direct run no planner exists to set `ui`, so `direct-plan` sets `ui: yes` when `ui.noul >= planning.minUi`. Setting `planning.minNeedsPlan` to 0 plans every request; setting it above 1 leaves only the difficulty clause.

What the other three outputs do:

- `lane: answer`: the request is a question. The `run` skill answers it in the main session, changes no file, and closes the run; no agent is spawned. A request Jev is not confident about is built, because answering a change request would silently do nothing.
- `lane: quick`: a small mechanical change outside the interface. `tenonry.mjs quick-contract` (section 11) writes a one-task contract in plain code and the test author is not spawned, so no new tests are written. Every condition must hold; a request that fails any one of them takes the normal path. `quick.maxDifficulty: -1` turns the lane off.
- `contractModel`: the model the test author runs on. A request that needed no plan gets its contract and tests written on Sonnet.
- `design: no`: nothing new has to be designed. When the project already has a design direction, `tenonry.mjs design-check` skips the art director and writes a brief that says to apply the existing look. Without a design direction the art director always runs, because there is no look to apply yet. `design.minNewDesign: 0` turns the skip off.

## 4. Dispatch (`tenonry.mjs next`, once per task start without a set tier)

State:

```json
{
  "task": { "title": "", "summary": "", "acceptance": [], "files": [], "owner": "tenonry-x", "layer": "backend" },
  "interfaces": ["<definition text of each interface the task references>"],
  "hasTests": true,
  "fileCount": 3
}
```

Questions:

```json
{
  "difficulty": {
    "type": "score",
    "instructions": "How difficult is this task for a capable engineer who owns these files?",
    "criteria": "<difficulty levels from section 2>"
  },
  "fully_specified": {
    "type": "noul",
    "instructions": "Do the task, its files, and its acceptance criteria fully specify what to build, so the work is mainly executing clear instructions?",
    "criteria": {
      "true": "Exact files, behavior, and acceptance criteria are given; little judgment is needed.",
      "false": "Meaningful design or behavior decisions remain open."
    }
  },
  "blast_radius": {
    "type": "score",
    "instructions": "How far could a mistake in this task spread through the codebase?",
    "criteria": "<blast radius levels from section 2>"
  }
}
```

Mapping, in order:

1. `haiku` when `fully_specified.noul >= haiku.minFullySpecified` and `difficulty.score <= haiku.maxDifficulty` and `blast_radius.score <= haiku.maxBlastRadius`.
2. Else `opus` when `difficulty.score >= opus.minDifficulty`.
3. Else `sonnet`.
4. Round up when `difficulty.confidence < roundUpIfConfidenceBelow` or `blast_radius.confidence < roundUpIfConfidenceBelow`: a `haiku` choice becomes `sonnet`. A `sonnet` choice stays `sonnet`.
5. Apply the owner's `modelFloor`.

Opus builds only complex tasks. A builder reaches `opus` in two ways: Jev scores the task as Hard or above (step 2), or the task failed its checks `maxTestRetriesPerTier` times on `sonnet` and escalated (`docs/03-COMPONENT-SPECS.md` section 6.2). Low confidence and a wide blast radius never choose `opus` for a builder: neither says the work is difficult, and the risk of a wide change is covered by the code reviewer's model (section 6). No catalog specialist has an `opus` floor.

Reason string returned by `next`: `jev difficulty=<s>(c<conf>) specified=<p> blast=<s>(c<conf>) -> <model>`, numbers to 2 decimals. Fallback: `fallback <reason> -> <model>`.

## 5. Unowned file (`tenonry.mjs owner`, only when ownership rules give no owner)

State:

```json
{
  "path": "src/shared/formatPoints.ts",
  "purpose": "<--purpose text, or the requesting task's summary>",
  "siblings": [ { "path": "src/shared/formatDate.ts", "owner": "tenonry-typescript" } ]
}
```

`siblings`: up to 10 files in the same directory, each with its resolved owner (omit unowned ones).

Question:

```json
{
  "owner": {
    "type": "choice",
    "instructions": "Which specialist should own this file, based on its path, its purpose, and who owns the files around it?",
    "criteria": { "tenonry-<id>": "<title>. Owns: <first 6 owns globs, comma-separated>" }
  }
}
```

One criteria entry per active builder specialist. Accept when `owner.confidence >= newFileOwnerMinConfidence`.

## 6. Review risk (`tenonry.mjs review-plan`, once per review round)

State: see `docs/03-COMPONENT-SPECS.md` section 6.4.

Questions (`visual_change` is asked only for a `ui` task whose design review is still undecided and which is not a new screen):

```json
{
  "visual_change": {
    "type": "noul",
    "instructions": "Does this change alter how the interface looks or is laid out, so that someone has to see it rendered in a browser to judge it: layout, spacing, color, typography, imagery, motion, or a new or restructured component or screen?",
    "criteria": {
      "true": "The rendered layout or styling changes.",
      "false": "Only text content, data wiring, behavior, or logic changes; layout and styling stay as they are."
    }
  },
  "risky": {
    "type": "noul",
    "instructions": "Does this change touch authentication, authorization, payments, personal data, secrets, database schema or migrations, concurrency, or the handling of untrusted input?",
    "criteria": {
      "true": "At least one of those sensitive areas is affected.",
      "false": "None of those sensitive areas is affected."
    }
  },
  "blast_radius": {
    "type": "score",
    "instructions": "How far could a mistake in this change spread through the codebase?",
    "criteria": "<blast radius levels from section 2>"
  }
}
```

Mapping, code reviewer model, in order:

1. `opus` when `risky.noul >= codeReviewOpus.minRisky` or `blast_radius.score >= codeReviewOpus.minBlastRadius`.
2. Else `haiku` when the task is trivial and `risky.noul <= codeReviewHaiku.maxRisky` and `blast_radius.score <= codeReviewHaiku.maxBlastRadius` and `blast_radius.confidence >= roundUpIfConfidenceBelow`. A task is trivial when its dispatch difficulty (recorded by `next`) is a number at or below `codeReviewHaiku.maxDifficulty`, it has had exactly one attempt with no failed verification, and this is its first code review round.
3. Else `sonnet`.

Every task is still reviewed; only the reviewer's model changes. A fix round, a task that needed a second attempt, and a task whose difficulty is unknown are reviewed on `sonnet` or higher. `codeReviewHaiku.maxDifficulty: -1` turns the lighter review off.

Mapping, design reviewer, for a `ui` task when the design reviewer agent exists: it runs when the task is a new screen, when Jev is unavailable, or when `visual_change.noul >= design.minVisualChange`. Otherwise it is skipped and the task gets the note `skipped design review: the change does not alter layout or styling`. The decision is made in the task's first review round and kept for later rounds. The code reviewer still checks the UI rules on a skipped task. `design.minVisualChange: 0` turns the skip off.

## 7. Fallbacks

| Point | Jev unavailable (`disabled`, `no_key`, `timeout`, `http_*`, `network`, `invalid_response`) |
|---|---|
| Intake | `clarify: "auto"`, `plan: "yes"`, `lane: "build"`, `contractModel: "opus"`, `design: "yes"` |
| Dispatch | `sonnet`, then apply floor |
| Unowned file | extension heuristic (`docs/03-COMPONENT-SPECS.md` section 6.6 step 3) |
| Review risk | code reviewer on `opus`; the design reviewer runs for every `ui` task |
| Quick owner | `quick-contract` returns `ok: false` and the test author writes the contract |

Low confidence is not a failure: the answer is used and the round-up rule applies.

## 8. Logging and calibration

- Every `askJev` call appends a decision line to `.tenonry/logs/jev-decisions.jsonl` (schema in `docs/03-COMPONENT-SPECS.md` section 4.9), including fallbacks.
- `verify` appends an outcome line for every attempt.
- `tenonry.mjs calibrate` turns the log into pass rates per model and difficulty bucket, with threshold suggestions. Thresholds change only when a user edits `config.json`.

## 9. Fixtures for tests

`TENONRY_JEV_FIXTURE=<path>` makes `askJev` return `fixture[kind]` without a network call. Fixture shape:

```json
{
  "intake": {
    "ambiguity": { "type": "noul", "noul": 0.2 },
    "difficulty": { "type": "score", "score": 1.1, "confidence": 0.85, "probabilities": { "0": 0.05, "1": 0.8, "2": 0.15, "3": 0 } },
    "needs_plan": { "type": "noul", "noul": 0.8 },
    "task_type": { "type": "choice", "choice": "feature", "confidence": 0.8, "probabilities": { "feature": 0.9 } },
    "ui": { "type": "noul", "noul": 0.9 },
    "new_design": { "type": "noul", "noul": 0.8 }
  },
  "dispatch": {
    "difficulty": { "type": "score", "score": 0.3, "confidence": 0.9 },
    "fully_specified": { "type": "noul", "noul": 0.92 },
    "blast_radius": { "type": "score", "score": 0.2, "confidence": 0.9 }
  },
  "owner": {
    "owner": { "type": "choice", "choice": "tenonry-typescript", "confidence": 0.7, "probabilities": { "tenonry-typescript": 0.8 } }
  },
  "risk": {
    "risky": { "type": "noul", "noul": 0.1 },
    "blast_radius": { "type": "score", "score": 0.4, "confidence": 0.9 },
    "visual_change": { "type": "noul", "noul": 0.9 }
  },
  "quick": {
    "owner": { "type": "choice", "choice": "tenonry-laravel", "confidence": 0.8, "probabilities": { "tenonry-laravel": 0.8 } }
  }
}
```

Tests must include fixtures that exercise every mapping branch: haiku, sonnet, opus by difficulty, sonnet for a wide blast radius, round-up from haiku by low confidence, no round-up from sonnet, floors, clarify yes and no, plan yes by need, plan yes by difficulty, plan no, the Haiku notice on and off, owner accepted, owner rejected for low confidence, risky opus, the three lanes and each condition that keeps a request out of the quick lane, the contract model, design yes and no, the haiku code review and each condition that keeps it on sonnet, the design review skipped and kept, quick owner accepted and rejected, and every fallback reason.

## 10. Live check (opt-in)

`tests/jev-live.test.mjs` makes one real call with the dispatch question set of section 4 and a small fixed task state. It runs only when `TENONRY_LIVE=1` is set and the repository's own `.env` contains a non-empty `OPENROUTER_API_KEY`; a normal `node --test` run skips it and needs no network. It asserts `ok: true`, that the answers pass the client's own validation, and that `cost` is a number, and it prints the answers and cost but never the key. Run it with `TENONRY_LIVE=1 node --test tests/jev-live.test.mjs`.

## 11. Quick change owner (`tenonry.mjs quick-contract`, at most once per quick run)

Asked only when `route.json` has `lane: quick` and more than one builder specialist is active. With exactly one active specialist that specialist is the owner and Jev is not asked.

State:

```json
{
  "request": "<request text, at most 6000 characters>",
  "stack": ["<active specialist ids>"]
}
```

Question:

```json
{
  "owner": {
    "type": "choice",
    "instructions": "Which specialist should make this change, based on the request and the files each specialist owns?",
    "criteria": { "tenonry-<id>": "<title>. Owns: <first 6 owns globs, comma-separated>" }
  }
}
```

Accept when `owner.confidence >= newFileOwnerMinConfidence`. The decision is logged with kind `quick`. If the change turns out to need a file another specialist owns, the builder reports `needs_owner` and `handoff` adds a follow-up task, as on any run.

# 04. Jev routing

Jev answers narrow typed questions. Tenonry asks four question sets, at four fixed points, and maps the probabilities to decisions in plain code. Request and response formats are in `docs/02-PLATFORM-REFERENCE.md` section 1.4; the client is `scripts/lib/jev.mjs`.

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
  }
}
```

Mapping:

| Output | Rule |
|---|---|
| `clarify` | `yes` when `ambiguity.noul >= clarifyIfAmbiguity`, else `no`. Jev failed: `auto` |
| `plan` | `yes` when `needs_plan.noul >= planning.minNeedsPlan` or `difficulty.score >= planning.minDifficulty`, else `no`. Jev failed: `yes` |
| `difficulty`, `difficultyConfidence` | `difficulty.score`, `difficulty.confidence` |
| `taskType` | `task_type.choice` |
| `ui` | `ui.noul` (informational for the planner; on a direct run it decides the design step, see below) |
| `mainModel.current` | the main session's model family (not a Jev answer; see `docs/03-COMPONENT-SPECS.md` section 8.2) |
| `mainModel.notice` | true when the family is `haiku`. Nothing is ever blocked |

`plan: no` makes the run a direct run: the `run` skill skips the planner (an Opus agent) and `tenonry.mjs direct-plan` writes `plan.md` from the brief in plain code, so the test author goes straight to the contract and tests. The difficulty clause is a safety net: a request Jev scores as Hard or above is always planned, whatever `needs_plan` says. On a direct run no planner exists to set `ui`, so `direct-plan` sets `ui: yes` when `ui.noul >= planning.minUi`. Setting `planning.minNeedsPlan` to 0 plans every request; setting it above 1 leaves only the difficulty clause.

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

Questions:

```json
{
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

Mapping: code reviewer on `opus` when `risky.noul >= codeReviewOpus.minRisky` or `blast_radius.score >= codeReviewOpus.minBlastRadius`; otherwise `sonnet`.

## 7. Fallbacks

| Point | Jev unavailable (`disabled`, `no_key`, `timeout`, `http_*`, `network`, `invalid_response`) |
|---|---|
| Intake | `clarify: "auto"`, `plan: "yes"` |
| Dispatch | `sonnet`, then apply floor |
| Unowned file | extension heuristic (`docs/03-COMPONENT-SPECS.md` section 6.6 step 3) |
| Review risk | code reviewer on `opus` |

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
    "ui": { "type": "noul", "noul": 0.9 }
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
    "blast_radius": { "type": "score", "score": 0.4, "confidence": 0.9 }
  }
}
```

Tests must include fixtures that exercise every mapping branch: haiku, sonnet, opus by difficulty, sonnet for a wide blast radius, round-up from haiku by low confidence, no round-up from sonnet, floors, clarify yes and no, plan yes by need, plan yes by difficulty, plan no, the Haiku notice on and off, owner accepted, owner rejected for low confidence, risky opus, and every fallback reason.

## 10. Live check (opt-in)

`tests/jev-live.test.mjs` makes one real call with the dispatch question set of section 4 and a small fixed task state. It runs only when `TENONRY_LIVE=1` is set and the repository's own `.env` contains a non-empty `OPENROUTER_API_KEY`; a normal `node --test` run skips it and needs no network. It asserts `ok: true`, that the answers pass the client's own validation, and that `cost` is a number, and it prints the answers and cost but never the key. Run it with `TENONRY_LIVE=1 node --test tests/jev-live.test.mjs`.

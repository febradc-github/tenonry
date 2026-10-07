# 01. Architecture

## 1. What Tenonry is

Tenonry is a Claude Code plugin. A user types `/tenonry:run <request>` for each piece of work; the first run in a project sets everything up automatically. Tenonry turns the request into a plan, a design direction (for UI work), and a test-backed contract, then dispatches the work to narrow specialists that each own a disjoint set of files. Reviewers judge the result. Jev, a cheap typed decision model reached through OpenRouter, picks which model each specialist runs on and which reviewers run.

Design goals, in priority order:

1. **No AI slop.** Specialists follow language-level idioms. Reviewers are separate from builders. Tests are written from the spec before any implementation exists.
2. **Single responsibility.** Every file in the project has exactly one owning agent. Builders never review, reviewers never edit, nobody edits tests except the test author.
3. **Easy to use.** One command to remember. No setup step, no configuration needed, no prompts blocked, plain progress messages, and one-command undo.
4. **Token efficiency.** Opus only where judgment changes the outcome. Cheap models for mechanical work. Deterministic code for every decision that is a fact, not a judgment. Noisy tool output filtered before it reaches context.

## 2. Components

### 2.0 What the user types

| Command | What happens |
|---|---|
| `/tenonry:run <what you want>` | Does everything: sets up the project on first use, asks a few questions only if the request is unclear, then plans, designs, tests, builds, reviews, and commits |
| `/tenonry:run` | Shows the current run's progress, or resumes an unfinished run |
| `/tenonry:run resume` or `continue` | Resumes the unfinished run |
| `/tenonry:run undo` | Reverts every commit the last run made, as new revert commits (history is never rewritten) |
| `/tenonry:run help` | Shows these commands and examples |
| `/tenonry:init` | Optional. Re-scans the stack by hand; normally never needed because every run refreshes it automatically when manifests change |

### 2.1 Skills (run in the main session)

| Skill | Invocation | Role |
|---|---|---|
| `run` | `/tenonry:run [request | resume | continue | undo | help]` (user only) | The single entry point and orchestrator. Auto-initializes, drives every phase with the `tenonry.mjs` CLI, reports progress |
| `init` | `/tenonry:init` (user only, optional) | Forces a stack re-scan and agent re-render |
| `clarify-intake` | Invoked by `run` | Asks the user a few tappable questions when the request is unclear, then writes `brief.md` |

### 2.2 Core agents (rendered into the project by init)

| Agent | Model | Owns | Never does |
|---|---|---|---|
| `tenonry-planner` | opus | `.tenonry/runs/*/plan.md` | Write code, choose files |
| `tenonry-art-director` | opus | `.tenonry/design-direction.md`, `.tenonry/runs/*/design-brief.md` | Write code |
| `tenonry-test-author` | opus | Contract files and every test file | Write implementation |
| `tenonry-design-reviewer` | opus | `.tenonry/runs/*/reviews/**` | Edit any project file |

### 2.3 Specialists (rendered per active stack)

70 builder specialists across four layers, defined in `docs/05-SPECIALIST-CATALOG.json`: frontend (24), 3d (1), backend (23), data (22). Init activates only those whose detection signals match the project. Each active specialist `X` produces two agents:

- `tenonry-X`: the builder. Owns the files matched by its catalog globs.
- `tenonry-review-X`: its code reviewer. Same idioms and slop list, read-only except for its review file.

### 2.4 Hooks

| Event | Script | Purpose |
|---|---|---|
| SessionStart | `hook-session-start.mjs` | Injects `TENONRY_PLUGIN_ROOT=<path>` so skills can find plugin scripts |
| UserPromptSubmit | `hook-prompt-router.mjs` | On `/tenonry:run` only: Jev intake routing, run creation, main-model note. Never blocks |
| PreToolUse (Bash) | `hook-output-filter.mjs` | Rewrites test, lint, typecheck, and build commands to run through `exec-filter.mjs` |
| PreToolUse (Read) | `hook-read-guard.mjs` | Denies reads of lockfiles, build output, minified files, source maps |
| PreToolUse (Edit, Write, MultiEdit, NotebookEdit) in agent frontmatter | `hook-ownership-guard.mjs` | Blocks an agent from editing files it does not own |

### 2.5 Scripts

`scripts/tenonry.mjs` is a single CLI with subcommands the orchestrator calls. `scripts/init.mjs` performs initialization. `scripts/exec-filter.mjs` wraps noisy commands. `scripts/lib/` holds shared modules (glob, env, jev, routing, ownership, detect, render, git, state, contract). Exact specs are in `docs/03-COMPONENT-SPECS.md`.

## 3. Plugin repository layout (what the build produces)

```
tenonry/
  .claude-plugin/
    plugin.json
    marketplace.json
  skills/
    init/SKILL.md
    run/SKILL.md
    clarify-intake/SKILL.md
  hooks/
    hooks.json
  scripts/
    tenonry.mjs
    init.mjs
    exec-filter.mjs
    hook-session-start.mjs
    hook-prompt-router.mjs
    hook-output-filter.mjs
    hook-read-guard.mjs
    hook-ownership-guard.mjs
    lib/
      glob.mjs  env.mjs  jev.mjs  routing.mjs  ownership.mjs  detect.mjs
      render.mjs  git.mjs  state.mjs  contract.mjs  paths.mjs  json.mjs
  library/
    catalog.json
    core/
      planner.md  art-director.md  test-author.md  design-reviewer.md
    templates/
      specialist.md  code-reviewer.md  ui-rules.md
    rubrics/
      design.md  code.md
  tests/
    (unit tests, hook tests, fixtures)
  README.md
  BUILD-REPORT.md
```

The `library/` directory is deliberately not named `agents/`, so Claude Code does not register its files as plugin agents. Plugin-scoped agents ignore the `hooks` and `mcpServers` frontmatter fields, and both are required here (ownership guard on every agent, Playwright MCP on the design reviewer). Rendering agents into the project's `.claude/agents/` makes both fields work and keeps inactive specialists out of context entirely.

## 4. Runtime layout in a target project (what init creates)

```
<project>/
  .env                         (user-owned; holds OPENROUTER_API_KEY; never edited by Tenonry agents)
  .claude/agents/
    tenonry-planner.md
    tenonry-art-director.md
    tenonry-test-author.md
    tenonry-design-reviewer.md   (only if a frontend or 3d specialist is active)
    tenonry-<id>.md              (one per active specialist)
    tenonry-review-<id>.md       (one per active specialist)
  .claude/settings.local.json  (gitignored; init adds two permission rules: Tenonry's script and the review browser)
  .tenonry/
    config.json                (committed)
    ownership.json             (committed)
    design-direction.md        (committed; created by the art director on first UI run)
    rubrics/design.md, code.md (committed)
    bin/                       (gitignored; copies of plugin scripts)
    state.json                 (gitignored)
    logs/                      (gitignored; exec logs, jev-decisions.jsonl)
    runs/<run-id>/             (gitignored)
      run.json  route.json  brief.md  plan.md  design-brief.md
      contract.json  contract.md
      reports/<task-id>.json
      reviews/<task-id>.design.json  reviews/<task-id>.code.json
      report.md
```

## 5. End-to-end flow

### Phase 1: prompt to contract

1. User types `/tenonry:run <request>`.
2. `hook-prompt-router.mjs` (UserPromptSubmit) sees the `/tenonry:run` prefix. It asks Jev the intake questions (ambiguity, difficulty, task type, UI involvement), creates the run directory and `route.json`, and records the main session's model. It never blocks the prompt. If the project is not set up yet, the hook does nothing and the `run` skill initializes the project, then runs the same intake through `tenonry.mjs intake`.
3. The `run` skill reads `route.json`. If ambiguity is high, it invokes `clarify-intake`, which questions the user and saves `brief.md` through `tenonry.mjs write-brief --stdin`. Otherwise `tenonry.mjs write-brief` writes `brief.md` from the request.
4. `tenonry-planner` writes `plan.md`: goal, scope, non-goals, stories, behavioral acceptance criteria, layers touched, UI involvement. High-level only.
5. If the plan involves UI, `tenonry-art-director` creates or extends `.tenonry/design-direction.md` and writes the run's `design-brief.md`. On the first UI run in a project that already has an interface, it documents the visual language already in use and keeps it; it creates a new identity only when there is no interface yet or the brief asks for a redesign.
6. `tenonry-test-author` writes `contract.json` and `contract.md` (tasks, owners, files, dependencies, interfaces, verification) and the failing tests. `tenonry.mjs contract-check` validates it; up to 2 repair rounds.

### Phase 2: dispatch loop (per task, in dependency order)

1. `tenonry.mjs next` returns ready tasks (dependencies done) up to `maxParallel`, each with its model chosen by Jev (`docs/04-JEV-ROUTING.md`).
2. The orchestrator spawns `tenonry-<owner>` with the per-invocation `model`. `next` has already snapshotted the working tree for the task.
3. The specialist edits only its owned files (the ownership guard enforces it) and writes `reports/<task>.json`. It may run the project's own generators and migration tools for files it owns; anything a command writes outside its files is caught by `ownership-check` and reverted.
4. `tenonry.mjs verify` runs the task's tests, typecheck, and lint through `exec-filter.mjs`. Failure: resume the same specialist with filtered failures. Two failures on a tier: escalate one tier (haiku, sonnet, opus) and respawn fresh. Two failures on opus: task `blocked`, independent tasks continue.
5. `tenonry.mjs ownership-check` confirms every changed file belongs to the task's owner.
6. `tenonry.mjs review-plan` asks Jev the risk questions and returns which reviewers run on which model. Design reviewer runs for UI tasks (always opus). The specialist's code reviewer always runs (opus when risky or wide, otherwise sonnet).
7. Review failures go back to the owning specialist, then re-verify and re-review, up to the round limits. Exhausted rounds: `done_with_findings`.
8. `tenonry.mjs checkpoint` commits exactly the task's files: `tenonry(<task-id>): <title>`.
9. Repeat until no tasks remain. Then `tenonry.mjs final-gate` runs the full suite and `tenonry.mjs report` writes `report.md`.

## 6. Who decides what

| Decision | Decided by |
|---|---|
| File ownership per task, dependency order | Test author (opus), validated by `contract-check` |
| Design direction | Art director (opus) |
| Quality verdicts | Reviewers (opus or sonnet) |
| Next specialist, run order, escalation, which reviewer types apply, stack activation | Code (`tenonry.mjs`, `init.mjs`) |
| Model per task, owner of an unanticipated file, review risk, ambiguity | Jev |

Fallbacks: if Jev times out, errors, or no key exists, tasks run on sonnet (respecting model floors), code review runs on opus, and unowned files are assigned by ownership rules alone. If Jev's confidence is low, round up one model tier.

## 7. Failure policy

- Hooks fail open, except the ownership guard and read guard, whose job is to block.
- Every subagent failure is recorded in `run.json` and surfaced in `report.md`. The orchestrator never asks the user to fix a task mid-run; it continues with independent tasks and reports blocked ones at the end.
- A missing or outdated `.tenonry/config.json` makes `/tenonry:run` initialize or refresh the project automatically. If initialization created `.claude/agents/` for the first time, Claude Code needs one restart to see the new agents; the run is saved, and typing `/tenonry:run` after the restart continues it.
- A project that is not a git repository makes `/tenonry:run` stop with an explanation, because checkpoints and ownership checks need git.

## 8. User experience rules

- **One entry point.** Everything goes through `/tenonry:run`. Setup, refresh, resume, undo, and help are arguments, not separate commands to learn.
- **Zero configuration.** Detection picks the specialists, verification commands, and preview. `config.json` holds optional knobs only.
- **Works without a Jev key.** Missing `OPENROUTER_API_KEY` is mentioned once, on the first run, and fixed fallbacks are used.
- **Few, tappable questions.** Clarification happens once at the start, as multiple-choice questions with a recommended option first, at most two rounds.
- **Never blocked.** No hook ever blocks the user's prompt. When the main session runs on Haiku, the run starts anyway with a one-line tip that Sonnet coordinates more reliably.
- **Plain progress.** One short line per event, in the formats defined in `docs/06-AGENT-AND-SKILL-TEXTS.md` section 2.
- **Clear ending.** The final message says what changed, how to try it, what needs attention, and how to undo.
- **Safe undo.** `/tenonry:run undo` reverts the run's commits with new revert commits, stopping cleanly on conflicts.

## 9. Cost controls

- Only active specialists exist as agents, so descriptions of unused specialists never enter context.
- Jev calls happen at fixed points only: one per `/tenonry:run`, one per dispatched task, one per review plan, one per unowned file. Each costs a fraction of a cent.
- Model floors keep visual work off haiku. Everything else starts at the cheapest tier Jev deems sufficient.
- The output filter keeps test and build logs out of context; full logs stay on disk.
- The read guard keeps lockfiles and build output out of context.
- Design review loops are capped (3 rounds); code review loops are capped (2 rounds).

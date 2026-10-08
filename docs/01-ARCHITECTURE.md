# 01. Architecture

## 1. What Tenonry is

Tenonry is a Claude Code plugin. A user types `/tenonry:run <request>` for each piece of work; the first run in a project sets everything up automatically. Tenonry turns the request into a plan, a design direction (for UI work), and a test-backed contract, then dispatches the work to narrow specialists that each own a disjoint set of files. Reviewers judge the result. Jev, a cheap typed decision model reached through OpenRouter, picks which model each specialist runs on and which reviewers run.

Design goals, in priority order:

1. **No AI slop.** Specialists follow language-level idioms. Reviewers are separate from builders. Tests are written from the spec before any implementation exists.
2. **Single responsibility.** Every file in the project has exactly one owning agent. Builders never review, reviewers never edit, nobody edits tests except the test author.
3. **Easy to use.** One command to remember. No setup step, no configuration needed, no prompts blocked, plain progress messages, and one-command undo.
4. **Token efficiency.** Opus only where judgment changes the outcome: a small, clear request skips the planner, a change that needs no new design skips the art director, and a question skips the pipeline. Cheap models for mechanical work. Deterministic code for every decision that is a fact, not a judgment. Noisy tool output filtered before it reaches context. Agents write the least code that fully solves the task, start from a map of what the codebase already has, and reply in one line.

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
- `tenonry-review-X`: its code reviewer. Same idioms and slop list, read-only except for its review file. Reviewers of frontend and 3d specialists also check the UI rules (tokens only, every state built, accessibility in code) against the design direction and brief.

### 2.4 Hooks

| Event | Script | Purpose |
|---|---|---|
| SessionStart | `hook-session-start.mjs` | Injects `TENONRY_PLUGIN_ROOT=<path>` so skills can find plugin scripts |
| UserPromptSubmit | `hook-prompt-router.mjs` | On `/tenonry:run` only: Jev intake routing, run creation, main-model note. Never blocks |
| SubagentStart (`^tenonry-`) | `hook-subagent-start.mjs` | Gives the planner, the test author, builders, and code reviewers the codebase map before their first turn. Never blocks |
| PreToolUse (Bash) | `hook-output-filter.mjs` | Rewrites test, lint, typecheck, and build commands to run through `exec-filter.mjs` |
| PreToolUse (Read) | `hook-read-guard.mjs` | Denies reads of lockfiles, build output, minified files, source maps |
| PreToolUse (Edit, Write, MultiEdit, NotebookEdit) in agent frontmatter | `hook-ownership-guard.mjs` | Blocks an agent from editing files it does not own |

### 2.5 Scripts

`scripts/tenonry.mjs` is a single CLI with subcommands the orchestrator calls. `scripts/init.mjs` performs initialization. `scripts/exec-filter.mjs` wraps noisy commands. `scripts/lib/` holds shared modules (glob, env, jev, routing, ownership, detect, render, git, state, contract, preview, direct, map). Exact specs are in `docs/03-COMPONENT-SPECS.md`.

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
    hook-subagent-start.mjs
    hook-output-filter.mjs
    hook-read-guard.mjs
    hook-ownership-guard.mjs
    lib/
      glob.mjs  env.mjs  jev.mjs  routing.mjs  ownership.mjs  detect.mjs
      render.mjs  git.mjs  state.mjs  contract.mjs  paths.mjs  json.mjs  map.mjs
  library/
    catalog.json
    core/
      planner.md  art-director.md  test-author.md  design-reviewer.md
    templates/
      specialist.md  code-reviewer.md  ui-rules.md  ui-review-rules.md
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
    logs/                      (gitignored; exec logs, jev-decisions.jsonl, preview.log, preview.pid, screenshots/)
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
2. `hook-prompt-router.mjs` (UserPromptSubmit) sees the `/tenonry:run` prefix. It asks Jev the intake questions (ambiguity, difficulty, whether a plan is needed, task type, UI involvement, whether anything new has to be designed), creates the run directory and `route.json`, and records the main session's model. It never blocks the prompt. If the project is not set up yet, the hook does nothing and the `run` skill initializes the project, then runs the same intake through `tenonry.mjs intake`.
3. The `run` skill reads `route.json`. If Jev is confident the request is a question rather than a change (`lane: answer`), the skill answers it in the main session, changes no file, closes the run, and stops here. If ambiguity is high, it invokes `clarify-intake`, which questions the user and saves `brief.md` through `tenonry.mjs write-brief --stdin`. Otherwise `tenonry.mjs write-brief` writes `brief.md` from the request.
4. `tenonry-planner` writes `plan.md`: goal, scope, non-goals, stories, behavioral acceptance criteria, layers touched, UI involvement. High-level only. When `route.json` says `plan: no` (Jev judged the request small and clear), the run is a direct run: no planner is spawned, `tenonry.mjs direct-plan` writes `plan.md` from the brief in plain code, and the test author derives the acceptance criteria itself. Everything after this step is the same for both kinds of run.
5. `tenonry.mjs design-check` decides the design step in plain code. The plan involves no UI: nothing happens. Jev said nothing new has to be designed (`design: no`) and the project already has a design direction: no art director is spawned, and `design-check` writes a brief that says to apply the existing look. Otherwise `tenonry-art-director` creates or extends `.tenonry/design-direction.md` and writes the run's `design-brief.md`. On the first UI run in a project that already has an interface, it documents the visual language already in use and keeps it; it creates a new identity only when there is no interface yet or the brief asks for a redesign.
6. `tenonry-test-author` writes `contract.json` and `contract.md` (tasks, owners, files, dependencies, interfaces, verification) and the failing tests. It runs on Sonnet when the plan was skipped and on Opus otherwise. `tenonry.mjs contract-check` validates it; up to 2 repair rounds. On a quick run (`lane: quick`, a small mechanical change outside the interface) the test author is not spawned: `tenonry.mjs quick-contract` writes a one-task contract for the specialist Jev picks, and no new tests are written. The project's existing checks, the code review, and the final gate still apply. If `quick-contract` cannot be sure of the owner, the test author runs as usual.

### Phase 2: dispatch loop (per task, in dependency order)

1. `tenonry.mjs next` returns ready tasks (dependencies done) up to `maxParallel`, each with its model chosen by Jev (`docs/04-JEV-ROUTING.md`).
2. The orchestrator spawns `tenonry-<owner>` with the per-invocation `model`. `next` has already snapshotted the working tree for the task.
3. The specialist edits only its owned files (the ownership guard enforces it) and writes `reports/<task>.json`. It may run the project's own generators and migration tools for files it owns; anything a command writes outside its files is caught by `ownership-check` and reverted.
4. `tenonry.mjs verify` runs the task's tests, typecheck, and lint through `exec-filter.mjs`. Failure: resume the same specialist with filtered failures. Two failures on a tier: escalate one tier (haiku, sonnet, opus) and respawn fresh. Two failures on opus: task `blocked`, independent tasks continue.
5. `tenonry.mjs ownership-check` confirms every changed file belongs to the task's owner.
6. `tenonry.mjs review-plan` asks Jev the risk questions and returns which reviewers run on which model. The design reviewer runs for UI tasks that add a screen or change layout or styling (always opus); a UI task that changes neither, such as a text change, skips it and is noted in the report. When it runs, it starts the preview with `tenonry.mjs preview-start`, signs in with the optional preview account from `.env` when the delegation says `login: available`, and stops a preview it started with `preview-stop`. The specialist's code reviewer always runs: opus when risky or wide, haiku for a trivial, contained, low-risk task that passed first time, otherwise sonnet.
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
| Model per task, owner of an unanticipated file, review risk, ambiguity, whether a request needs a plan | Jev |
| Whether a request is a question, a quick mechanical change, or normal work; the test author's model; whether new design work is needed; whether a UI task needs a visual review; the owner of a quick change | Jev |

Fallbacks: if Jev times out, errors, or no key exists, nothing is skipped: every request is planned and built through the full pipeline, the test author runs on opus, the art director runs for every UI request, the design reviewer runs for every UI task, tasks run on sonnet (respecting model floors), code review runs on opus, and unowned files are assigned by ownership rules alone. If Jev's confidence is low, a haiku choice becomes sonnet. A builder runs on opus only when Jev scores its task as Hard or above, or after repeated failed checks on sonnet.

## 7. Failure policy

- Hooks fail open, except the ownership guard and read guard, whose job is to block.
- Every subagent failure is recorded in `run.json` and surfaced in `report.md`. The orchestrator never asks the user to fix a task mid-run; it continues with independent tasks and reports blocked ones at the end.
- A missing or outdated `.tenonry/config.json` makes `/tenonry:run` initialize or refresh the project automatically. If initialization created `.claude/agents/` for the first time, Claude Code needs one restart to see the new agents; the run is saved, and typing `/tenonry:run` after the restart continues it.
- A project that is not a git repository makes `/tenonry:run` stop with an explanation, because checkpoints and ownership checks need git.
- A design review that could not render the page (no preview, preview failed, browser missing, or a login it could not pass) never passes on scores guessed from code. It does not start a fix round either: the task is committed as `done_with_findings`, and the final summary says what to do to get a visual review next time.

## 8. User experience rules

- **One entry point.** Everything goes through `/tenonry:run`. Setup, refresh, resume, undo, and help are arguments, not separate commands to learn.
- **Zero configuration.** Detection picks the specialists, verification commands, and preview. `config.json` holds optional knobs only.
- **Works without a Jev key.** Missing `OPENROUTER_API_KEY` is mentioned once, on the first run, and fixed fallbacks are used. Every shortcut needs a Jev answer, so without a key the full pipeline runs.
- **Every shortcut is announced.** A skipped plan, a kept look, a quick change, and a direct answer each print their own progress line, so the user always knows which path a request took.
- **Few, tappable questions.** Clarification happens once at the start, as multiple-choice questions with a recommended option first, at most two rounds.
- **Never blocked.** No hook ever blocks the user's prompt. When the main session runs on Haiku, the run starts anyway with a one-line tip that Sonnet coordinates more reliably.
- **Plain progress.** One short line per event, in the formats defined in `docs/06-AGENT-AND-SKILL-TEXTS.md` section 2.
- **Clear ending.** The final message says what changed, how to try it, what needs attention, and how to undo.
- **Safe undo.** `/tenonry:run undo` reverts the run's commits with new revert commits, stopping cleanly on conflicts.
- **Few permission prompts.** Skills declare the tools they use, requests and briefs reach `tenonry.mjs` through standard input instead of temporary files, and setup adds two allow rules to the user's local settings (`.claude/settings.local.json`): Tenonry's own bookkeeping script and the review browser. Nothing else is auto-approved.
- **Signed-in screens get reviewed.** With an optional local test account in `.env`, the design reviewer signs in before it looks. Tenonry starts the preview server when it is not running and stops only the one it started. When a screen cannot be rendered, the summary says why and what to do, and the design is never passed on guesses.

## 9. Cost controls

- Only active specialists exist as agents, so descriptions of unused specialists never enter context.
- The planner, an Opus agent, runs only when Jev says the request needs a plan. Small, clear requests go from the brief straight to the contract and tests, and the test author writes them on Sonnet.
- The art director, an Opus agent, runs only when something new has to be designed or the project has no design direction yet.
- The design reviewer, the most expensive loop (Opus, screenshots, up to three rounds), runs only for UI tasks that add a screen or change layout or styling.
- A trivial, contained, low-risk task that passed first time is reviewed on Haiku instead of Sonnet. Every task is still reviewed.
- A question is answered directly; the pipeline does not start.
- A small mechanical change outside the interface becomes one task without the test author. It is the only path that writes no new tests, and it is taken only when Jev is confident on every count.
- Jev calls happen at fixed points only: one per `/tenonry:run`, one per dispatched task, one per review plan, one per unowned file. Each costs a fraction of a cent.
- Model floors keep visual work off haiku. Everything else starts at the cheapest tier Jev deems sufficient. Opus builds only complex tasks: low confidence and a wide blast radius never send a simple task there.
- The output filter keeps test and build logs out of context; full logs stay on disk.
- The read guard keeps lockfiles and build output out of context.
- Design review loops are capped (3 rounds); code review loops are capped (2 rounds).
- Screens are scored by profile: `showcase` pages by the awards weighting, `product` screens (forms, tables, dashboards, settings) by a weighting that favors clarity, accessibility, and responsiveness, so ordinary work screens do not burn three Opus design rounds chasing originality.
- Builders follow the least-code ladder (`docs/06` section 5.1, adapted from ponytail): skip what is not needed, reuse what the project has, then the standard library or framework, then an installed dependency, then one line, and only then new code. Less code means fewer output tokens, fewer turns, and smaller diffs to verify and review.
- The planner, the test author, builders, and code reviewers start with the codebase map (`docs/03` section 2.14), so reuse costs no search. It is built in plain code, about 2,000 characters, and rebuilt for every agent, so a later task sees what earlier tasks committed.
- Every agent replies with one line. Results travel through files, so the main session's context does not grow with each agent's summary.

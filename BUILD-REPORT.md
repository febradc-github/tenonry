# Tenonry build report

Tenonry 0.1.0 was built from the documents in `docs/` in six slices plus a Phase 0 platform check, without asking the developer anything. All work is committed locally on `main`; nothing was pushed.

## What was built

- **Plugin shell**: `.claude-plugin/plugin.json` and `marketplace.json` (marketplace `tenonry-local`), `hooks/hooks.json`, three skills (`run`, `init`, `clarify-intake`), and a user README.
- **Library** (`library/`): the 70-specialist catalog (byte-identical to `docs/05`), four core agents, the specialist and code reviewer templates, the UI rules block, and the design and code rubrics. Every text is extracted verbatim from `docs/06` and `docs/07`; a test compares them.
- **Shared modules** (`scripts/lib/`): glob matching, `.env` reading, JSON helpers, git helpers, ownership rules, stack detection and verification command resolution, template rendering, agent rendering, the Jev client and routing maps, run state, contract validation, and the task, verify, review, owner, report, and undo logic.
- **Hooks**: session start, prompt router (Jev intake routing, never blocks), Bash output filter, Read guard, and the per-agent ownership guard.
- **CLIs**: `scripts/init.mjs` (automatic setup, `--if-changed`, `--dry-run`) and `scripts/tenonry.mjs` with all 25 commands from docs/03 section 6, plus `scripts/exec-filter.mjs`.
- **Tests**: `tests/` with unit tests, hook tests that feed JSON on stdin, seven project fixtures, a local `node:http` stand-in for the Decisions API, and a whole-pipeline simulation.

## Test results

- `node --test`: **359 tests, 359 passed, 0 failed, 0 skipped** across 28 test files (about 26 seconds), stable over three consecutive runs. Run it with `node --test` (see D-044; `node --test tests/` fails on Node 22 and newer).
- `claude plugin validate .` and `claude plugin validate . --strict`: pass with no warnings (Claude Code 2.1.285). These run inside the suite.
- `claude plugin validate .claude/agents` on rendered agents: passes (inside the suite).
- `node scripts/tenonry.mjs catalog-check`: passes (24 frontend, 1 3d, 23 backend, 22 data).
- Local install smoke test (D-057): marketplace add, install, `claude -p "/tenonry:init"`, and `claude -p "/tenonry:run help"` all worked in a temporary copy of the `laravel-vue` fixture, using project scope; everything was uninstalled and deleted afterwards.

## Skipped or unverified checks

| Check | Why | What stands in for it |
|---|---|---|
| Live Jev (OpenRouter Decisions API) call | No `.env` with `OPENROUTER_API_KEY` on the build machine (D-058) | Local `node:http` server and fixtures; endpoint and shapes checked against the live docs (D-042) |
| A real `/tenonry:run <request>` through Claude Code | docs/08 says not to run it in the smoke test (token cost) | Whole-pipeline simulation test that plays the orchestrator and specialists against the real CLI |
| Node 18 | Only Node v26.7.0 is installed; installing another version would change the user's environment (D-060) | Review of the scripts for newer-than-18 APIs |
| Windows | Out of scope for 0.1 (D-007) | None |

## Things worth knowing

- The init skill's command uses `"$PWD"`, which `-p` mode did not auto-approve on the first try; the model retried with the absolute path. The skill text is verbatim from docs/06, so it was not changed (D-057). Dropping `--project "$PWD"` from the skill would avoid it, because `init.mjs` defaults to the current directory.
- In `-p` mode the UserPromptSubmit input had no `model` field, so the Haiku tip relies on the transcript fallback (D-057).
- Open items for the owner (from `docs/DECISIONS.md`): choose a license and a public repository, native Windows support, and publishing to a shared marketplace.

## Decisions added during the build (D-031 to D-060)

Each entry has its full context and reason in `docs/DECISIONS.md`.

- **D-031: Phase 0: environment**: Build machine has `claude` 2.1.285, Node v26.7.0, git 2.55.0 (all on 2026-10-07). The repository was not a git repository at the start, so the build ran `git init -b main` and commits locally only. No `.env` exists, so live Jev tests are skipped and all...
- **D-032: Phase 0: V1 plugin hooks.json format**: Confirmed.
- **D-033: Phase 0: V2 PreToolUse updatedInput**: Confirmed, with a nuance.
- **D-034: Phase 0: V3 UserPromptSubmit input and context**: Confirmed, with an addition.
- **D-035: Phase 0: V4 SessionStart additionalContext**: Confirmed.
- **D-036: Phase 0: V5 skill frontmatter**: Confirmed.
- **D-037: Phase 0: V6 marketplace.json schema**: Confirmed.
- **D-038: Phase 0: V7 hook common fields in subagents**: Confirmed.
- **D-039: Phase 0: V8 prompt text for plugin skills**: Confirmed by a live check (the docs alone did not say).
- **D-040: Phase 0: V9 Playwright MCP tool names**: Confirmed.
- **D-041: Phase 0: V10 hook timeout unit**: Confirmed. Seconds (default 600 for command hooks).
- **D-042: Phase 0: Jev Decisions endpoint**: Confirmed.
- **D-043: Project agents need folder trust, validated with `claude plugin validate .claude/agents`**: Confirmed.
- **D-044: Test command on Node 22 and newer**: Run the suite with `node --test` (no argument; also `npm test`). It auto-discovers every `*.test.mjs` under `tests/` on Node 18 and newer. Test fixtures never contain files named like test files for Node's discovery (`*.test.mjs`, `test-*.mjs`).
- **D-045: Where scripts find the catalog, and `.env` inline comments**: `paths.pluginRoot()` returns the directory that contains `library/catalog.json`: the plugin root, or `.tenonry/bin` in a project copy. Init copies `library/catalog.json` to `.tenonry/bin/library/catalog.json` (covered by the existing `.tenonry/bin/**`...
- **D-046: Exec filter failure regex, line budget, and ANSI codes**: The failure matcher keeps every listed alternative and adds the punctuated forms (`panic:`, `failure:`, `failures:`, `--- FAIL`) outside the word-boundary group. Matched lines are capped at `maxLines - 16` so header, matched lines, and the 15-line tail...
- **D-047: Read guard and vendored code, hook entry points**: The build-output rule is skipped for any path that has a `node_modules` or `vendor` directory segment. Lockfile, minified, and source map rules still apply there, and `readGuard.allow` still wins over everything. Build-output matching looks at directory...
- **D-048: Verify entries carry an `ecosystem` field**: Each `config.verify` entry has an extra `ecosystem` field (`js`, `php`, `python`, `go`, `rust`, `ruby`, `elixir`, `dotnet`, `maven`, `gradle`, `flutter`, `dart`). Among entries at the winning root, `verify` prefers the entry whose ecosystem matches the...
- **D-049: Detection details the spec leaves open**: Depth counts directories above the file (`a/b/c.csproj` is depth 2, so text signals and the manifest hash see it). A `scripts.test` containing `no test specified` is treated as absent so the final gate does not fail on a placeholder. Flutter is detected by...
- **D-050: `--if-changed` also checks that the agent files exist**: The skip also requires every name in `config.agents` to exist as a file in `.claude/agents/`; otherwise a full init runs and rewrites them.
- **D-051: Where Jev decision lines are logged**: `askJev` is the raw, never-throwing client. Every call site uses `decideWithJev`, which calls `askJev`, applies the mapping or the fallback, and appends exactly one line per call (including fallbacks) with the decision. The key never reaches the log...
- **D-052: Intake state and routing placement**: As specified. The router calls `state.newRun` before `runIntake`, so a run exists even when Jev fails (route.json then holds the fallback). A prompt whose request is empty or one of `resume|continue|undo|help|status` creates no run. A request that merely...
- **D-053: Owner heuristic and brace globs**: Braces are expanded first. Pass one looks for a glob equal to `**/*<ext>`; pass two accepts any alternative ending with `<ext>`. Candidates are the active specialists of the package that contains the path (longest package root), falling back to all active...
- **D-054: Undo ignores files that Tenonry itself generates**: The dirty check ignores `.tenonry/`, `.claude/agents/tenonry-*.md`, and `.gitignore`. If a revert would overwrite any of them, git fails the revert and the normal conflict path (`git revert --abort`, `reason: "conflict"`) applies. With no explicit run id...
- **D-055: Handoff never leaves a task running with nobody working on it**: `handoff` always ends the task's run: with follow-ups it becomes `pending` with new dependencies; without them it becomes `pending` once and is `blocked` (note `blocked: handoffs could not be resolved to another owner`) on the second fruitless handoff.
- **D-056: Command output details**: The CLI adds `ok: true` to any result object that lacks `ok`, so callers can always test it. Usage errors (unknown run, task, phase, or missing argument) print `{ok:false,error}` and exit 1; negative results such as an invalid contract exit 0. `new-run`...
- **D-057: Local install smoke test results (Claude Code 2.1.285)**: In a temporary copy of the `laravel-vue` fixture (git repository, committed) the build ran `claude plugin marketplace add <repo> --scope project`, `claude plugin install tenonry@tenonry-local --scope project`, `claude -p "/tenonry:init"`, and `claude -p...
- **D-058: Live Jev check skipped**: The live call to `POST /api/alpha/decisions` was not made. The client, request shape, pinned model, timeout, error mapping, and logging are tested against a local `node:http` server and fixtures (tests/jev.test.mjs). The endpoint, body, and response shape...
- **D-059: Symlink-safe path comparison in the guards**: The guards use `paths.relResolved`: the lexical relative path when it is inside the project, otherwise the same comparison after resolving symlinks on the project root and on the deepest existing ancestor of the target (the target itself need not exist)....
- **D-060: Node 18 compatibility is checked by API review only**: All tests ran on Node v26.7.0. The scripts were reviewed for newer-than-18 APIs (no `toSorted`, `Object.groupBy`, `import.meta.dirname`, `AbortSignal.timeout`, recursive `readdirSync`); they use only `fetch`, `structuredClone`, `Object.hasOwn`,...

## Revision 0.2.0

Work order: `docs/FIX-0.2.0.md`. Twelve fixes, each committed separately as `fix(0.2.0): <id> <summary>`, plus a Phase 0 commit. Nothing was pushed.

### What changed

- **F1** Builders may run their framework's own generators and migration tools for files they own; ad hoc shell edits stay forbidden.
- **F2** Builders verify with their own task's tests only; `{{verify}}` renders `task tests`, `typecheck`, and `lint` lines and never the project-wide test command.
- **F3** `css`, `tailwind`, `sass`, and `css-in-js` are at priority 75 and `angular` at 66, so stylesheets go to the styling specialist and Angular component templates to Angular. New `angular-scss` fixture.
- **F4** On an existing app the art director documents the current identity and keeps it; the design reviewer judges such an identity by consistency and craft.
- **F5** Fewer permission prompts: `allowed-tools` on the run and clarify skills, no `--project "$PWD"`, requests and briefs through `new-run --prompt-stdin` and `write-brief`, and two allow rules that init adds to `.claude/settings.local.json`.
- **F6** `preview-start`, `preview-stop`, and `preview-credentials`: Tenonry starts and stops the preview itself, and the design reviewer can sign in with an optional local test account from `.env`.
- **F7** A design review that did not render the page is `unrendered`: it never passes, never starts a fix round, ends the task as `done_with_findings`, and adds one attention note. The Playwright server is pinned to 0.0.83 with `--headless`, `--isolated`, and `--output-dir`.
- **F8** `django`, `fastapi`, and `flask` supersede `python`.
- **F9** Code reviewers of frontend and 3d specialists check UI rules U1 to U5; code review delegations for UI tasks carry the design direction and brief.
- **F10** Two design scoring profiles, `showcase` and `product`, in the brief, the rubric, and `review-status`.
- **F11** `tests/jev-live.test.mjs`, an opt-in single live call to Jev.
- **F12** Version 0.2.0, `node --test` everywhere, README changelog, architecture and build-plan notes.

### Test results

- `node --test`: **443 tests, 442 passed, 0 failed, 1 skipped** across 32 test files (about 38 seconds), the same on two consecutive runs. The one skip is the live Jev test.
- `node scripts/tenonry.mjs catalog-check`: passes (24 frontend, 1 3d, 23 backend, 22 data); `library/catalog.json` is still byte-identical to `docs/05`.
- `claude plugin validate .` and `claude plugin validate . --strict`: both pass (Claude Code 2.1.285).
- Existing tests changed because the behavior changed on purpose (each named in its commit message): the rendered `- test:` line (F2), the `login:` line in design delegations (F6), the old unrendered-pass test and the design feedback wording (F7), `python` active in the `django` fixture (F8), no design lines in a UI task's code review (F9), and version 0.1.0 (F12).

### Phase 0 results

| ID | Result | Detail |
|---|---|---|
| P1 | Confirmed, with one adaptation | `@playwright/mcp` 0.0.83; `--headless`, `--isolated`, `--output-dir` are documented. The default browser (installed Google Chrome) and the install command (`npx @playwright/mcp@0.0.83 install-browser chrome`) are not in the README and were read from the package source. Adaptation: `--output-dir` applies only to automatically named files, so the reviewer names screenshots with the `.tenonry/logs/screenshots/` directory (D-061) |
| P2 | Confirmed | Rule syntax confirmed in the docs. The heredoc case was confirmed by a live check: a prefix rule matched `node ... <<'TENONRY_REQUEST'` with quotes, `$`, backticks, `;` and `&&` in the body, with no denial (D-062). No approval caveat is needed |
| P3 | Confirmed | `claude -p --output-format json` returns `permission_denials` (D-063) |

### Smoke test (Claude Code 2.1.285, project scope, temporary copy of `laravel-vue`)

- Install from this repository: plugin listed as 0.2.0, enabled.
- `claude -p "/tenonry:init" --output-format json`: `.claude/settings.local.json` contains both rules; `permission_denials` is empty (0.1.0 had one denial here); 18 agents written.
- `claude -p "/tenonry:run status" --output-format json`: printed `No Tenonry runs yet. Start one with /tenonry:run <what you want>.`; `permission_denials` is empty.
- `claude -p "/tenonry:run help"`: printed the help block.
- Uninstalled, marketplace removed, temporary copy deleted. No step was skipped. `/tenonry:run <request>` was not run, as instructed.

### Live Jev check

Skipped: there is no `.env` with `OPENROUTER_API_KEY` at the repository root. `TENONRY_LIVE=1 node --test tests/jev-live.test.mjs` was run and skipped with `no OPENROUTER_API_KEY in the repository .env`. With a key, that one command makes the call and prints the answers and cost.

### Skipped or unverified checks

| Check | Why | What stands in for it |
|---|---|---|
| Live Jev call | No API key on the build machine | Local `node:http` stand-in and fixtures; the opt-in live test is ready |
| A real `/tenonry:run <request>`, including a real design review with the pinned browser, sign-in, and screenshots | The work order forbids it in the smoke test (token cost) | Unit tests for the preview commands (real processes), review status, and delegations; the whole-pipeline simulation |
| Node 18 | Only Node v26.7.0 is installed (D-060) | API review; the new code uses `fetch`, `spawn`, and `process.kill` only |

### Things worth knowing

- **Where the reviewer text differs from the work order (one place).** Step 4 of the design reviewer process names screenshots `.tenonry/logs/screenshots/<run>-<task>-<screen>-<width>.png` instead of a bare file name, because Playwright MCP 0.0.83 saves explicitly named files in the project root, where they would count as stray changes and block `undo` (D-061).
- **One deliberate deviation in init.** A `settings.local.json` that cannot be merged into (invalid JSON or wrong types) is left untouched with the specified warning, but does not force a full init on every run (D-068).
- **`preview-stop` is stricter than specified.** The pid file also stores the process start time, and a process is signalled only when both match, so a recycled pid is never killed (D-069).
- **One red commit.** The first F12 commit (`087ee67`) contained a new test that failed (it treated `node --test tests/jev-live.test.mjs` in the README as the forbidden directory form). The next commit (`a8eb401`) corrects the test. History was not rewritten.
- **Commit trailers.** Commits in this revision name Claude Opus 5.5, the model the session was switched to before the work started.

### New decisions

D-061 to D-063 (Phase 0: P1, P2, P3), D-064 (F1), D-065 (F2), D-066 (F3), D-067 (F4), D-068 (F5), D-069 (F6), D-070 (F7), D-071 (F8), D-072 (F9), D-073 (F10), D-074 (F11), D-075 (F12). Full text in `docs/DECISIONS.md`.

## Revision 0.3.0

One change, requested directly by the developer: Jev decides whether a request needs a plan, so small and clear requests no longer pay for the Opus planner. One commit, `feat(0.3.0): Jev decides whether a request needs a plan`, pushed to `origin/main` on the developer's instruction (D-077).

### What changed

- **Intake.** The intake question set has a fifth question, `needs_plan`. `route.json` gains `plan`: `no` when Jev says no plan is needed and the request scores below Hard, otherwise `yes`. It is the same single Jev call per request as before, so the decision adds no call.
- **Direct runs.** On `plan: no` the `run` skill prints `Small request: skipping the plan.`, spawns no planner, and calls the new `tenonry.mjs direct-plan`, which writes `plan.md` from the brief in plain code. Design (for UI work), the contract and tests, the build, the reviews, and the commits are unchanged.
- **Test author.** One new rule: on a `direct: yes` plan it derives the acceptance criteria from the brief and keeps the contract as small as the request.
- **Settings.** `routing.thresholds.planning` (`minNeedsPlan` 0.5, `minDifficulty` 2.0, `minUi` 0.5), editable and kept on re-init; an older `config.json` receives the defaults.
- **Version 0.3.0**, so the next `/tenonry:run` in an existing project re-renders its agents and scripts.

### Test results

- `node --test`: **458 tests, 457 passed, 0 failed, 1 skipped** across 32 test files (about 45 seconds). The one skip is the live Jev test. Fifteen tests are new.
- `node scripts/tenonry.mjs catalog-check`: passes; the catalog is untouched.
- `claude plugin validate .` and `claude plugin validate . --strict`: both pass (Claude Code 2.1.285).
- Existing tests changed because the behavior changed on purpose: the exact `route.json` and intake mapping comparisons now include `plan`, the shared intake fixture includes `needs_plan`, and the version assertions say 0.3.0.

### Skipped or unverified checks

| Check | Why | What stands in for it |
|---|---|---|
| Live Jev call with the new question | No `.env` with `OPENROUTER_API_KEY` at the repository root | Fixtures for every branch of the mapping; the question uses the same Noul type as `ambiguity` and `ui`. How Jev actually splits real requests between `yes` and `no` is therefore not measured yet |
| A real `/tenonry:run <request>` and the install smoke test | Token cost; the skill change is body text only | `claude plugin validate`, the skill text tests, and a direct run driven through the real CLI in `tests/pipeline.test.mjs` |

### Things worth knowing

- **Without a Jev key nothing changes.** Every request is still planned, because there is no judgment to rely on. The saving needs `OPENROUTER_API_KEY` in the project's `.env`.
- **A direct run still uses Opus once before the build.** The test author writes the contract and tests on Opus as before; UI work also still gets the art director. Only the planner is skipped (D-076, point 7).
- **The first threshold is a guess.** `minNeedsPlan` 0.5 has not been tuned against real answers. If too many requests are still planned, raise it in `.tenonry/config.json`; the intake lines in `.tenonry/logs/jev-decisions.jsonl` show each `needs_plan` answer and the resulting decision.

### New decisions

D-076 (Jev decides whether a request needs a plan) and D-077 (pushed on the developer's instruction). Full text in `docs/DECISIONS.md`.

## Revision 0.3.1

One change, requested directly by the developer: Opus builds only complex tasks. One commit, `fix(0.3.1): Opus builds only complex tasks`, pushed to `origin/main` on the developer's instruction (D-079).

### What changed

- **The cause, from a real run.** In the Jev log of a project using 0.3.0, a task to create one small formatting module (difficulty 0.52) was built on Opus. Jev's answer mapped to sonnet, then the low confidence of its blast-radius answer (0.34) rounded sonnet up to opus.
- **Low confidence** now lifts a haiku choice to sonnet and nothing else.
- **Blast radius** no longer chooses opus for a builder. `routing.thresholds.opus.minBlastRadius` is retired: ignored by code and dropped from `config.json` on re-init.
- **Unchanged:** a task Jev scores as Hard or above (`opus.minDifficulty`, 2.0) is built on Opus; a task that fails its checks twice on Sonnet escalates to Opus; the code reviewer's model follows risk and reach as before.
- **Version 0.3.1**, so the next `/tenonry:run` in an existing project refreshes its scripts.

### Test results

- `node --test`: **463 tests, 462 passed, 0 failed, 1 skipped** across 32 test files. The one skip is the live Jev test. Five tests are net new.
- `node scripts/tenonry.mjs catalog-check`: passes; the catalog is untouched.
- `claude plugin validate .` and `claude plugin validate . --strict`: both pass (Claude Code 2.1.285).
- Existing tests changed because the behavior changed on purpose: "dispatch picks opus by blast radius" and "low confidence rounds up one tier, capped at opus" were replaced by tests of the new rules, the `roundUp` helper and its assertions were removed, and the version assertions say 0.3.1.

### Skipped or unverified checks

| Check | Why | What stands in for it |
|---|---|---|
| Live Jev call | No `.env` with `OPENROUTER_API_KEY` at the repository root | The mapping is plain code over Jev's answers, tested with fixtures, including the answers logged in the real run that showed the problem |
| A real `/tenonry:run <request>` | Token cost | The whole-pipeline simulation in `tests/pipeline.test.mjs` |

### Things worth knowing

- **A first draft was wrong and was corrected.** It raised `opus.minDifficulty` to 2.5, which would have kept Hard tasks on Sonnet. The developer clarified that complex tasks belong on Opus, so the threshold stays at 2.0 and only the two rules that ignored difficulty were removed (D-078, point 1).
- **What "complex" means is Jev's difficulty score.** If Jev scores a task you consider simple at 2.0 or more, it is built on Opus. The dispatch lines in `.tenonry/logs/jev-decisions.jsonl` show each score, and `opus.minDifficulty` moves the boundary.

### New decisions

D-078 (Opus builds only complex tasks) and D-079 (pushed on the developer's instruction). Full text in `docs/DECISIONS.md`.

## Revision 0.4.0

Six more decisions handed to Jev to cut token use, requested directly by the developer after seeing the list and its costs. One commit, `feat(0.4.0): six more decisions for Jev`, pushed to `origin/main` on the developer's instruction (D-086).

### What changed

| # | Decision | What happens now | Decision |
|---|---|---|---|
| 1 | Contract model | When the plan was skipped, the test author runs on Sonnet instead of Opus | D-080 |
| 2 | Is new design work needed | A UI request that designs nothing new skips the art director; `design-check` writes a brief that says to keep the existing look | D-081 |
| 3 | Is a visual review needed | A UI task that does not change layout or styling skips the design reviewer | D-082 |
| 4 | Review depth | A trivial, contained, low-risk task that passed first time is code-reviewed on Haiku. Nothing is left unreviewed | D-083 |
| 5 | Is this a code change | A question is answered in the main session; the pipeline does not start | D-084 |
| 6 | Quick lane | A small mechanical change outside the interface becomes one task written by `quick-contract`; the test author does not run and no new tests are written | D-085 |

Supporting changes: two new Jev questions (`new_design` at intake, `visual_change` at review) and one new question set (`quick`, the owner of a quick change); three new `route.json` fields (`lane`, `contractModel`, `design`); two new commands (`design-check`, `quick-contract`) in the new `scripts/lib/direct.mjs`, which also took over `direct-plan`; four new threshold groups; three new progress lines; one new sentence in the builder template. Version 0.4.0.

### Test results

- `node --test`: **499 tests, 498 passed, 0 failed, 1 skipped** across 32 test files. The one skip is the live Jev test. Thirty-six tests are new.
- `node scripts/tenonry.mjs catalog-check`: passes; the catalog is untouched.
- `claude plugin validate .` and `claude plugin validate . --strict`: both pass (Claude Code 2.1.285).
- Existing tests changed because the behavior changed on purpose: exact `route.json`, intake, dispatch, and risk comparisons gained the new fields; the shared fixtures gained the new answers; the UI task in the review-plan test is now reviewed on Haiku because the scenario's task is trivial; the "sonnet for a low-risk change" test now uses a task that is not trivial; one README wording check; the version assertions.

### Skipped or unverified checks

| Check | Why | What stands in for it |
|---|---|---|
| Live Jev call with the new questions | No `.env` with `OPENROUTER_API_KEY` at the repository root | Fixtures for every branch. The questions use the Noul and Choice types already in use. How Jev actually answers them on real requests is not measured |
| A real `/tenonry:run` on each new path, and the install smoke test | Token cost | The orchestrator's steps for a quick run and a direct run are driven through the real CLI in `tests/pipeline.test.mjs`; the skill text for steps 3, 5, and 6 is checked sentence by sentence; `claude plugin validate` |
| The direct answer (item 5) | It is skill text carried out by the main session, with no code path to test beyond the routing and the closed run | Tests of the `answer` lane mapping, the closed run, and the skill sentences |

### Things worth knowing

- **Nothing changes without a Jev key.** Every shortcut needs a Jev answer. No key, a timeout, or an error means the full pipeline, exactly as in 0.2.0.
- **All thresholds are first guesses.** None has been tuned against real answers. Each decision and the answers behind it are in `.tenonry/logs/jev-decisions.jsonl`; the README lists the value that switches each shortcut off.
- **Item 4 was narrowed.** The proposal said "Haiku review, or none". It is Haiku only: every task is still reviewed (D-083).
- **Item 6 writes no new tests, by design, and is narrow on purpose.** It needs a confident `mechanical` classification, a confident low difficulty, no plan, no clarification, and no interface change, and it hands back to the test author on any doubt. The existing suite at the final gate, typecheck and lint, the ownership guard, and the code review still apply. `quick.maxDifficulty: -1` turns it off (D-085).
- **Item 5 can misfire in one direction.** A change request that Jev confidently takes for a question gets an answer and no change. The answer always ends with a line saying no files were changed and how to ask for a change, and the confidence bar is 0.7 rather than 0.5 (D-084).
- **The art director still runs on a project's first UI request**, whatever Jev says, because there is no design direction to keep yet (D-081).
- **D-076 point 7 is reversed.** In 0.3.0 the test author was deliberately left on Opus for skipped-plan runs; the developer asked for Sonnet (D-080).

### New decisions

D-080 to D-086. Full text in `docs/DECISIONS.md`.


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

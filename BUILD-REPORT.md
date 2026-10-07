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

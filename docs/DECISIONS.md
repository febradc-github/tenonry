# Decision log

Every decision that shapes the build. The build agent adds entries here instead of asking questions (see the autonomy protocol in `CLAUDE.md`). Entries D-001 to D-030 were made before the build started. Entries marked "Design recommendation" are defaults chosen on their merits, not owner decisions; the owner may change them.

## Template for new entries

```
### D-0NN: <short title>
- Context: <what was unclear or in conflict>
- Decision: <what was chosen>
- Reason: <why this is the conservative, working choice>
- Source: <doc section or URL, if any>
```

Phase 0 entries use the title `Phase 0: V<n> <item>` and a status of Confirmed, Changed, or Unverified.

## Decisions made before the build

### D-001: Plugin and command names
- Decision: The plugin is named `tenonry`. The user-facing command is `/tenonry:run`; the optional `/tenonry:init` and the internal `clarify-intake` skill complete the set. State lives in `.tenonry/`; agents are prefixed `tenonry-`.
- Reason: Owner decision. The name was checked as unused on npm and GitHub and in web search; a trademark search is still advised before publishing. Tenonry is a new plugin, unrelated to the owner's other plugins.

### D-002: Model range
- Decision: Every model choice (Jev routing, escalation, model floors, fallbacks, reviewer and core-agent models) uses Haiku, Sonnet, or Opus only. No other model is ever selected.
- Reason: Owner decision for this plugin, confirmed directly.

### D-003: The main-session model never blocks the user
- Decision: No hook blocks a prompt over the model. When the main session runs on Haiku, the run starts anyway with a one-line tip that Sonnet coordinates more reliably. Mid-task, the main model is never changed.
- Reason: Owner requirement that the plugin be easy to use. The main session only coordinates; all building and judging happens in subagents whose models Tenonry picks, so the main model matters little and blocking would only add friction.

### D-004: Jev access
- Decision: Call Jev through OpenRouter's Decisions API, model pinned to `typesafe/jev-1.13`.
- Reason: Pinned versions keep thresholds stable; the Decisions API is the documented route.

### D-005: Agents are rendered into the project
- Decision: Agent definitions live in `library/` inside the plugin and are rendered by init into `<project>/.claude/agents/`. The plugin ships no `agents/` directory.
- Reason: Plugin-scoped agents ignore `hooks` and `mcpServers`; Tenonry needs both. Rendering only active specialists also keeps unused agent descriptions out of context.

### D-006: API key location
- Decision: `OPENROUTER_API_KEY` is read only from the project's `.env`. Never from `process.env`, shell profiles, or global config.
- Reason: Design recommendation. Keeps the key and its billing scoped to the project that uses it, and keeps it out of shell environments where other tools could read it.

### D-007: Runtime and platform
- Decision: Node.js 18+ ES modules, zero runtime dependencies, POSIX shells (macOS, Linux, WSL). No native Windows support in version 0.1.
- Reason: Node is available wherever Claude Code is typically used for development; zero dependencies keeps installation instant and auditable.

### D-008: Effort is fixed per agent
- Decision: Core agents and reviewers use `effort: high`. Specialists omit `effort` and inherit the session. Jev routes the model only.
- Reason: Claude Code supports a per-invocation model but not a per-invocation effort.

### D-009: Single file ownership
- Decision: Every path has exactly one owner, resolved by priority. Exceptions: dependency manifests and `.gitignore` are shared (`*`); `.env`, lockfiles, generated directories, and Tenonry state are owned by no agent (`none`).
- Reason: Owner requirement of no shared responsibilities; manifests must be editable by whichever specialist adds a dependency.

### D-010: Tests belong to the test author
- Decision: Only `tenonry-test-author` writes or edits tests. Specialists report `contract_issue` when a test is wrong.
- Reason: Tests written from the spec, not reverse-engineered from the implementation, are the main defense against hollow tests.

### D-011: Reviewer policy
- Decision: The specialist's code reviewer runs for every task, on Opus when Jev judges the change risky or wide and Sonnet otherwise. The design reviewer runs on Opus for every UI task.
- Reason: Owner requirement of human-readable code on every change; visual taste needs the strongest model.

### D-012: Routing thresholds
- Decision: Defaults as in `docs/03-COMPONENT-SPECS.md` section 4.1. `tenonry.mjs calibrate` suggests changes but never edits config.
- Reason: Thresholds must be tuned from real outcomes, by the user.

### D-013: Limits
- Decision: `maxParallel` 3, 2 test failures per tier before escalation, 3 design review rounds, 2 code review rounds, 2 contract repair rounds.
- Reason: Three parallel tasks bounds token spend and merge contention; round limits bound review cost.

### D-014: Checkpoints
- Decision: One local commit per finished task, `tenonry(<task>): <title>`, containing only that task's files. Never push. Never bypass git hooks.
- Reason: Small commits make each task reviewable and revertible on its own; respecting git hooks avoids surprising the user.

### D-015: Output filter permission
- Decision: The output filter returns `permissionDecision: "allow"` only for allowlisted verification commands (tests, typecheck, lint, build) that contain no shell metacharacters. Install commands are not rewritten.
- Reason: Mirrors the documented Claude Code pattern while keeping the auto-approved surface small. Installs can run arbitrary package scripts.

### D-016: Read guard scope
- Decision: Deny reads of lockfiles, build output, minified files, and source maps. Allow reads inside `node_modules` and `vendor`.
- Reason: Agents sometimes need library source to understand an API; generated files almost never help.

### D-017: Design pass threshold
- Decision: Weighted score of at least 7.5, every criterion at least 6, no blocking finding.
- Reason: Web Design Awards winners typically score between 7.5 and 8.5.

### D-018: Who may ask questions
- Decision: At runtime, only the clarify-intake skill asks the end user questions. During the build of the plugin itself, the coding agent never asks the developer anything.
- Reason: Owner instruction for the build. Runtime questions are limited to one intake step so runs stay autonomous after it.

### D-019: Git is required to run
- Decision: `/tenonry:run` stops with an explanation outside a git repository. `/tenonry:init` only warns.
- Reason: Ownership checks, reverts, and checkpoints depend on git.

### D-020: 3D performance budget
- Decision: Default budget in the design direction template: static fallback, lazy loading after first paint, under 250 KB of gzipped 3D JavaScript, under 2 MB of models and textures, reduced-motion behavior defined. The art director may adjust it per project.
- Reason: Performance carries 20% of the design rubric; heavy sites do not win.

### D-021: Manifest metadata
- Decision: `plugin.json` lists the author's name only and omits `license` and `repository`.
- Reason: The owner has not chosen a license or public repository yet; omitting fields is safer than guessing. The plugin README states that the license is not yet chosen.

### D-022: Monorepos
- Decision: Package roots come from npm, yarn, and pnpm workspaces plus depth-1 directories containing a manifest. Specialist globs are prefixed with their package root.
- Reason: Covers the common `apps/web` plus `apps/api` and `frontend/` plus `backend/` layouts without a configuration step.

### D-023: Scoped typecheck and lint during tasks
- Decision: During a task, typecheck and lint failures count only when their output mentions the task's files. The final gate runs everything strictly.
- Reason: Tests for unbuilt tasks reference code that does not exist yet, which would otherwise fail every early task.

### D-024: Agent descriptions discourage ad hoc use
- Decision: Every Tenonry agent's description says it is invoked only by `/tenonry:run`, and its body refuses messages that lack the Tenonry header.
- Reason: Specialists depend on contract context; ad hoc delegation would bypass ownership and review.

### D-025: One command for users
- Decision: `/tenonry:run` is the only command users need. With a request it builds; alone it shows progress or continues; `undo` and `help` are arguments. Setup and stack refresh happen automatically at the start of every run (`init.mjs --if-changed`).
- Reason: Owner requirement that the plugin be easy to use.

### D-026: Undo by revert commits
- Decision: `/tenonry:run undo` reverts the last run's commits newest first with `git revert`, refuses with uncommitted changes, and stops cleanly on a conflict. History is never rewritten.
- Reason: Easy recovery without any risk of losing work.

### D-027: Plain progress and a clear ending
- Decision: The orchestrator speaks only in the fixed progress lines and the final summary defined in docs/06 section 2.
- Reason: Users see what is happening without reading agent transcripts.

### D-028: Short clarification
- Decision: Clarifying questions are multiple choice with a recommended option first, at most 4 per round and at most 2 rounds.
- Reason: Keeps the one interactive step quick.

### D-029: Missing Jev key is a tip, not an error
- Decision: Without `OPENROUTER_API_KEY`, Tenonry runs on fixed fallbacks and shows a one-time tip per project.
- Reason: Zero required configuration.

### D-030: First-run restart and resume
- Decision: When setup creates `.claude/agents/` for the first time, the request is saved, the user is asked to restart Claude Code once, and typing `/tenonry:run` afterwards continues the saved run. Resuming always moves tasks whose agents were lost back to waiting first (`recover`).
- Reason: Claude Code watches only agent directories that existed when the session started; saving the run means the user never retypes anything.

## Open items for the owner (not blocking the build)

- Choose a license and a public repository before publishing.
- Native Windows support (PowerShell hook variants).
- Publishing to a shared plugin marketplace.

## Decisions added during the build

(The build agent appends entries below, starting at D-031.)

### D-031: Phase 0: environment
- Context: Phase 0 requires recording the CLI version and tool availability.
- Decision: Build machine has `claude` 2.1.285, Node v26.7.0, git 2.55.0 (all on 2026-10-07). The repository was not a git repository at the start, so the build ran `git init -b main` and commits locally only. No `.env` exists, so live Jev tests are skipped and all Jev behavior is tested against fixtures and a local `node:http` server.
- Reason: Hard limits in CLAUDE.md: never push; skip live checks that need a key and record the skip.
- Source: `claude --version`, `node --version`.

### D-032: Phase 0: V1 plugin hooks.json format
- Status: Confirmed.
- Context: Expected `{"hooks": {"<Event>": [{"matcher", "hooks": [{"type": "command", "command", "timeout"}]}]}}` with `${CLAUDE_PLUGIN_ROOT}` expansion.
- Decision: The file wraps the event map in a top-level `hooks` key; `${CLAUDE_PLUGIN_ROOT}` expands anywhere in `command` and `args`; the docs recommend double-quoting it in shell-form commands, which the spec's `node "${CLAUDE_PLUGIN_ROOT}/scripts/..."` form does. Implementation follows docs/03 section 1.3 unchanged.
- Source: https://code.claude.com/docs/en/plugins-reference.md, https://code.claude.com/docs/en/hooks.md

### D-033: Phase 0: V2 PreToolUse updatedInput
- Status: Confirmed, with a nuance.
- Context: Expected that `updatedInput` requires `permissionDecision`.
- Decision: Live docs say `updatedInput` can be returned without `permissionDecision`, and valid decisions are `allow`, `deny`, `ask`, `defer`. Tenonry still returns `permissionDecision: "allow"` together with the full `updatedInput` for allowlisted verification commands, as D-015 requires, because the rewritten command is the same verification command and auto-approval is the intended behavior. `updatedInput` is always the full `tool_input` object with only `command` changed.
- Source: https://code.claude.com/docs/en/hooks.md

### D-034: Phase 0: V3 UserPromptSubmit input and context
- Status: Confirmed, with an addition.
- Decision: Input has `prompt`, `cwd`, `session_id`, `transcript_path`, and also a `model` string (example `claude-opus-5`). `hookSpecificOutput.additionalContext` is supported. `currentModelFamily` uses `input.model` first (as docs/03 section 8.2 already says), then the transcript fallback.
- Source: https://code.claude.com/docs/en/hooks.md

### D-035: Phase 0: V4 SessionStart additionalContext
- Status: Confirmed.
- Decision: `hookSpecificOutput.additionalContext` is supported (plain stdout also works as context). The hook prints the JSON form from docs/03 section 8.1.
- Source: https://code.claude.com/docs/en/hooks.md

### D-036: Phase 0: V5 skill frontmatter
- Status: Confirmed.
- Decision: `name`, `description`, `disable-model-invocation`, `argument-hint`, `allowed-tools` are all supported. `$ARGUMENTS` and `${CLAUDE_SKILL_DIR}` are substituted (`${CLAUDE_PLUGIN_ROOT}` also is, but the skill texts are copied verbatim and keep `${CLAUDE_SKILL_DIR}` with the SessionStart fallback). Plugin skills are namespaced `/<plugin>:<skill>`.
- Source: https://code.claude.com/docs/en/skills.md

### D-037: Phase 0: V6 marketplace.json schema
- Status: Confirmed.
- Decision: Required: `name`, `owner`, `plugins`; each entry needs `name` and `source` (relative path from the marketplace root, `./` for a plugin at the repo root). `description` and `version` on entries are accepted. Entry `name` must equal the manifest name (`tenonry`). Local install is `claude plugin marketplace add <path>` then `claude plugin install tenonry@tenonry-local`.
- Source: https://code.claude.com/docs/en/plugin-marketplaces.md

### D-038: Phase 0: V7 hook common fields in subagents
- Status: Confirmed.
- Decision: `agent_id` and `agent_type` are present for tool events inside subagents. Tenonry does not depend on them; the ownership guard receives the agent name as an argument.
- Source: https://code.claude.com/docs/en/hooks.md

### D-039: Phase 0: V8 prompt text for plugin skills
- Status: Confirmed by a live check (the docs alone did not say).
- Decision: A throwaway logging hook in a temporary project received `"prompt": "/tenonry:run help"`, the raw typed text, for the plugin skill command (Claude Code 2.1.285, `claude -p`). The router matches `/^\s*\/tenonry:run\b/` on it. As a defensive fallback in case a future version hands the hook the expanded skill instead, it also accepts a prompt containing the marker line `TENONRY_RUN_SKILL` and extracts the request from the text after `The user's input is: ` up to the blank line before `## Rules`. Any other shape exits 0 silently, and the run skill then falls back to `new-run` plus `intake`.
- Reason: Fail-open; the fallback costs nothing and is covered by tests.

### D-040: Phase 0: V9 Playwright MCP tool names
- Status: Confirmed.
- Decision: `browser_navigate`, `browser_resize`, `browser_take_screenshot`, `browser_snapshot`, `browser_click`, `browser_press_key` all exist. The design reviewer text names no individual tools; its `tools` entry `mcp__playwright` is the documented server-level pattern, and `mcpServers` uses a YAML list of inline definitions keyed by server name, matching docs/06. No text change.
- Source: https://github.com/microsoft/playwright-mcp, https://code.claude.com/docs/en/sub-agents.md

### D-041: Phase 0: V10 hook timeout unit
- Status: Confirmed. Seconds (default 600 for command hooks).
- Source: https://code.claude.com/docs/en/hooks.md

### D-042: Phase 0: Jev Decisions endpoint
- Status: Confirmed.
- Decision: `POST https://openrouter.ai/api/alpha/decisions` (the Jev tutorial's curl example) with body `{model, state, questions}` and response `{id, model, provider, answers, usage: {input_tokens, output_tokens, cost}}` as in docs/02 section 1.4. The API reference page lists additional optional fields (`session_id`, `user`, `provider`, `trace`) that Tenonry does not send.
- Source: https://openrouter.ai/docs/guides/community/jev-tutorial.md, https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md

### D-043: Project agents need folder trust, validated with `claude plugin validate .claude/agents`
- Status: Confirmed.
- Decision: Frontmatter hooks in project agents run only after the folder is trusted (a `-p` session does not count). The init skill already tells the user about the trust prompt. `claude plugin validate <agents dir>` needs v2.1.233 or later; with 2.1.285 it is available.
- Source: https://code.claude.com/docs/en/sub-agents.md

### D-044: Test command on Node 22 and newer
- Context: CLAUDE.md names `node --test tests/`. On Node v26.7.0 a directory argument is treated as a module path and fails with `Cannot find module .../tests`.
- Decision: Run the suite with `node --test` (no argument; also `npm test`). It auto-discovers every `*.test.mjs` under `tests/` on Node 18 and newer. Test fixtures never contain files named like test files for Node's discovery (`*.test.mjs`, `test-*.mjs`).
- Reason: Works on every supported Node version; the documented form does not work on the build machine.
- Source: Observed failure, `node --test tests/` on Node v26.7.0.

### D-045: Where scripts find the catalog, and `.env` inline comments
- Context: Scripts run both from the plugin (`scripts/`) and from the project copy (`.tenonry/bin/`), and the project copy needs specialist data (layer, model floor, owned globs) for `next`, `owner`, and `contract-check`. Spec 2.6 and 6 do not say where the catalog lives in the project. Spec 2.3 does not say how to treat `KEY=value # note`.
- Decision: `paths.pluginRoot()` returns the directory that contains `library/catalog.json`: the plugin root, or `.tenonry/bin` in a project copy. Init copies `library/catalog.json` to `.tenonry/bin/library/catalog.json` (covered by the existing `.tenonry/bin/**` protected rule and the `.tenonry/bin/` gitignore line). `.env` parsing strips a trailing ` # comment` from unquoted values and keeps `#` inside quoted values.
- Reason: Keeps one code path for locating the catalog, adds no new directory or ownership rule, and matches common dotenv behavior so a commented key does not break authentication.

### D-046: Exec filter failure regex, line budget, and ANSI codes
- Context: The regex in docs/03 section 7 ends in `\b`, which can never match after punctuation, so `panic:` and `failures:` lines would never be selected. The text also says failure output is "capped at `maxLines` minus 15" and the header line is printed too.
- Decision: The failure matcher keeps every listed alternative and adds the punctuated forms (`panic:`, `failure:`, `failures:`, `--- FAIL`) outside the word-boundary group. Matched lines are capped at `maxLines - 16` so header, matched lines, and the 15-line tail never exceed `maxLines`. A matched line is skipped when its text was already picked, and matches never repeat the tail window. ANSI color escape sequences are stripped from printed output (the full log keeps them).
- Reason: Keeps the documented intent (failures visible, bounded output) and saves tokens without hiding anything the log does not still hold.

### D-047: Read guard and vendored code, hook entry points
- Context: D-016 allows reading inside `node_modules` and `vendor`, but many packages ship their source under `dist/`, which the build-output rule denies. Hook scripts must also be importable by tests without running.
- Decision: The build-output rule is skipped for any path that has a `node_modules` or `vendor` directory segment. Lockfile, minified, and source map rules still apply there, and `readGuard.allow` still wins over everything. Build-output matching looks at directory segments only, never the file name. Hook scripts run `main()` only when they are the process entry point (`lib/main.mjs`), so tests can import their pure `decide` functions. Until slice 4, `hook-prompt-router.mjs` is a no-op placeholder so `hooks.json` never references a missing file.
- Reason: Honors the intent of D-016 and avoids false denials such as a source file named `build`.

### D-048: Verify entries carry an `ecosystem` field
- Context: docs/03 section 5.3 allows several verify entries per package root (one per ecosystem), and section 6.2 says to pick the entry whose `root` is the longest prefix of the task's first file. With two entries at the same root (for example PHP and JS in a Laravel project with Vitest tests) that choice is ambiguous.
- Decision: Each `config.verify` entry has an extra `ecosystem` field (`js`, `php`, `python`, `go`, `rust`, `ruby`, `elixir`, `dotnet`, `maven`, `gradle`, `flutter`, `dart`). Among entries at the winning root, `verify` prefers the entry whose ecosystem matches the extension of the task's first test file, then of its first file, then the first entry in table order. Entries whose four commands are all null are not written.
- Reason: Additive field, no change for consumers that ignore it; resolves the ambiguity deterministically without asking Jev.

### D-049: Detection details the spec leaves open
- Context: Docs/03 5.2 says text signals look at files "at depth 2 or less"; 5.3 reads the `npm init` placeholder test script as a test command; 2.9 names `restore(root, rel, snapshotHash)`.
- Decision: Depth counts directories above the file (`a/b/c.csproj` is depth 2, so text signals and the manifest hash see it). A `scripts.test` containing `no test specified` is treated as absent so the final gate does not fail on a placeholder. Flutter is detected by a `flutter:` key or `sdk: flutter` in `pubspec.yaml`. `git.restore(root, rel, snapshot)` takes the whole baseline snapshot (it needs to know whether the path was clean at baseline). `git.commit` uses `git commit -m <msg> -- <paths>` so files the user already staged are never swept into a task commit.
- Reason: Conservative readings that keep the documented behavior and avoid surprising commits or false failures.

### D-050: `--if-changed` also checks that the agent files exist
- Context: docs/03 5.5 skips init when the manifest hash and `bin/VERSION` match. If a user deletes `.claude/agents/` or an agent file, a skip would leave the run without agents.
- Decision: The skip also requires every name in `config.agents` to exist as a file in `.claude/agents/`; otherwise a full init runs and rewrites them.
- Reason: Self-healing at no cost; a full init is idempotent.

### D-051: Where Jev decision lines are logged
- Context: docs/03 section 2.5 says every `askJev` call appends a decision line, but the line also carries the resulting `decision` (for example the model), which only the mapping code knows. `calibrate` joins dispatch decisions to outcomes, so the model must be in the line.
- Decision: `askJev` is the raw, never-throwing client. Every call site uses `decideWithJev`, which calls `askJev`, applies the mapping or the fallback, and appends exactly one line per call (including fallbacks) with the decision. The key never reaches the log because the client never returns it.
- Reason: One line per call with the full decision, from a single code path.

### D-052: Intake state and routing placement
- Context: docs/03 section 8.2 puts `runIntake` and `currentModelFamily` in `scripts/lib/routing.mjs`, and section 2.10 puts run creation in `state.mjs`.
- Decision: As specified. The router calls `state.newRun` before `runIntake`, so a run exists even when Jev fails (route.json then holds the fallback). A prompt whose request is empty or one of `resume|continue|undo|help|status` creates no run. A request that merely begins with such a word ("help the customers...") is a real request.
- Reason: Matches the spec and keeps passive commands free of side effects.

### D-053: Owner heuristic and brace globs
- Context: docs/03 section 6.6 step 3 picks "the first active specialist (catalog order) having an `owns` glob that ends with the path's extension". Many globs end in a brace group (`**/*.{js,mjs,cjs,ts}`), and a literal suffix test would pick an unrelated specialist whose glob merely mentions the extension (for example `middleware.{ts,js}`).
- Decision: Braces are expanded first. Pass one looks for a glob equal to `**/*<ext>`; pass two accepts any alternative ending with `<ext>`. Candidates are the active specialists of the package that contains the path (longest package root), falling back to all active specialists. A file without an extension has no heuristic owner.
- Reason: Same intent as the spec with fewer wrong picks; the heuristic is a fallback after rules and Jev.

### D-054: Undo ignores files that Tenonry itself generates
- Context: docs/03 section 6.12 refuses to undo when the working tree has uncommitted changes outside `.tenonry/`. After the first init, `.gitignore` and `.claude/agents/tenonry-*.md` are uncommitted, so the first undo would always be refused.
- Decision: The dirty check ignores `.tenonry/`, `.claude/agents/tenonry-*.md`, and `.gitignore`. If a revert would overwrite any of them, git fails the revert and the normal conflict path (`git revert --abort`, `reason: "conflict"`) applies. With no explicit run id and no run with commits, undo returns `{ ok: true, reverted: [], runId: null }` without touching any run.
- Reason: Keeps undo usable right after setup without risking user changes.

### D-055: Handoff never leaves a task running with nobody working on it
- Context: docs/03 section 6 re-queues the original task only when follow-up tasks were created. If every handoff path is unresolved or already allowed for the owner, the task would stay `running` while its agent has ended, and the orchestrator would wait forever.
- Decision: `handoff` always ends the task's run: with follow-ups it becomes `pending` with new dependencies; without them it becomes `pending` once and is `blocked` (note `blocked: handoffs could not be resolved to another owner`) on the second fruitless handoff.
- Reason: Prevents a stuck run and an endless needs_owner loop.

### D-056: Command output details
- Context: docs/03 section 6 shows result shapes without an `ok` field, while errors use `ok: false`.
- Decision: The CLI adds `ok: true` to any result object that lacks `ok`, so callers can always test it. Usage errors (unknown run, task, phase, or missing argument) print `{ok:false,error}` and exit 1; negative results such as an invalid contract exit 0. `new-run` returns `runDir` relative to the project root. `next` returns `running` as the tasks already active before the call (not those it just started) and `remaining` as every task not done or done_with_findings, blocked ones included. `verify` also returns `files` (the attributed changed files). `contract-check` returns `contractFixes` and adds contract tasks that are missing from run.json on every valid check, so a repaired contract can introduce new tasks without resetting existing task state. `review-plan` records the planned kinds in `task.plannedReviews`, deletes stale review files for them, and `review-status` stores `task.reviews` and, on done_with_findings, `task.unresolved` for the report. A final-gate reopen also resets the reopened tasks' review round counters.
- Reason: Small additions that make the documented flows reliable without changing documented fields.

### D-057: Local install smoke test results (Claude Code 2.1.285)
- Context: docs/08 asks for a local install smoke test when the CLI is available and authenticated. `claude auth status` reported a logged-in claude.ai account.
- Decision: In a temporary copy of the `laravel-vue` fixture (git repository, committed) the build ran `claude plugin marketplace add <repo> --scope project`, `claude plugin install tenonry@tenonry-local --scope project`, `claude -p "/tenonry:init"`, and `claude -p "/tenonry:run help"`. Project scope was used so the user's own Claude Code settings were not changed; afterwards the plugin was uninstalled, the marketplace removed (`claude plugin marketplace list` shows no tenonry entry), and the temporary directory deleted. Results: init created `.tenonry/config.json`, `.tenonry/ownership.json`, `.tenonry/bin/`, rubrics, and 18 agents (including `.claude/agents/tenonry-laravel.md`) and reported them correctly; `/tenonry:run help` printed the help block verbatim in one turn. `/tenonry:run <request>` was not run, as docs/08 says.
- Observations: (1) In `-p` mode the init skill's first command, written with `"$PWD"` as in docs/06, was not auto-approved by `allowed-tools: Bash(node *)` because of the shell variable; the model retried with the absolute path. Interactive sessions would show a permission prompt instead. The skill text is copied verbatim, so it was left as is; `--project` defaults to the current directory, so dropping the flag from the skill text would avoid it. (2) The UserPromptSubmit input in `-p` mode had no `model` field, so the router uses the transcript fallback (and reports `unknown`, which never triggers the Haiku tip). (3) Plugin validation: `claude plugin validate .` and `--strict` pass; the only warning was a missing marketplace description, so `marketplace.json` has a top-level `description`.
- Reason: Records exactly what was and was not verified live.

### D-058: Live Jev check skipped
- Context: No `.env` with `OPENROUTER_API_KEY` exists on the build machine.
- Decision: The live call to `POST /api/alpha/decisions` was not made. The client, request shape, pinned model, timeout, error mapping, and logging are tested against a local `node:http` server and fixtures (tests/jev.test.mjs). The endpoint, body, and response shape were checked against the live OpenRouter documentation (D-042).
- Reason: Hard limits in CLAUDE.md; recorded in BUILD-REPORT.md.

### D-059: Symlink-safe path comparison in the guards
- Context: Claude Code may report the session directory and a tool's `file_path` through different but equivalent paths (for example `/tmp` and `/private/tmp` on macOS, or a symlinked project directory). A purely lexical comparison would make the ownership guard block every edit ("outside the project") and the read guard allow everything.
- Decision: The guards use `paths.relResolved`: the lexical relative path when it is inside the project, otherwise the same comparison after resolving symlinks on the project root and on the deepest existing ancestor of the target (the target itself need not exist). Paths that are truly outside the project still count as outside.
- Reason: Avoids a class of false blocks and false allows without weakening either guard.

### D-060: Node 18 compatibility is checked by API review only
- Context: CLAUDE.md requires Node 18+. The build machine has only Node v26.7.0, and installing another version would change the user's environment outside this repository.
- Decision: All tests ran on Node v26.7.0. The scripts were reviewed for newer-than-18 APIs (no `toSorted`, `Object.groupBy`, `import.meta.dirname`, `AbortSignal.timeout`, recursive `readdirSync`); they use only `fetch`, `structuredClone`, `Object.hasOwn`, `Array.prototype.at`, and `fs.cpSync`, all available in Node 18. This is recorded as a skipped check in BUILD-REPORT.md.
- Reason: Hard limit on actions outside the repository; the review is the closest safe substitute.

## Decisions added for revision 0.2.0

Work order: `docs/FIX-0.2.0.md`. Entries start at D-061.

### D-061: Phase 0 (0.2.0): P1 Playwright MCP version and flags
- Status: Confirmed for the version and the three flags; the default browser and the install command are not in the README and were read from the package itself.
- Context: F7 pins the review browser server and needs real flag names, the default browser, and its install command.
- Decision: `npm view @playwright/mcp version` returned `0.0.83` on 2026-10-07. Its README documents `--headless` ("run browser in headless mode, headed by default"), `--isolated` ("keep the browser profile in memory, do not save it to disk"), and `--output-dir <path>`. The design reviewer is pinned to `@playwright/mcp@0.0.83` with those three flags in that order. The README's "Browser installation" section is empty, so two facts come from the published package source (`playwright-core` `tools/mcp`): with no `--browser`, the server launches the Chromium engine with channel `chrome`, which is the Google Chrome installed on the machine; and when the browser is missing, the server's own error says to run `npx @playwright/mcp install-browser <browser>`. The install command constant is therefore `npx @playwright/mcp@0.0.83 install-browser chrome` (pinned so it matches the server version) instead of the fallback `npx playwright install chromium`, which would install a different browser than the one the server launches.
- Changed: The README states that `--output-dir` applies only to automatically named files and that "files with an explicit name are resolved against the workspace root". The reviewer text in F6.3 asks for explicitly named screenshots, which would therefore land in the project root as untracked files, where they would count as unowned changes for other tasks and make `undo` refuse a dirty tree. The screenshot name in step 4 of the reviewer process therefore carries the directory: `.tenonry/logs/screenshots/<run>-<task>-<screen>-<width>.png`. `--output-dir .tenonry/logs/screenshots` stays, so automatically named files go to the same gitignored directory.
- Source: `npm view @playwright/mcp@0.0.83 readme`; package tarballs `@playwright/mcp@0.0.83` and `playwright-core@1.64.0-alpha-1790635538000`.

### D-062: Phase 0 (0.2.0): P2 permission rule syntax
- Status: Confirmed, including the heredoc case by a live check.
- Decision: Skill frontmatter `allowed-tools` grants tools "without asking permission during the turn that invokes this skill" and accepts a comma-separated string such as `Bash(node *), Bash(git rev-parse *)`. In `permissions.allow`, `Bash(node .tenonry/bin/tenonry.mjs *)` is a valid prefix rule (everything before the first `*` is matched as written, and a trailing ` *` also matches the bare command) and `mcp__playwright` is the documented server-level form. `.claude/settings.local.json` rules apply without the workspace trust step as long as the file is not tracked in git, which is why init adds it to `.gitignore`. The docs say here-docs are not checked as redirect targets but do not say whether a prefix rule matches a command with a heredoc body, so it was tested: in a temporary directory with `permissions.allow: ["Bash(node echo.mjs *)"]`, `claude -p` (2.1.285) ran `node echo.mjs --stdin <<'TENONRY_REQUEST'` with a two-line body containing double quotes, `$dollars`, backticks, `;` and `&&`; `permission_denials` was empty and the body arrived byte for byte. The heredoc form is used as written in F5.
- Source: https://code.claude.com/docs/en/permissions.md, https://code.claude.com/docs/en/skills.md, live check.

### D-063: Phase 0 (0.2.0): P3 permission denials in JSON output
- Status: Confirmed.
- Decision: `claude -p "say ok" --output-format json` returns a `permission_denials` array (empty when nothing was denied). The final smoke test asserts it is empty.
- Source: Live check with Claude Code 2.1.285.

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
- Status: Unverified (the docs do not say whether the hook sees the raw typed text or the expanded skill).
- Decision: The router matches `/^\s*\/tenonry:run\b/` on the raw prompt. As a defensive fallback it also accepts a prompt containing the marker line `TENONRY_RUN_SKILL` and extracts the request from the text after `The user's input is: ` up to the blank line before `## Rules`. Any other shape exits 0 silently, and the run skill then falls back to `new-run` plus `intake`, so nothing breaks either way.
- Reason: Fail-open, no dependency on the unverified behavior.

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

# 08. Build plan and tests

Six slices, built in order. Each slice ends with `node --test` passing and one local commit `slice N: <summary>`. Tests use only `node:test` and `node:assert/strict`. Tests that need a project create a temporary directory (`fs.mkdtempSync`), copy a fixture into it, and run `git init`, `git add -A`, `git commit -m init` with `-c user.name=test -c user.email=test@example.com`.

## Slice 1: foundations

Build:
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (docs/03 section 1).
- `library/catalog.json` (verbatim copy of docs/05), `library/rubrics/*.md` (docs/07), `library/core/*.md` and `library/templates/*.md` (docs/06 sections 4 and 5), and the UI rules block stored as `library/templates/ui-rules.md` (docs/06 section 5.2).
- `scripts/lib/paths.mjs`, `json.mjs`, `env.mjs`, `glob.mjs`, `render.mjs`.
- `tenonry.mjs catalog-check`.

Tests:
- Every glob case in docs/03 section 2.4.
- `.env` parsing: quotes, `export`, comments, blank lines, missing file; the key value never appears in thrown errors.
- `renderTemplate` throws on a missing variable; renders lists correctly.
- `catalog-check` passes on the shipped catalog and fails on a copy with a duplicate id, a bad layer count, an invalid glob, and an unknown `supersedes` id.
- No shipped file under `library/`, `skills/`, `scripts/`, `hooks/`, or `.claude-plugin/` contains U+2014.
- Every file in `library/core/` and `library/templates/` (except `ui-rules.md` and `ui-review-rules.md`) ends with the generated marker line.

## Slice 2: deterministic hooks

Build: `scripts/exec-filter.mjs`, `hook-output-filter.mjs`, `hook-read-guard.mjs`, `hook-session-start.mjs`, `hooks/hooks.json`.

Tests (hooks are run as child processes with JSON on stdin; assert stdout, stderr, exit code):
- exec-filter: exit code preserved for 0, 1, and 7; full log written; failure lines plus last 15 lines printed on failure; last 5 lines on success; output capped at `maxLines`.
- Output filter: rewrites `npm test`, `pnpm exec vitest run`, `php artisan test`, `pytest -q`, `go test ./...`; output contains `permissionDecision: "allow"` and the full original `tool_input` with only `command` changed; base64 round-trips; skips commands with `;`, `&&`, `|`, `>`, backticks, `$(`; skips unknown commands; skips when the project has no `.tenonry/config.json`; skips commands already wrapped.
- Read guard: denies each category with the right reason; allows normal source files; honors `allow` and `extraDeny`; allows paths outside the project.
- Session start: prints the plugin root.
- `hooks.json` parses and references existing scripts.

## Slice 3: init and ownership

Build: `scripts/lib/detect.mjs`, `ownership.mjs`, `git.mjs`; `scripts/init.mjs`; `scripts/hook-ownership-guard.mjs`.

Fixtures under `tests/fixtures/` (minimal files only, no installed dependencies):

| Fixture | Contents | Expected active specialists (at least) |
|---|---|---|
| `laravel-vue` | `composer.json` (laravel/framework, laravel/pint), `artisan`, `app/Http/Controllers/HomeController.php`, `app/Models/User.php`, `resources/views/welcome.blade.php`, `package.json` (vue, tailwindcss, vite, scripts.dev), `resources/js/app.js`, `resources/css/app.css`, `tests/Feature/ExampleTest.php` | laravel, eloquent, php, vue, tailwind, html, nodejs (css superseded) |
| `next-prisma` | `package.json` (next, react, prisma, @prisma/client, typescript, vitest, scripts.dev, scripts.test), `app/page.tsx`, `prisma/schema.prisma`, `tsconfig.json` | nextjs, prisma, typescript, nodejs (react superseded) |
| `monorepo` | root `package.json` with `workspaces: ["apps/*"]`; `apps/web` (next); `apps/api` (@nestjs/core, prisma) | nextjs in `apps/web`, nestjs and prisma in `apps/api`, globs prefixed with the package root |
| `django` | `manage.py`, `requirements.txt` (Django, pytest), `shop/models.py`, `shop/views.py`, `templates/base.html` | django, django-orm, html (python superseded) |
| `go-api` | `go.mod`, `cmd/api/main.go`, `internal/orders/service.go` | go |
| `flutter-app` | `pubspec.yaml` with `flutter:`, `lib/main.dart` | flutter |
| `three-landing` | `package.json` (three, vite, scripts.dev), `src/scene/hero.ts`, `index.html` | 3d, html, nodejs, and the design reviewer agent rendered |
| `angular-scss` (added in 0.2.0) | `package.json` (@angular/core, typescript, sass), `angular.json`, `src/app/points/points.component.{ts,html,scss}`, `src/styles.scss`, `src/index.html` | angular, sass, html, typescript, nodejs |

Tests:
- Detection results per fixture, including supersession and package roots.
- Ownership resolution examples: `laravel-vue`: `app/Models/User.php` is `tenonry-eloquent`; `app/Http/Controllers/HomeController.php` is `tenonry-laravel`; `resources/views/welcome.blade.php` is `tenonry-html`; `resources/js/app.js` is `tenonry-vue`; `resources/css/app.css` is `tenonry-tailwind`; `tests/Feature/ExampleTest.php` is `tenonry-test-author`; `.env` is `none`; `.env.example` is `*`; `composer.lock` is `none`; `composer.json` is `*`. `next-prisma`: `app/page.tsx` is `tenonry-nextjs`; `prisma/schema.prisma` is `tenonry-prisma`. `monorepo`: `apps/api/src/app.module.ts` is `tenonry-nestjs`.
- Verification commands and preview per fixture match docs/03 sections 5.3 and 5.4 (for example `laravel-vue`: test `php artisan test`, testFiles `php artisan test {files}`, lint `./vendor/bin/pint --test`).
- Rendered agents: every expected file exists; frontmatter starts on line 1 with `---`, has `name` and `description`, closes with `---`; no `{{` remains; the guard command names the file's own agent; the design reviewer exists only when a frontend or 3d specialist is active.
- `--if-changed`: a second run is skipped and writes nothing; editing `package.json` or `composer.json`, or changing the plugin version, triggers a full init; the skip result includes `jevKey`.
- `agentsDirCreated` is true only when `.claude/agents/` did not exist before.
- Re-init: preserves edited `routing.thresholds` and `limits`; removes a stale generated agent; never touches an agent file without the marker; `.gitignore` lines are not duplicated.
- `--dry-run` writes nothing.
- Ownership guard: allows an owned file; blocks another owner's file with exit 2 and the exact message; blocks `none`; blocks unowned; honors run-scoped rules; exits 0 when no project config exists.
- If the `claude` CLI exists: `claude plugin validate .claude/agents` passes in a rendered fixture. Otherwise record the skip.

## Slice 4: Jev

Build: `scripts/lib/jev.mjs`; pure mapping functions in `scripts/lib/routing.mjs` (intake, dispatch, owner, risk mappings and fallbacks from docs/04); `scripts/hook-prompt-router.mjs`; `scripts/lib/state.mjs`.

Tests:
- Request shape against a local `node:http` server (point the client at it with the internal `TENONRY_JEV_URL` override used only by tests): method, path, headers, body fields, pinned model.
- Timeout produces `timeout`; HTTP 500 produces `http_500`; malformed answers produce `invalid_response`; missing key produces `no_key`; `TENONRY_JEV_DISABLE=1` produces `disabled`.
- Every mapping branch listed in docs/04 section 9.
- Prompt router: ignores prompts without `/tenonry:run`; ignores projects without config; ignores `resume`, `continue`, `undo`, `help`, `status`, and empty input; creates the run and `route.json`; prints `TENONRY_ROUTE`; never exits 2 for any input; sets `mainModel.notice` for a Haiku session and not for Sonnet or Opus; reads the model from the transcript fallback; falls back cleanly with no key.
- Decision log lines are written and never contain the key.

## Slice 5: orchestration CLI

Build: `scripts/lib/contract.mjs` and every remaining `tenonry.mjs` command from docs/03 section 6, then the copying of all `.tenonry/bin` files in init.

Tests (temporary git repos from `laravel-vue` and `monorepo`, Jev via fixtures):
- `contract-check`: one valid contract, and one failing contract per error rule in docs/03 section 4.5.
- `next`: dependency order, `maxParallel`, one active task per owner, model mapping with floors, escalation tier reuse, delegation text exactly as docs/03 section 6.10.
- `verify`: pass and fail paths with a fake test command (configure `testFiles` as `sh -c 'exit 1'` style scripts inside the fixture), retries, escalation to the next tier after two failures, blocked after opus fails twice, scoped typecheck rule, outcome log lines.
- `ownership-check` and `revert-violations`: a violation in a tracked file and a new untracked file.
- `review-plan` and `review-status`: weighted score recomputation, unrendered reviews ending as done_with_findings, missing file as error, round limits leading to `done_with_findings`.
- `checkpoint`: commits exactly the task's files with the right message; skips cleanly when nothing changed.
- `owner`: rules hit, Jev accept, Jev low confidence falling back to the heuristic, `none`.
- `handoff`: creates follow-up tasks and re-queues the original.
- `final-gate`: pass, fail with reopen, second fail without reopen.
- `report`: contains every section from docs/03 section 6.8.
- `calibrate`: `enoughData: false` under 20 decisions; correct buckets and suggestions with a synthetic log.
- `intake`: rewrites `route.json` from Jev fixtures; works for a run created with `new-run`.
- `status`: `display` matches docs/03 section 6.11 for a mixed run and for no runs.
- `recover`: moves running, verifying, and reviewing tasks back to pending without losing attempts.
- `undo`: reverts a run's commits newest first as revert commits; refuses with uncommitted changes; stops and aborts cleanly on a conflict; returns an empty list for a run without commits; never rewrites history (commit count only grows).
- `report`: `summary` fields are present and `tryIt` falls back from preview to the test command.
- `notice-shown` and `restart-pending` update `state.json`.

## Slice 6: skills, documentation, smoke test

Build:
- `skills/init/SKILL.md`, `skills/run/SKILL.md`, `skills/clarify-intake/SKILL.md` verbatim from docs/06.
- Plugin `README.md` for users, written for someone in a hurry. Order: a two-sentence description; a "Quick start" of exactly three steps (install the plugin, open a git project in Claude Code, type `/tenonry:run <what you want>`); the command table from docs/01 section 2.0; what to expect on the first run (automatic setup, possibly one restart, the workspace trust prompt); the optional `OPENROUTER_API_KEY` in `.env`; what gets created and what to commit; optional knobs in `.tenonry/config.json` and `tenonry.mjs calibrate`; requirements (Claude Code, Node 18+, git); how to remove Tenonry from a project (delete `.claude/agents/tenonry-*.md` and `.tenonry/`). The license line says it is not chosen yet.

Tests:
- Skill files exist, frontmatter parses, and they contain their marker lines (`TENONRY_INIT_SKILL`, `TENONRY_RUN_SKILL`, `TENONRY_CLARIFY_SKILL`).
- The run skill contains the help block and every progress line from docs/06 section 2 verbatim.
- If the `claude` CLI exists: `claude plugin validate .` passes.

### Local install

If the `claude` CLI exists and is authenticated, run in a temporary copy of the `laravel-vue` fixture:

1. `claude plugin marketplace add <path to this repo>`
2. `claude plugin install tenonry@tenonry-local`
3. `claude -p "/tenonry:init"` with a turn limit, then assert `.tenonry/config.json` and `.claude/agents/tenonry-laravel.md` exist.
4. `claude -p "/tenonry:run help"` prints the help block.

If any step is unavailable (CLI missing, not authenticated, command shape changed), record the skip and its reason in `BUILD-REPORT.md`. Do not run `/tenonry:run` in the smoke test; it would spend significant tokens.

## Definition of done

1. All six slices are committed and `node --test` passes with zero failures.
2. Phase 0 results for V1 to V10 are recorded in `docs/DECISIONS.md`, and the implementation matches them.
3. `catalog-check` passes; the shipped catalog equals docs/05 byte for byte.
4. Agent, skill, and rubric texts match docs/06 and docs/07 except for documented placeholders (a test compares them).
5. No shipped file contains U+2014; no runtime dependency exists in any `package.json` (a dev-only `package.json` with a `test` script is allowed).
6. `claude plugin validate .` passes, or its skip is recorded with the reason.
7. `BUILD-REPORT.md` exists and lists: what was built, test totals, skipped checks with reasons, and every decision added during the build.

## Revision 0.2.0 tests

The fixes in `docs/FIX-0.2.0.md` each list their required tests. Where they live:

- F1 (generators): `tests/agents-render.test.mjs` (rendered `eloquent` and `prisma`, test author bullet) and `tests/lifecycle.test.mjs` (a generated file named differently from the contract).
- F2 (task-scoped verification): `tests/agents-render.test.mjs` (`laravel-vue`, `monorepo` suffix, null `testFiles`, no unrendered placeholder).
- F3 (styling and Angular ownership): `tests/ownership.test.mjs` (the ten resolution cases and the `angular-scss` fixture).
- F4 (existing identity): `tests/agents-render.test.mjs` (art director and design reviewer texts).
- F5 (permission prompts): `tests/permissions.test.mjs` (`new-run --prompt-stdin`, `write-brief`, `settings.local.json`, `--if-changed`, skill texts).
- F6 (preview and sign-in): `tests/preview.test.mjs` (`preview-start`, `preview-stop`, `preview-credentials`) and `tests/review.test.mjs` (`login:` line, no credential in any delegation, log, or run file).
- F7 (unrendered reviews, pinned browser): `tests/review.test.mjs` (unrendered reviews ending as done_with_findings, attention notes, showcase boundary) and `tests/shipped-files.test.mjs` (removed status, pinned version).
- F8 (Python superseded): `tests/detect.test.mjs` (`django` fixture, FastAPI, Flask, plain Python).
- F9 (UI review rules): `tests/agents-render.test.mjs` (rendered reviewers) and `tests/review.test.mjs` (code review delegations for `ui` tasks).
- F10 (scoring profiles): `tests/review.test.mjs` (product at 7.50, showcase failure, innovation 4, missing profile, tables summing to 1.00).
- F11 (live Jev): `tests/jev-live.test.mjs`, skipped unless `TENONRY_LIVE=1` and a key in the repository `.env`.
- F12 (housekeeping): `tests/skills.test.mjs` and `tests/init.test.mjs` (version 0.2.0, README order).

## Revision 0.3.0 tests

One change (decision D-076): Jev decides at intake whether a request needs a plan.

- Mapping (`plan` yes by need, yes by difficulty, no, inclusive boundaries, fallback `yes`, custom thresholds): `tests/routing.test.mjs`.
- `route.json` from the hook and from `new-run` plus `intake`: `tests/hook-prompt-router.test.mjs` and `tests/run-commands.test.mjs`.
- `direct-plan` (the file it writes, `ui` from the threshold, a clarified brief kept as written, a missing brief, the refusal when a plan is required, an old `route.json` without the field): `tests/run-commands.test.mjs`.
- A direct run through the rest of the pipeline (contract, build, review, commit, report): `tests/pipeline.test.mjs`.
- The run skill's two branches, the test author's direct rule, and defaults reaching an existing config on re-init: `tests/skills.test.mjs`, `tests/agents-render.test.mjs`, and `tests/init.test.mjs`.
- Version 0.3.0: `tests/skills.test.mjs` and `tests/init.test.mjs`.

## Revision 0.3.1 tests

One change (decision D-078): Opus builds only complex tasks.

- Mapping (a wide blast radius stays on sonnet, low confidence lifts haiku only, a complex task stays on opus, the answers logged for the real simple task that reached opus, a sweep showing no path to opus below the difficulty threshold, a stale `opus.minBlastRadius` ignored): `tests/routing.test.mjs`.
- Re-init drops the retired knob and keeps an edited `opus.minDifficulty`: `tests/init.test.mjs`.
- Version 0.3.1 and the changelog: `tests/skills.test.mjs` and `tests/init.test.mjs`.

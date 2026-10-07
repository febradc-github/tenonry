# Tenonry 0.2.0 fix plan

This file is a complete, self-contained work order for Claude Code. It fixes twelve problems found in a review of Tenonry 0.1.0 and releases the result as 0.2.0.

## How to start

1. Save this file in the tenonry repository as `docs/FIX-0.2.0.md`.
2. Optional: create `.env` at the repository root with `OPENROUTER_API_KEY=sk-or-...` so the live Jev check in F11 can run.
3. Start Claude Code at the repository root (Opus recommended) and send exactly:

```
Read docs/FIX-0.2.0.md and execute it completely and autonomously. Follow its rules, the autonomy protocol in CLAUDE.md, and its definition of done. Do not ask me anything.
```

---

## 0. Rules for this work

1. **Autonomy.** The autonomy protocol in `CLAUDE.md` applies: never ask the developer anything, never end a turn with a question, resolve gaps from this file, then the docs, then live official docs, then the most conservative working option, and log every such decision in `docs/DECISIONS.md` using the next free `D-` number.
2. **Priority.** For the items it covers, this file overrides every other document. Bring the other documents in line with it.
3. **Mirror rule.** Every shipped text exists twice: once in `docs/` (`docs/05-SPECIALIST-CATALOG.json`, `docs/06-AGENT-AND-SKILL-TEXTS.md`, `docs/07-QUALITY-RUBRICS.md`) and once in the shipped file (`library/...`, `skills/...`). Apply every text change to both, identically. The existing tests that compare them must keep passing; extend them to cover any new file.
4. **Old text not found.** Each change gives the old text and the new text. If the old text is not found verbatim because the 0.1.0 build adjusted it, find the passage with the same meaning, apply the change's intent, and log a decision naming the file and what differed.
5. **Spec follows code.** Every behavior change in code is also written into `docs/03-COMPONENT-SPECS.md` (and `docs/01-ARCHITECTURE.md` where it describes the behavior). Remove statements the changes make false; search for them, do not rely on the line references below.
6. **Conventions.** Node 18+ ES modules, zero runtime dependencies, POSIX shells, no em dash characters (U+2014) anywhere in shipped files, readable code (small functions, early returns, comments only for why).
7. **Tests.** Run the suite with `node --test` (no path argument; see D-044). Every fix below lists its required tests. All existing tests must pass; when an existing test asserts behavior this file deliberately changes, update that test and say so in the commit message.
8. **Commits.** One local commit per section, in order: `fix(0.2.0): <section id> <summary>`. Never push. Never bypass git hooks.
9. **Text fences.** In this file, replacement texts are fenced with `~~~~`. The fence lines are not part of the text.

---

## Phase 0: verify before changing anything

Record each result in `docs/DECISIONS.md` as `Phase 0 (0.2.0): <item>` with `Confirmed`, `Changed` (and what you will do instead), or `Unverified` (and the fallback used).

| ID | Check | How | Used by |
|---|---|---|---|
| P1 | Latest `@playwright/mcp` version and its documented flags | Run `npm view @playwright/mcp version` to get `V`. Read the README of version `V` (`npm view @playwright/mcp@V readme`, or the package page). Confirm: a headless flag, an isolated (non-persistent) profile flag, an output directory flag, which browser it launches by default, and the documented command that installs that browser | F7 |
| P2 | Permission rule syntax | From https://code.claude.com/docs/llms.txt, read the permissions page and the skills page. Confirm: skill frontmatter `allowed-tools: Bash(node *)` syntax; `permissions.allow` rules in `.claude/settings.local.json` such as `Bash(node .tenonry/bin/tenonry.mjs *)` and a server-level MCP rule `mcp__playwright`; and whether a Bash command that contains a quoted heredoc (`node ... <<'X'`) is matched by a `Bash(node *)` rule | F5, F6 |
| P3 | `claude -p --output-format json` reports permission denials | Run `claude -p "say ok" --output-format json` in a temporary directory and check for a `permission_denials` field | Final smoke test |

Fallbacks: if P1 cannot be verified, keep `@playwright/mcp@latest`, pass no extra flags, use `npx playwright install chromium` as the install command, and log it. If P2 shows heredocs are not matched by a prefix rule, keep the heredoc form anyway and note in `BUILD-REPORT.md` that Claude Code may ask once for approval of those commands. If P3 finds no such field, skip that smoke assertion and record the skip.

---

## F1. Specialists may use their framework's generators

**Problem.** The specialist template forbids writing files through shell commands, while the catalog tells Prisma, Drizzle, SQLAlchemy, Django ORM, and Doctrine specialists to generate migrations with their tools. Rendered prompts contradict themselves.

**Change `library/templates/specialist.md` and docs/06 section 5.1.**

Old:
~~~~
The ownership guard blocks edits to any other file. Never edit tests; the test author owns them. Never edit files through shell commands such as sed, echo, or cp.
~~~~

New:
~~~~
The ownership guard blocks edits to any other file. Never edit tests; the test author owns them. Do not change files with ad hoc shell commands such as sed, echo, or cp. You may run the project's own code generators and migration tools (for example `php artisan make:migration`, `prisma migrate dev --create-only`, `drizzle-kit generate`, `alembic revision --autogenerate`, `python manage.py makemigrations`) when everything they write is in files you own. Read every generated file before reporting and list it in `filesChanged`. If a generator names a file differently from the contract, such as a different migration timestamp, keep the generated name. Tenonry reverts any change to a file you do not own.
~~~~

**Change `library/core/test-author.md` and docs/06 section 4.3.** In `## Rules`, append this bullet after `- Use exact relative paths. No globs in \`files\`.`:

~~~~
- For files whose names a generator decides, such as timestamped migrations, list the name the project's naming convention would produce. A builder may produce a different timestamp; that is expected and needs no contract change.
~~~~

**Tests.** The rendered specialist for `eloquent` and `prisma` contains the generator sentence; the test author text contains the new bullet; verbatim comparison tests pass.

---

## F2. Specialists verify with their own task's tests only

**Problem.** The test author writes every task's tests before any code, so they fail until each task is built. The specialist template lists project-wide commands such as `php artisan test`, so a specialist sees other tasks' failures and may chase them or raise false contract issues.

**Change `library/templates/specialist.md` and docs/06 section 5.1.**

Old:
~~~~
5. Run the verification commands that apply to your files. Their output is filtered automatically.
{{verify}}
~~~~

New:
~~~~
5. Check your work with your task's tests only. The test author wrote every task's tests before any code, so tests for other tasks are expected to fail until those tasks are built: never run the whole test suite, and never try to fix another task's failures. Run the task test command below with your task's `tests` paths in place of `{files}`. Typecheck and lint check the whole project; fix only errors in your own files. Output is filtered automatically, and Tenonry verifies your task again after you finish.
{{verify}}
~~~~

**New rendering of `{{verify}}`.** Replace the `{{verify}}` row in docs/03 section 9 and the `{{verify}}` note in docs/06 section 6 with this rule, and implement it in the agent renderer:

For each `config.verify` entry whose `root` is the root of a package where this specialist is active, in config order, emit:

- `- task tests: <testFiles>` when `testFiles` is not null. When the entry's `root` is not `.`, append ` (run from <root>; test paths relative to <root>)`.
- `- task tests: no task-scoped test command is configured; do not run tests, Tenonry runs them after you finish.` when `testFiles` is null.
- `- typecheck: <typecheck>` when not null.
- `- lint: <lint>` when not null.

The project-wide `test` command is never rendered for specialists. When the specialist has no matching verify entry, render `- No verification commands are configured for your files.` The literal `{files}` stays in the rendered text.

**Tests.** Rendering for the `laravel-vue` fixture produces `- task tests: php artisan test {files}` and `- lint: ./vendor/bin/pint --test`, and contains no line that is exactly the project-wide test command; the `monorepo` fixture renders the ` (run from apps/api; ...)` suffix for the NestJS specialist; a specialist with a null `testFiles` gets the no-command line; no unrendered `{{` remains.

---

## F3. Styling specialists own all stylesheets; Angular owns its component templates

**Problem.** Framework directory globs outrank the styling specialists, so in Next.js `app/globals.css` and `components/*.module.css` go to the Next.js specialist, and in Remix `app/tailwind.css` goes to Remix. Separately, `**/*.html` (HTML specialist, priority 65) outranks Angular (60), so Angular component templates go to the generic HTML specialist instead of the one that knows Angular's template syntax.

**Change `docs/05-SPECIALIST-CATALOG.json` and `library/catalog.json` identically.** Change only these `priority` values:

| id | old | new |
|---|---|---|
| `css` | 40 | 75 |
| `tailwind` | 45 | 75 |
| `sass` | 50 | 75 |
| `css-in-js` | 60 | 75 |
| `angular` | 60 | 66 |

The styling specialists' globs only match style files and style configs, so the raise moves nothing else. As a consequence, Angular `*.component.css` and `*.component.scss` move to the active styling specialist, which is consistent with the separation of responsibilities.

**Tests (ownership resolution).**

| Active specialists | Path | Expected owner |
|---|---|---|
| nextjs, tailwind, prisma, typescript, nodejs | `app/globals.css` | `tenonry-tailwind` |
| same | `components/PointsCard.module.css` | `tenonry-tailwind` |
| same | `components/PointsCard.tsx` | `tenonry-nextjs` |
| remix, tailwind, typescript, nodejs | `app/tailwind.css` | `tenonry-tailwind` |
| remix, tailwind, typescript, nodejs | `app/routes/loyalty.tsx` | `tenonry-remix` |
| angular, sass, html, typescript, nodejs | `src/app/points/points.component.html` | `tenonry-angular` |
| same | `src/app/points/points.component.scss` | `tenonry-sass` |
| same | `src/index.html` | `tenonry-html` |
| react, css-in-js, typescript, nodejs | `src/components/Card.styles.ts` | `tenonry-css-in-js` |
| laravel, eloquent, php, vue, tailwind, html, nodejs | `resources/css/app.css` | `tenonry-tailwind` |

Add fixtures only where an existing fixture cannot express the case (a minimal `angular-scss` fixture: `package.json` with `@angular/core`, `typescript`, `sass`; `angular.json`; the three component files above; `src/styles.scss`; `src/index.html`). `catalog-check` still passes.

---

## F4. On an existing app, the art director documents the current look

**Problem.** The art director runs in `create` mode whenever `.tenonry/design-direction.md` is missing, which includes the first UI run on any existing app. Nothing tells it to start from the app's current styles, so the first new screen ships in a brand-new identity that clashes with the rest of the app.

**Change `library/core/art-director.md` and docs/06 section 4.2.**

Old:
~~~~
2. Mode `create`: draft the direction (format below). Mode `extend`: keep the existing direction and add only what the new screens need; record additions under "Changelog". Change the established identity only when the brief explicitly asks for a new look.
3. Review your draft before writing. For each of palette, type, layout, and motion, ask: would I have produced this for any similar product?
~~~~

New:
~~~~
2. Mode `create`: first check whether the project already has a user interface: stylesheets, a Tailwind or theme configuration, components, templates, or pages. If it does, it has an existing identity. Read the styles and the main screens, then write the direction by documenting the visual language already in use: extract the palette, type, spacing, radius, elevation, and motion as named tokens, and describe the layout patterns. Keep that identity. Improve it only where it fails the accessibility floor or contradicts itself, and record each such change under "Changelog". Begin the "Point of view" section with the sentence `Existing identity: documented from the current interface.` Create a new identity only when the project has no interface yet or the brief explicitly asks for a redesign. Mode `extend`: keep the existing direction and add only what the new screens need; record additions under "Changelog". Change the established identity only when the brief explicitly asks for a new look.
3. When you created a new identity, review your draft before writing. For each of palette, type, layout, and motion, ask: would I have produced this for any similar product?
~~~~

The rest of step 3 is unchanged.

**Change `library/core/design-reviewer.md` and docs/06 section 4.4.** In `## Calibration`, append:

~~~~
- When the direction's point of view begins with `Existing identity`, judge visual design by consistency with that identity and by craft, not by how original the established look is.
~~~~

**Tests.** Verbatim comparisons pass; the art director text contains `Existing identity: documented from the current interface.`; the design reviewer calibration contains the new bullet.

---

## F5. Fewer permission prompts

**Problem.** The 0.1.0 smoke test showed `--project "$PWD"` is not auto-approved. The run skill calls init that way on every run, has no `allowed-tools`, writes temporary files with the Write tool, and its agents call `node .tenonry/bin/tenonry.mjs` many times, so users may face repeated approval prompts.

**F5.1 Init skill (`skills/init/SKILL.md` and docs/06 section 1).**

Old:
~~~~
2. Run: `node "<plugin root>/scripts/init.mjs" --project "$PWD"`
~~~~

New:
~~~~
2. Run: `node "<plugin root>/scripts/init.mjs"` from the project directory. Init uses the current directory.
~~~~

**F5.2 Run skill (`skills/run/SKILL.md` and docs/06 section 2).**

Frontmatter: add this line after the `argument-hint` line:
~~~~
allowed-tools: Bash(node *), Bash(git rev-parse *)
~~~~

Old (step 1, item 2):
~~~~
2. Run `node "<plugin root>/scripts/init.mjs" --project "$PWD" --if-changed`.
~~~~
New:
~~~~
2. Run `node "<plugin root>/scripts/init.mjs" --if-changed` from the project directory.
~~~~

Old (step 1, item 3, first clause):
~~~~
3. If `agentsDirCreated` is true: save the request with `tenonry.mjs new-run --prompt-file <temp file containing the request>`,
~~~~
New:
~~~~
3. If `agentsDirCreated` is true: save the request by passing it verbatim through a quoted heredoc: `node .tenonry/bin/tenonry.mjs new-run --prompt-stdin <<'TENONRY_REQUEST'`, then the request on the following lines, then a line containing only `TENONRY_REQUEST`. Then
~~~~
Keep the rest of item 3 unchanged (it continues with running `tenonry.mjs restart-pending true` and the restart message).

Old (step 2):
~~~~
- Otherwise write the request to a temporary file, run `tenonry.mjs new-run --prompt-file <file>`, then `tenonry.mjs intake <id>`, and read `route.json`.
~~~~
New:
~~~~
- Otherwise run `tenonry.mjs new-run --prompt-stdin` with the request passed verbatim through a quoted heredoc as in step 1, then `tenonry.mjs intake <id>`, and read `route.json`.
~~~~

Old (step 3):
~~~~
- `clarify: no`: write `.tenonry/runs/<id>/brief.md` with a `# Request` heading followed by the request verbatim.
~~~~
New:
~~~~
- `clarify: no`: run `tenonry.mjs write-brief <id>`.
~~~~

**F5.3 Clarify-intake skill (`skills/clarify-intake/SKILL.md` and docs/06 section 3).**

Frontmatter: add after the `description` line:
~~~~
allowed-tools: Bash(node *)
~~~~

Old:
~~~~
5. Write `.tenonry/runs/<id>/brief.md`:
~~~~
New:
~~~~
5. Save the brief by running `node .tenonry/bin/tenonry.mjs write-brief <id> --stdin` and passing this content through a quoted heredoc (`<<'TENONRY_BRIEF'`, the content, then a line containing only `TENONRY_BRIEF`):
~~~~

**F5.4 New and changed CLI commands (`scripts/tenonry.mjs`, spec in docs/03 section 6).**

| Command | Behavior |
|---|---|
| `new-run --prompt-stdin` | Same as `new-run --prompt`, reading the request from standard input. Strip one trailing newline. Empty input: `{ ok: false, error: "empty_prompt" }`, exit 1. `--prompt` and `--prompt-file` keep working |
| `write-brief <run>` | Writes `.tenonry/runs/<run>/brief.md` as `# Request`, a blank line, the run's prompt verbatim (from `route.json` `prompt`, else `run.json` `prompt`), and a trailing newline. Returns `{ path }` |
| `write-brief <run> --stdin` | Writes standard input to `brief.md` as given, ensuring one trailing newline. Empty input: `{ ok: false, error: "empty_brief" }`, exit 1. Returns `{ path }` |

**F5.5 Project permission rules written by init (`scripts/init.mjs`, spec in docs/03 section 5.1).** Add a step after the `.gitignore` step:

- Ensure `.claude/settings.local.json` contains, in its `permissions.allow` array, each of: `Bash(node .tenonry/bin/tenonry.mjs *)` and `mcp__playwright`. Create the file and the keys if missing. Never remove, reorder, or rewrite other entries or keys; write with 2-space indentation and a trailing newline. If the file exists but is not valid JSON, leave it untouched and add the warning `settings.local.json is not valid JSON; add the Tenonry permission rules by hand`.
- Add `.claude/settings.local.json` to the `.gitignore` lines init ensures.
- Add `permissionsAdded` (true when init added at least one rule) to the init JSON output.
- `--if-changed` also requires both rules to be present; otherwise it runs the full init.

Use the rule syntax confirmed in Phase 0 P2. Document both rules and their purpose in the plugin `README.md` (what they allow: Tenonry's own bookkeeping script, and the review browser).

**Tests.** `new-run --prompt-stdin` and `write-brief` (both forms) with heredoc-like multi-line input containing quotes, `$`, and backticks, preserved byte for byte; empty-input errors; init creates `settings.local.json` with both rules; init merges into an existing file and keeps unrelated keys and entries in order; init leaves invalid JSON untouched with the warning; `--if-changed` reruns when a rule is missing; no shipped skill text contains `$PWD` or `--prompt-file`.

---

## F6. The design reviewer can sign in, and the preview is managed by Tenonry

**Problem.** The preview configuration has no way to sign in, so screens behind a login are judged as the login page or not rendered. Starting and stopping the preview through ad hoc Bash commands also triggers permission prompts.

**F6.1 New CLI commands (`scripts/tenonry.mjs`, spec in docs/03 section 6).**

| Command | Behavior |
|---|---|
| `preview-start` | If `config.preview.url` answers an HTTP GET with a 2xx or 3xx status within 2 seconds, return `{ ok: true, reused: true, url }`. If `config.preview.command` is null, return `{ ok: false, reason: "no_preview" }`. Otherwise spawn `/bin/sh -c <command>` detached in its own process group, in `config.preview.cwd` relative to the project root, with stdout and stderr appended to `.tenonry/logs/preview.log`; write the process group id to `.tenonry/logs/preview.pid`; poll the URL every 2 seconds for up to 90 seconds. Ready: `{ ok: true, reused: false, url, pid }`. Not ready: stop the process group as in `preview-stop` and return `{ ok: false, reason: "preview_failed", log: ".tenonry/logs/preview.log" }` |
| `preview-stop` | If `.tenonry/logs/preview.pid` exists, send SIGTERM to that process group, wait up to 5 seconds, send SIGKILL if it is still alive, delete the pid file, and return `{ stopped: true }`. Otherwise `{ stopped: false }`. It only ever stops a preview Tenonry started |
| `preview-credentials` | Reads `TENONRY_PREVIEW_USER`, `TENONRY_PREVIEW_PASSWORD`, and optional `TENONRY_PREVIEW_LOGIN_URL` from the project `.env` only. Both user and password present: `{ available: true, loginUrl, user, password }`, where `loginUrl` is `TENONRY_PREVIEW_LOGIN_URL` (a full URL, or a path joined to `config.preview.url`), defaulting to `<config.preview.url>/login`. Otherwise `{ available: false }`. These values are never logged or written anywhere else |

**F6.2 Review delegation (docs/03 section 6.10).** Design review delegations gain one line after `preview_cwd`: `login: available` when `preview-credentials` would return `available: true`, otherwise `login: none`. Credentials never appear in a delegation. The `preview_command`, `preview_url`, and `preview_cwd` lines stay for information.

**F6.3 Design reviewer process (`library/core/design-reviewer.md` and docs/06 section 4.4).** Replace the whole `## Process` section with:

~~~~
## Process

1. Read `.tenonry/rubrics/design.md`, the design direction, the design brief, and the contract task. Know what the art director decided before you look. Set the task's profile: `showcase` if any screen this task affects is marked `showcase` in the brief, otherwise `product`.
2. Run `node .tenonry/bin/tenonry.mjs preview-start`. If it returns `ok: false`, set `rendered: false` and `unrenderedReason` to its `reason`, review from the design direction, the brief, and the changed files, and continue at step 6.
3. If the delegation says `login: available`, run `node .tenonry/bin/tenonry.mjs preview-credentials`, open its `loginUrl` with the Playwright tools, and sign in before visiting any screen. Never write the credentials into any file, finding, or summary.
4. With the Playwright tools, open each screen this task affects. If the browser cannot start, set `rendered: false` and `unrenderedReason: "browser_missing"`, and continue at step 6. If a screen redirects to a sign-in page you cannot get past, do not review the sign-in page in its place: set `rendered: false` and `unrenderedReason: "needs_login"`, and continue at step 6. Otherwise, at widths 375, 768, and 1440, take a screenshot named `<run>-<task>-<screen>-<width>.png` and study it. Exercise the states the brief lists (empty, error, loading, long content) where you can reach them.
5. Check interaction and access: move through the page with Tab and confirm visible focus and logical order; activate the primary action with the keyboard; check hover and active states; confirm motion respects `prefers-reduced-motion` (inspect the styles if you cannot toggle it); compute contrast ratios for the main text and UI color pairs from the tokens; note heavy assets, layout shift, and slow loading.
6. Score the seven criteria from 0 to 10 using the anchors in the rubric. When `rendered` is false, still score from what you could read; such a review never counts as a pass. Then write findings: each with a severity, the criterion, the file responsible when you can tell from the changed files, the problem, and a concrete fix that stays within the design direction.
7. Write the result to `write_to` in the JSON format below, listing the paths where your screenshots were actually saved. If `preview-start` returned `reused: false`, run `node .tenonry/bin/tenonry.mjs preview-stop`.
~~~~

**F6.4 Design reviewer output.** In the same file's `## Output` JSON, add `"profile": "showcase | product",` after `"round"`, and add `"unrenderedReason": null,` after `"rendered": true,`. Update the design review schema in docs/03 section 4.8 to match: `profile` is `showcase` or `product`; `unrenderedReason` is null when `rendered` is true, otherwise one of `no_preview`, `preview_failed`, `browser_missing`, `needs_login`, or a short free-text reason.

**F6.5 Documentation.** In the plugin `README.md`, add a short "Signed-in screens" section: add `TENONRY_PREVIEW_USER`, `TENONRY_PREVIEW_PASSWORD`, and optionally `TENONRY_PREVIEW_LOGIN_URL` to `.env`, using a local test account only, never a real one.

**Tests.** `preview-start` reuses a running local `node:http` server; starts a fixture command (a small Node script that listens on a free port) and returns its pid; returns `preview_failed` and kills the process group when the command never listens (use a short timeout override available only to tests, such as an environment variable `TENONRY_PREVIEW_TIMEOUT_MS`); returns `no_preview` with a null command. `preview-stop` stops only a Tenonry-started process and is a no-op without a pid file. `preview-credentials` resolves full URLs and paths, defaults to `/login`, and returns `available: false` when either value is missing; its values never appear in any log file. Review delegations contain `login: available` or `login: none` and never a credential.

---

## F7. Unrendered design reviews never pass, and the review browser is pinned

**Problem.** A design review that never rendered the page can pass on scores guessed from code. The Playwright server is unpinned (`@latest`) and needs a browser, so a machine without one silently gets no visual review on every run.

**F7.1 `review-status` (docs/03 section 6.5).** Replace step 3 with:

~~~~
3. Design: if `rendered` is false, the design status is `unrendered`. It never triggers a fix round, and the task's final status becomes `done_with_findings` with the attention note for its `unrenderedReason` (section 6.8). Otherwise recompute `weighted` from `scores` using the weights of the review's `profile` (a missing or invalid profile counts as `showcase`), rounded to 2 decimals, ignoring the reviewer's own figure. Pass when `weighted >= 7.5`, no finding is `blocking`, and every score is at least 6, except that on `product` screens `innovation` needs only 5.
~~~~

and replace step 4 with:

~~~~
4. `overall`: `pass` when every planned kind passes or is `unrendered`. An `error` counts as fail for that round.
~~~~

Then make `checkpoint` set `done_with_findings` instead of `done` when the task's latest design status is `unrendered`. Remove every mention of `pass_unrendered` from code, docs, and tests.

**F7.2 Attention notes (docs/03 section 6.8, `report` summary `attention`).** For each task whose design status is `unrendered`, add exactly one note:

| `unrenderedReason` | Note |
|---|---|
| `needs_login` | `Design for <task> was not visually checked: the screen needs a signed-in user. Add TENONRY_PREVIEW_USER and TENONRY_PREVIEW_PASSWORD (a local test account) to .env.` |
| `browser_missing` | `Design for <task> was not visually checked: the review browser is not installed. Run: <install command>` |
| `preview_failed` | `Design for <task> was not visually checked: the preview server did not start. See .tenonry/logs/preview.log.` |
| `no_preview` | `Design for <task> was not visually checked: no preview command was detected. Set "preview" in .tenonry/config.json.` |
| anything else | `Design for <task> was not visually checked: <reason>.` |

`<install command>` is the browser install command confirmed in Phase 0 P1 (fallback `npx playwright install chromium`), stored as one constant in code.

**F7.3 Pin the Playwright server (`library/core/design-reviewer.md` and docs/06 section 4.4).** In the frontmatter, replace:

~~~~
      args: ["-y", "@playwright/mcp@latest"]
~~~~

with the pinned version `V` from Phase 0 P1, plus only the flags P1 confirmed, in this order when available: headless, isolated, output directory set to `.tenonry/logs/screenshots`. For example, if all three were confirmed with the names `--headless`, `--isolated`, and `--output-dir`:

~~~~
      args: ["-y", "@playwright/mcp@V", "--headless", "--isolated", "--output-dir", ".tenonry/logs/screenshots"]
~~~~

Use the real flag names from the README, never guessed ones. `.tenonry/logs/` is already gitignored.

**Tests.** Unrendered reviews produce `overall: pass`, `action: checkpoint`, final status `done_with_findings`, and the matching attention note for each reason; a rendered showcase review at the old pass boundary still passes; no file contains `pass_unrendered`; the design reviewer frontmatter contains no `@latest` when P1 succeeded.

---

## F8. No dead Python agent in Django, FastAPI, or Flask projects

**Problem.** Django, FastAPI, and Flask each own `**/*.py` at a higher priority than the Python specialist, so Python is activated and rendered as two agents that can never receive a task.

**Change `docs/05-SPECIALIST-CATALOG.json` and `library/catalog.json` identically.** Set `supersedes` to `["python"]` for `django`, `fastapi`, and `flask`.

**Tests.** The `django` fixture no longer activates `python` and renders no `tenonry-python.md` or `tenonry-review-python.md`; a FastAPI project (`requirements.txt` containing `fastapi`, `app/main.py`) activates `fastapi` without `python`; a plain Python project still activates `python`.

---

## F9. Frontend code reviewers check the UI rules

**Problem.** The UI rules (tokens only, every state built, accessibility in code) go into frontend builders but not into their code reviewers.

**F9.1 New file `library/templates/ui-review-rules.md`, mirrored as a new docs/06 section 5.4 titled `### 5.4 UI review rules block (\`{{uiReview}}\` for layers \`frontend\` and \`3d\`)`.** Content:

~~~~

## UI rules to check

For UI work, read `design_direction` and `design_brief` from the delegation, then check every UI file in the change. A violation is `major`; a missing state that breaks a user flow is `blocking`.

- U1. Only the direction's tokens are used for color, type, spacing, radius, elevation, and motion. No hardcoded values.
- U2. Every state the brief lists is implemented: loading, empty, error, success, and long content.
- U3. Accessibility in code: semantic elements, labels on controls, alt text, visible focus styles, keyboard support on custom controls, and `prefers-reduced-motion` respected.
- U4. Copy comes from the brief. No lorem ipsum. Buttons say what they do.
- U5. No decoration, animation, or effect the direction does not call for.
~~~~

(The file starts with a blank line, like `ui-rules.md`.)

**F9.2 Code reviewer template (`library/templates/code-reviewer.md` and docs/06 section 5.3).**

Old:
~~~~
3. Check, in order: correctness against the acceptance criteria and interfaces; security and data handling; the rubric items C1 to C12; the idioms and slop list below; consistency with the project's conventions.
4. Write findings with a severity, file, line, rule id (`C1` to `C12`, or `S1` and up for the slop list below), the problem, and a concrete fix.
~~~~
New:
~~~~
3. Check, in order: correctness against the acceptance criteria and interfaces; security and data handling; the rubric items C1 to C12; the idioms and slop list below; the UI rules below, when present; consistency with the project's conventions.
4. Write findings with a severity, file, line, rule id (`C1` to `C12`, `S1` and up for the slop list below, or `U1` to `U5` for the UI rules), the problem, and a concrete fix.
~~~~

Old:
~~~~
## Slop list for this specialty

{{slop}}
~~~~
New:
~~~~
## Slop list for this specialty

{{slop}}
{{uiReview}}
~~~~

**F9.3 Rendering and delegation.** Add the `{{uiReview}}` variable to docs/03 section 9: the content of `library/templates/ui-review-rules.md` for layers `frontend` and `3d`, otherwise an empty string. In docs/03 section 6.10, replace `Code reviews omit the \`design_*\` and \`preview_*\` lines.` with `Code reviews omit the \`preview_*\` and \`login\` lines, and omit the \`design_*\` lines when the task is not \`ui\`.` In docs/03 section 4.7, document that `rule` may also be `U1` to `U5`.

**Tests.** The rendered `tenonry-review-vue.md` contains `U1.` and `## UI rules to check`; the rendered `tenonry-review-laravel.md` does not; code review delegations for `ui: true` tasks include `design_direction` and `design_brief` lines and for other tasks do not; the verbatim test covers the new file.

---

## F10. Showcase and product scoring profiles

**Problem.** The awards weighting (innovation 20%, storytelling 10%) suits marketing pages. Product screens such as forms, tables, and settings rarely reach 7.5 under it, so they burn three Opus design rounds and end with findings.

**F10.1 Art director design brief (`library/core/art-director.md` and docs/06 section 4.2).** In the design brief format, after the line `- Purpose and primary action`, add:

~~~~
- Profile: `showcase` (marketing, landing, and storytelling pages judged as award work) or `product` (screens where people get work done: forms, tables, dashboards, settings)
~~~~

**F10.2 Design rubric (`library/rubrics/design.md` and docs/07 section 1).**

Old:
~~~~
## Pass rule

Weighted score of at least 7.5, every criterion at least 6, and no blocking finding.
~~~~
New:
~~~~
## Pass rule

Each screen has a profile set in the design brief: `showcase` or `product`. A review uses the strictest profile among its screens. Pass with a weighted score of at least 7.5 using that profile's weights, no blocking finding, and every criterion at least 6, except that on `product` screens innovation needs only 5.

## Profiles

| Criterion | showcase | product |
|---|---|---|
| ux | 0.15 | 0.25 |
| visual | 0.15 | 0.15 |
| content | 0.10 | 0.05 |
| accessibility | 0.10 | 0.15 |
| performance | 0.20 | 0.15 |
| responsive | 0.10 | 0.15 |
| innovation | 0.20 | 0.10 |

Showcase pages are judged as award entries. Product screens are judged as tools: clarity, accessibility, and responsiveness carry more weight, and the identity is applied consistently rather than reinvented.
~~~~

In each `### <criterion>` heading of the same rubric, replace `(weight X)` with `(weight: showcase X, product Y)` using the table above, for example `### ux: User experience and strategy (weight: showcase 0.15, product 0.25)`.

**F10.3 Code (`review-status`).** Implement both weight tables exactly as above (see F7.1). Both tables sum to 1.00; add a test that asserts it.

**Tests.** A product review with scores ux 8, visual 7, content 7, accessibility 8, performance 8, responsive 8, innovation 5 passes (weighted 7.50); the same scores under `showcase` fail (innovation below 6); a product review with innovation 4 fails; a missing profile uses showcase weights.

---

## F11. One live Jev check

**Problem.** Jev was only tested against a local stand-in.

**Change.** Add `tests/jev-live.test.mjs`. It is skipped unless the environment variable `TENONRY_LIVE=1` is set and the repository root `.env` contains a non-empty `OPENROUTER_API_KEY`. When it runs, it calls the real Jev client once with the dispatch question set from docs/04 section 4 and a small fixed task state, and asserts `ok: true`, that answers pass the client's own validation, and that `cost` is a number. It must never print the key. Normal `node --test` runs skip it without network access.

During this work, if the key exists, run it once with `TENONRY_LIVE=1 node --test tests/jev-live.test.mjs` and record the outcome, answers, and cost in `BUILD-REPORT.md`. If the key does not exist, record the skip.

---

## F12. Housekeeping

1. `CLAUDE.md` and `docs/08-BUILD-PLAN-AND-TESTS.md`: every `node --test tests/` becomes `node --test`.
2. Version 0.2.0: set the version in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and anywhere code reads or writes the plugin version. Because the manifest hash includes the plugin version, existing projects re-render their agents on the next `/tenonry:run`; state this in the README's changelog section (create one if missing, listing F1 to F11 in one line each).
3. `docs/01-ARCHITECTURE.md`: add to section 8 (user experience rules) one bullet for fewer permission prompts (F5) and one for signed-in screen review (F6). Update any other passage these changes make false.
4. `docs/08-BUILD-PLAN-AND-TESTS.md`: replace `pass_unrendered` in the slice 5 test list with `unrendered reviews ending as done_with_findings`, and add one line per fix in this file under a new heading `## Revision 0.2.0 tests` that points to the tests listed here.

---

## Decisions to record

Append these to `docs/DECISIONS.md` (next free numbers, after the Phase 0 entries), each with context, decision, and reason taken from this file:

1. Specialists may run framework generators for owned files (F1).
2. Specialists verify with task-scoped tests only; the full suite runs in `verify` and the final gate (F2).
3. Styling specialists at priority 75; Angular at 66 (F3).
4. Existing apps: the art director documents the current identity (F4).
5. Permission friction: allowed-tools, heredoc input, `write-brief`, and the two project permission rules (F5).
6. Preview managed by Tenonry; optional preview sign-in from `.env` (F6).
7. Unrendered design reviews never pass; Playwright server pinned to version V (F7).
8. Django, FastAPI, and Flask supersede Python (F8).
9. UI review rules for frontend and 3d code reviewers (F9).
10. Showcase and product scoring profiles (F10).
11. Opt-in live Jev test (F11).

---

## Final steps

1. Run `node --test`; all tests pass with zero failures.
2. Run `node scripts/tenonry.mjs catalog-check`; it passes.
3. Run `claude plugin validate .` and `claude plugin validate . --strict` if the CLI is available.
4. Smoke test, if the `claude` CLI is available and authenticated, in a fresh temporary copy of the `laravel-vue` fixture (git repository, committed), using project scope as in D-057:
   1. Install the plugin from this repository.
   2. `claude -p "/tenonry:init" --output-format json`: assert `.claude/settings.local.json` contains both permission rules, and, if Phase 0 P3 confirmed the field, that `permission_denials` is empty.
   3. `claude -p "/tenonry:run status" --output-format json`: assert it prints the status text and, if P3 confirmed the field, that `permission_denials` is empty.
   4. `claude -p "/tenonry:run help"`: assert it prints the help block.
   5. Uninstall and delete the temporary copy.
   Do not run `/tenonry:run <request>` (token cost). Record every skipped step with its reason.
5. Append a `## Revision 0.2.0` section to `BUILD-REPORT.md`: what changed (one line per fix), test totals, Phase 0 results, the live Jev outcome or skip, skipped checks with reasons, and the new decision numbers.
6. Commit the report.

## Definition of done

- F1 to F12 are implemented, mirrored between `docs/` and shipped files, specified in docs/03, and committed one section per commit.
- `node --test` passes with zero failures; `catalog-check` passes; plugin validation passes or its skip is recorded.
- No shipped file contains `pass_unrendered`, `--prompt-file` in skill texts, `$PWD` in skill texts, or U+2014.
- `BUILD-REPORT.md` has the Revision 0.2.0 section, and `docs/DECISIONS.md` has every new decision.

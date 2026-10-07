# 03. Component specifications

All paths are relative to the plugin root unless marked `<project>`. Every JSON written to disk is pretty-printed with 2-space indentation and a trailing newline, written atomically (write `<file>.tmp`, then rename).

## 1. Manifests

### 1.1 `.claude-plugin/plugin.json`

```json
{
  "name": "tenonry",
  "version": "0.1.0",
  "description": "Specialist multi-agent pipeline: Jev-routed models, spec-first tests, single-owner files, design and code reviewers.",
  "author": { "name": "Dan Christian Febra" },
  "keywords": ["agents", "orchestration", "jev", "openrouter", "code-quality", "design"]
}
```

### 1.2 `.claude-plugin/marketplace.json` (for local install and testing)

```json
{
  "name": "tenonry-local",
  "owner": { "name": "Dan Christian Febra" },
  "plugins": [
    { "name": "tenonry", "source": "./", "description": "Specialist multi-agent pipeline with Jev routing.", "version": "0.1.0" }
  ]
}
```

### 1.3 `hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-session-start.mjs\"", "timeout": 5 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-prompt-router.mjs\"", "timeout": 15 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-output-filter.mjs\"", "timeout": 5 } ] },
      { "matcher": "Read", "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-read-guard.mjs\"", "timeout": 5 } ] }
    ]
  }
}
```

## 2. Shared library (`scripts/lib/`)

### 2.1 `paths.mjs`

- `findProjectRoot(startDir)`: walk up from `startDir` until a directory containing `.tenonry/config.json` is found; return its absolute path or `null`.
- `pluginRoot()`: absolute path two levels above `scripts/lib/paths.mjs` when running from the plugin, or the directory above `.tenonry/bin/lib/` when running from a project copy. Determine by checking for `library/catalog.json` (plugin) or `.tenonry/config.json` (project).
- `rel(root, absPath)`: POSIX relative path, no leading `./`. Return `null` if the path is outside `root`.
- `runDir(root, runId)`: `<root>/.tenonry/runs/<runId>`.

### 2.2 `json.mjs`

- `readJson(path, fallback)`: parse or return `fallback` when missing; throw on invalid JSON only when `fallback` is `undefined`.
- `writeJsonAtomic(path, value)`: mkdir -p, write `.tmp`, rename.
- `appendJsonl(path, value)`: mkdir -p, append one line.
- `printResult(value)`: `process.stdout.write(JSON.stringify(value) + "\n")`.
- `readStdinJson()`: read all stdin, parse; return `null` on empty or invalid input.

### 2.3 `env.mjs`

- `readProjectEnv(root)`: read `<root>/.env` only (never `process.env`, per decision D-006). Parse lines `KEY=VALUE` with optional leading `export `. Skip blank lines and lines starting with `#`. Strip one pair of matching surrounding single or double quotes. No variable interpolation. Return a plain object. Missing file returns `{}`.
- Values must never be printed, logged, or included in thrown error messages.

### 2.4 `glob.mjs`

`compileGlob(glob)` returns an anchored `RegExp`; `matchGlob(glob, relPath)` returns a boolean. Paths are POSIX, relative, no leading `./`.

Translation rules, applied left to right:

| Pattern | Regex |
|---|---|
| `**/` | `(?:.*/)?` |
| `/**` at the end | `(?:/.*)?` |
| `**` anywhere else | `.*` |
| `*` | `[^/]*` |
| `?` | `[^/]` |
| `{a,b,c}` | `(?:a|b|c)`; alternatives may contain `*` and `?`; no nesting |
| any regex metacharacter | escaped |

Required test cases:

| Glob | Path | Match |
|---|---|---|
| `**/*.vue` | `App.vue` | yes |
| `**/*.vue` | `src/components/Btn.vue` | yes |
| `app/**` | `app/Http/Kernel.php` | yes |
| `app/**` | `app` | yes |
| `app/**` | `apps/x.php` | no |
| `**/*.{ts,tsx}` | `src/a.tsx` | yes |
| `**/*.{ts,tsx}` | `src/a.ts.bak` | no |
| `*.md` | `docs/a.md` | no |
| `src/**/test_*.py` | `src/pkg/test_api.py` | yes |
| `.tenonry/runs/*/plan.md` | `.tenonry/runs/r-1/plan.md` | yes |
| `.env.*` | `.env.local` | yes |
| `**/package.json` | `package.json` | yes |

### 2.5 `jev.mjs`

- `askJev({ root, kind, state, questions, timeoutMs })` returns `{ ok: true, answers, cost, latencyMs }` or `{ ok: false, reason }`.
- Reasons: `disabled` (env `TENONRY_JEV_DISABLE=1`), `no_key`, `timeout`, `http_<status>`, `network`, `invalid_response`.
- Fixture mode: when `process.env.TENONRY_JEV_FIXTURE` names a JSON file, return `fixture[kind]` as `answers` without a network call (`ok: true`, `cost: 0`). If the kind is missing in the fixture, return `{ ok: false, reason: "invalid_response" }`.
- Endpoint override: `TENONRY_JEV_URL` replaces the endpoint URL. It exists only for tests against a local server; document it as test-only.
- Request: `POST https://openrouter.ai/api/alpha/decisions`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, body `{ "model": config.routing.jevModel, "state": state, "questions": questions }`. Abort with `AbortController` at `timeoutMs` (default `config.routing.timeoutMs`, 8000).
- Validation: response must contain `answers` with every question id, and each answer's `type` must equal the question's type. Noul needs a numeric `noul`; Choice needs a string `choice` that is one of the criteria keys plus numeric `confidence`; Score needs numeric `score` and `confidence`. Otherwise `invalid_response`.
- State size: serialize `state`; if longer than 60,000 characters, truncate long string fields (longest first) and append `" [truncated]"` until under the limit.
- Every call appends a line to `<project>/.tenonry/logs/jev-decisions.jsonl` (schema 4.9). The API key never appears in logs.

### 2.6 `ownership.mjs`

- `systemRules()`: the fixed rules in section 3.3.
- `loadRules(root, runId)`: `ownership.json` rules plus, when `runId` is given, `<runDir>/owner-rules.json` rules.
- `resolveOwner(rules, relPath)`: collect matching rules, pick the highest `priority`; ties go to the longer `glob` string, then the earlier rule. Return `{ owner, rule }` or `null`.
- `ownerAllows(owner, agentName)`: true when `owner === agentName`, `owner === "*"`, or `owner` is an array containing `agentName` or a pattern (`*` wildcard only) matching it. `"none"` always false.

### 2.7 `detect.mjs`

See section 5.2 for the algorithm. Exports `findPackageRoots(root)`, `detectPackage(root, pkgRoot, catalog)`, `detectAll(root, catalog)`, `packageManager(pkgDir)`.

### 2.8 `render.mjs`

- `renderTemplate(text, vars)`: replace every `{{name}}` with `vars[name]`. A missing variable throws (tests must catch template drift).
- `bullets(list)`: `"- item"` lines joined by `\n`.
- `yamlList(list)`: lines `"  - item"` joined by `\n` (for frontmatter lists).
- Every agent source text already ends with the line `<!-- generated by tenonry init; edits are overwritten -->`. `render.mjs` asserts the rendered output ends with it and never adds a second copy. Init uses this marker to recognize files it may overwrite or delete.

### 2.9 `git.mjs`

- `isGitRepo(root)`: `git rev-parse --is-inside-work-tree` succeeds.
- `head(root)`: `git rev-parse HEAD`, or `null` for a repo without commits.
- `changedPaths(root)`: parse `git status --porcelain=v1 -z -uall`; return relative paths (for renames, the new path).
- `hashFile(root, rel)`: sha1 hex of file contents, or `null` if missing.
- `snapshot(root)`: `{ head, files: { <path>: <hash|null> } }` for every path in `changedPaths`.
- `diffSince(root, snapshot)`: every path in the current `changedPaths(root)` whose current hash differs from `snapshot.files[path]`. A path absent from the snapshot was clean at baseline, so it counts as changed. Paths that were dirty at baseline and are clean now (committed by another task's checkpoint, or reverted) are not returned.
- `commit(root, paths, message)`: `git add -A -- <paths>` then `git commit -m <message>`. Never pass `--no-verify`. Return `{ sha }` or `{ error }`.
- `restore(root, rel, snapshotHash)`: if the path was clean at snapshot (absent from snapshot files) and is tracked, `git restore --source=HEAD --staged --worktree -- <rel>`; if it was untracked and new, delete it; otherwise return `{ restored: false, reason: "dirty_at_baseline" }`.

### 2.10 `state.mjs`

- `.tenonry/state.json`: `{ "activeRun": <runId|null>, "restartPending": <bool>, "notices": { "jevKeyMissing": <bool, true once the missing-key notice was shown> } }`.
- `newRun(root, prompt)`: id `r-YYYYMMDD-HHMMSS-<4 random hex>` (UTC), creates `runs/<id>/`, `reports/`, `reviews/`, writes `run.json` (section 4.3), marks any previous active run that is not `done` as `stopped`, sets `activeRun`.
- `loadRun`, `saveRun`, `updateTask(run, taskId, patch)`.

### 2.11 `contract.mjs`

`checkContract(root, runId)` implements section 4.5. Returns `{ valid, errors: [string], warnings: [string] }`.

## 3. Ownership

### 3.1 `ownership.json` schema

```json
{
  "version": 1,
  "generatedAt": "<ISO>",
  "rules": [
    { "glob": "app/**", "owner": "tenonry-laravel", "priority": 50, "source": "catalog:laravel" }
  ]
}
```

`owner` is an agent name, `"*"` (any agent), `"none"` (no agent), or an array of names and `*` patterns.

### 3.2 Catalog rules

For each active specialist in each package, for each glob in `owns`: glob is `g` when the package root is `.`, otherwise `<pkgRoot>/<g>`. Owner `tenonry-<id>`, priority from the catalog, source `catalog:<id>`.

### 3.3 System rules (always present, in this order)

| Glob | Owner | Priority |
|---|---|---|
| `.env.example` | `*` | 1150 |
| `**/.env.example` | `*` | 1150 |
| `.env` | `none` | 1100 |
| `.env.*` | `none` | 1100 |
| `**/.env` | `none` | 1100 |
| `**/.env.*` | `none` | 1100 |
| `.git/**` | `none` | 1100 |
| `**/node_modules/**` | `none` | 1100 |
| `vendor/**` | `none` | 1100 |
| `**/vendor/**` | `none` | 1100 |
| `.claude/**` | `none` | 1100 |
| `.tenonry/config.json` | `none` | 1100 |
| `.tenonry/ownership.json` | `none` | 1100 |
| `.tenonry/state.json` | `none` | 1100 |
| `.tenonry/bin/**` | `none` | 1100 |
| `.tenonry/rubrics/**` | `none` | 1100 |
| `.tenonry/logs/**` | `none` | 1100 |
| `.tenonry/runs/*/run.json` | `none` | 1100 |
| `.tenonry/runs/*/route.json` | `none` | 1100 |
| `.tenonry/runs/*/owner-rules.json` | `none` | 1100 |
| `.tenonry/runs/*/brief.md` | `none` | 1100 |
| `.tenonry/runs/*/report.md` | `none` | 1100 |
| `**/{package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lockb,bun.lock,composer.lock,Cargo.lock,poetry.lock,Gemfile.lock,go.sum,mix.lock,pubspec.lock,uv.lock}` | `none` | 1100 |
| `.tenonry/runs/*/plan.md` | `tenonry-planner` | 1000 |
| `.tenonry/design-direction.md` | `tenonry-art-director` | 1000 |
| `.tenonry/runs/*/design-brief.md` | `tenonry-art-director` | 1000 |
| `.tenonry/runs/*/contract.json` | `tenonry-test-author` | 1000 |
| `.tenonry/runs/*/contract.md` | `tenonry-test-author` | 1000 |
| `.tenonry/runs/*/reviews/**` | `["tenonry-design-reviewer", "tenonry-review-*"]` | 1000 |
| `.tenonry/runs/*/reports/**` | `*` | 1000 |
| `**/{package.json,composer.json,pyproject.toml,requirements.txt,requirements-dev.txt,go.mod,Cargo.toml,Gemfile,mix.exs,pom.xml,build.gradle,build.gradle.kts,pubspec.yaml,.gitignore}` | `*` | 1000 |
| `**/*.csproj` | `*` | 1000 |

### 3.4 Test rules (priority 900, owner `tenonry-test-author`)

`**/*.test.*`, `**/*.spec.*`, `**/*.test-d.ts`, `**/__tests__/**`, `tests/**`, `test/**`, `**/tests/**`, `spec/**`, `**/spec/**`, `e2e/**`, `**/e2e/**`, `**/*_test.go`, `**/test_*.py`, `**/*_test.py`, `**/conftest.py`, `**/src/test/**`, `**/*Test.php`, `**/{vitest,jest,playwright}.config.*`, `**/phpunit.xml`, `**/phpunit.xml.dist`, `**/pytest.ini`, `**/.rspec`.

### 3.5 Run-scoped rules

`<runDir>/owner-rules.json` has the same schema as `ownership.json`. Rules added by `tenonry.mjs owner` use priority 950, the exact path as glob, and source `jev:<runId>` or `heuristic:<runId>`.

## 4. Runtime schemas

### 4.1 `.tenonry/config.json`

```json
{
  "version": 1,
  "plugin": "tenonry",
  "pluginVersion": "0.1.0",
  "initializedAt": "<ISO>",
  "packages": [
    { "root": ".", "packageManager": "npm", "specialists": ["laravel", "eloquent", "vue", "tailwind", "html", "php", "nodejs"] }
  ],
  "activeSpecialists": ["eloquent", "html", "laravel", "nodejs", "php", "tailwind", "vue"],
  "agents": ["tenonry-planner", "tenonry-art-director", "tenonry-test-author", "tenonry-design-reviewer", "tenonry-laravel", "tenonry-review-laravel"],
  "verify": [
    { "root": ".", "test": "php artisan test", "testFiles": "php artisan test {files}", "typecheck": null, "lint": "./vendor/bin/pint --test" }
  ],
  "preview": { "command": "composer run dev", "url": "http://127.0.0.1:8000", "cwd": "." },
  "routing": {
    "jevModel": "typesafe/jev-1.13",
    "timeoutMs": 8000,
    "thresholds": {
      "clarifyIfAmbiguity": 0.6,
      "haiku": { "minFullySpecified": 0.8, "maxDifficulty": 0.6, "maxBlastRadius": 0.5 },
      "opus": { "minDifficulty": 2.0, "minBlastRadius": 1.5 },
      "roundUpIfConfidenceBelow": 0.5,
      "codeReviewOpus": { "minRisky": 0.5, "minBlastRadius": 1.5 },
      "newFileOwnerMinConfidence": 0.5
    }
  },
  "limits": {
    "maxParallel": 3,
    "maxTestRetriesPerTier": 2,
    "maxDesignRounds": 3,
    "maxCodeReviewRounds": 2,
    "maxContractFixes": 2
  },
  "readGuard": { "extraDeny": [], "allow": [] },
  "outputFilter": { "maxLines": 120, "extraCommands": [] }
}
```

On re-init, `routing`, `limits`, `readGuard`, and `outputFilter` are preserved from the existing file (deep merge, existing values win); everything else is regenerated.

### 4.2 `route.json`

```json
{
  "runId": "r-20261007-101500-a1b2",
  "createdAt": "<ISO>",
  "prompt": "<request text without the /tenonry:run prefix>",
  "jev": "ok",
  "fallbackReason": null,
  "answers": { },
  "clarify": "no",
  "difficulty": 1.2,
  "difficultyConfidence": 0.81,
  "taskType": "feature",
  "ui": 0.92,
  "mainModel": { "current": "sonnet", "notice": false }
}
```

`clarify` is `yes`, `no`, or `auto` (Jev unavailable: the clarify-intake skill decides). `jev` is `ok` or `fallback`. `mainModel.notice` is true when the main session runs on Haiku; the `run` skill then shows a one-line tip and continues.

### 4.3 `run.json`

```json
{
  "id": "r-20261007-101500-a1b2",
  "createdAt": "<ISO>",
  "prompt": "<request>",
  "phase": "intake",
  "contractFixes": 0,
  "finalGate": null,
  "finalGateReopened": false,
  "undone": false,
  "tasks": {
    "T1": {
      "status": "pending",
      "owner": "tenonry-eloquent",
      "tier": null,
      "failuresOnTier": 0,
      "attempts": [ { "model": "haiku", "startedAt": "<ISO>", "result": "pass" } ],
      "reviewRounds": { "design": 0, "code": 0 },
      "baseline": null,
      "changedFiles": [],
      "commit": null,
      "notes": []
    }
  }
}
```

`phase`: `intake`, `planning`, `design`, `contract`, `building`, `final-gate`, `done`, `stopped`. Task `status`: `pending`, `running`, `verifying`, `reviewing`, `done`, `done_with_findings`, `blocked`. Tasks are added to `run.json` when the contract first validates.

### 4.4 `contract.json`

```json
{
  "version": 1,
  "runId": "r-20261007-101500-a1b2",
  "title": "Loyalty points",
  "summary": "Customers earn points per order and see their balance.",
  "interfaces": [
    {
      "name": "GET /api/loyalty/balance",
      "kind": "http",
      "definition": "Response 200: {\"points\": integer, \"tier\": \"bronze\"|\"silver\"|\"gold\"}. 401 when unauthenticated.",
      "provider": "tenonry-laravel",
      "consumers": ["tenonry-vue"]
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "title": "Points table and model",
      "owner": "tenonry-eloquent",
      "summary": "Migration, model, and factory for loyalty points.",
      "files": ["database/migrations/2026_10_07_000000_create_loyalty_points_table.php", "app/Models/LoyaltyPoint.php", "database/factories/LoyaltyPointFactory.php"],
      "dependsOn": [],
      "acceptance": ["A loyalty_points row belongs to a user and stores an integer balance that cannot be negative."],
      "tests": ["tests/Unit/LoyaltyPointTest.php"],
      "ui": false,
      "newScreen": false,
      "interfaces": []
    }
  ],
  "notes": ""
}
```

A builder may run the project's own generators and migration tools for files it owns, and a generator may name a file differently from the contract (for example a migration with a different timestamp). That needs no contract change: `verify`, `ownership-check`, and `checkpoint` work from the files that actually changed since the task's baseline and attribute every one the task owner may change, whether or not it is listed in `files`.

### 4.5 Contract validation (`contract-check`)

Errors (any one makes the contract invalid):

1. Not valid JSON, `version` is not 1, or `runId` differs from the run.
2. No tasks; a task id not matching `^T[0-9]+$`; duplicate ids.
3. `owner` is not in `config.agents`, or is a core or reviewer agent (`tenonry-planner`, `tenonry-art-director`, `tenonry-test-author`, `tenonry-design-reviewer`, `tenonry-review-*`).
4. Empty `files`; a path that is absolute, contains `..`, or resolves (ownership rules plus run rules) to an owner that does not allow the task owner. The error names the actual owner or says `unowned`.
5. A file listed in more than one task.
6. `dependsOn` naming an unknown task, or a dependency cycle.
7. A `tests` path whose owner is not `tenonry-test-author`, or that does not exist on disk.
8. An interface `provider` or `consumers` entry not in `config.agents`; a task `interfaces` entry naming an unknown interface.
9. A task with `ui: true` whose owner's catalog layer is not `frontend` or `3d`.

Warnings (reported, not blocking): a task with no tests; a task with more than 12 files; `newScreen: true` with `ui: false`.

### 4.6 Task report (`reports/<task>.json`, written by specialists)

```json
{
  "task": "T1",
  "agent": "tenonry-eloquent",
  "status": "done",
  "filesChanged": ["app/Models/LoyaltyPoint.php"],
  "summary": "One or two sentences.",
  "handoffs": [ { "path": "app/Http/Resources/PointResource.php", "reason": "Needed to expose balance.", "suggestedOwner": "tenonry-laravel" } ],
  "contractIssues": []
}
```

`status`: `done`, `needs_owner` (a needed file is unowned or owned by another agent), `contract_issue` (the contract or tests are wrong or contradictory), `blocked` (cannot proceed; reason in `summary`).

### 4.7 Code review (`reviews/<task>.code.json`)

```json
{
  "task": "T1",
  "reviewer": "tenonry-review-eloquent",
  "round": 1,
  "verdict": "fail",
  "findings": [
    { "severity": "major", "file": "app/Models/LoyaltyPoint.php", "line": 14, "rule": "C3", "problem": "Fillable allows user_id mass assignment.", "fix": "Remove user_id from $fillable; set it through the relationship." }
  ],
  "summary": "One paragraph."
}
```

Severity: `blocking`, `major`, `minor`. `rule` references a code rubric id from `docs/07-QUALITY-RUBRICS.md` (C1 to C12) or `S<n>` for a slop item from the specialist's list.

### 4.8 Design review (`reviews/<task>.design.json`)

```json
{
  "task": "T4",
  "reviewer": "tenonry-design-reviewer",
  "round": 1,
  "rendered": true,
  "viewports": [375, 768, 1440],
  "scores": { "ux": 8, "visual": 7, "content": 7, "accessibility": 8, "performance": 7, "responsive": 8, "innovation": 6 },
  "weighted": 7.25,
  "verdict": "fail",
  "findings": [
    { "severity": "major", "criterion": "visual", "file": "resources/js/Pages/Loyalty.vue", "problem": "Uniform rounded cards with identical shadows read as a template kit.", "fix": "Use the tier progression as the visual anchor per design-brief; drop card chrome." }
  ],
  "screenshots": [".tenonry/runs/<run>/reviews/T4-375.png"],
  "summary": "One paragraph."
}
```

### 4.9 Jev decision log (`.tenonry/logs/jev-decisions.jsonl`)

Decision line: `{"ts", "runId", "task": <id|null>, "kind": "intake|dispatch|owner|risk", "ok": bool, "fallbackReason", "answers", "decision", "latencyMs", "cost"}`.
Outcome line (appended by `verify`): `{"ts", "runId", "task", "kind": "outcome", "model", "attempt": n, "result": "pass|fail"}`.

## 5. `scripts/init.mjs`

CLI: `node init.mjs [--project <dir>] [--dry-run] [--if-changed]`. Default project: `process.cwd()`. Prints one JSON summary. `--dry-run` writes nothing and prints what it would do. `--if-changed` makes init a fast no-op when nothing relevant changed (section 5.5); the `run` skill calls init this way at the start of every run.

### 5.1 Steps

1. Resolve the project root (the given directory; do not walk up). Record `gitRepo: isGitRepo(root)`; a non-repo is a warning, not an error.
2. Require Node 18 or newer; otherwise print `{"ok": false, "error": "node_too_old"}` and exit 1.
3. Load `library/catalog.json` from the plugin root.
4. Detect packages and specialists (5.2).
5. Resolve verification commands per package (5.3) and the preview (5.4).
6. Build `ownership.json`: system rules, test rules, catalog rules (sections 3.2 to 3.4).
7. Write `config.json` (merge rule in 4.1).
8. Copy `scripts/tenonry.mjs`, `scripts/exec-filter.mjs`, `scripts/hook-ownership-guard.mjs`, and `scripts/lib/` into `.tenonry/bin/` (same relative layout, so imports keep working). Write `.tenonry/bin/VERSION` with the plugin version.
9. Copy `library/rubrics/design.md` and `code.md` to `.tenonry/rubrics/`.
10. Render agents (section 9) into `.claude/agents/`. Delete stale `tenonry-*.md` files in `.claude/agents/` that contain the generated marker line and are not in the new set. Never touch files without the marker.
11. Ensure `.gitignore` contains each of: `.env`, `.tenonry/bin/`, `.tenonry/state.json`, `.tenonry/logs/`, `.tenonry/runs/`. Append missing lines under a `# tenonry` header. Create `.gitignore` if absent.
12. Report whether `.env` contains a non-empty `OPENROUTER_API_KEY` as a boolean only.
13. Print `{"ok": true, "gitRepo", "packages", "active", "agentsWritten", "agentsRemoved", "agentsDirCreated", "verify", "preview", "jevKey", "warnings", "skipped": false, "manifestHash"}`. `agentsDirCreated` is true when `.claude/agents/` did not exist before this run (Claude Code needs a restart to watch a new agents directory).

### 5.2 Detection

**Package roots.** Always `.`. Add workspace roots from `package.json` `workspaces` (array, or object with `packages`) and from `pnpm-workspace.yaml` (lines under `packages:` matching `^\s*-\s*['"]?([^'"#]+?)['"]?\s*$`). Expand patterns: a trailing `/*` lists immediate subdirectories; `/**` lists subdirectories to depth 2; other patterns are taken literally if the directory exists. Also add any depth-1 directory containing one of: `package.json`, `composer.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `mix.exs`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `pubspec.yaml`, `*.csproj`. Deduplicate.

**File scan.** For each package root, walk its tree to depth 6, skipping `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.nuxt`, `.output`, `.svelte-kit`, `out`, `coverage`, `target`, `.venv`, `venv`, `__pycache__`, `.tenonry`, `.claude`, and any other package root's subtree. Stop after 20,000 files and add a warning.

**Signals** (catalog `detect`; a specialist activates when any signal matches):

- `files`: globs relative to the package root; any scanned file matches.
- `npm`: any name present in `package.json` `dependencies`, `devDependencies`, or `peerDependencies`.
- `composer`: any key present in `composer.json` `require` or `require-dev`.
- `text`: object of `{ "<glob>": ["substring", ...] }`; a scanned file at depth 2 or less matching the glob contains any substring (case-sensitive).

**Supersession.** Within a package, after all signals are evaluated, remove every specialist listed in the `supersedes` array of another active specialist in the same package. Apply once, in catalog order.

**Package manager.** `pnpm-lock.yaml` gives `pnpm`; `yarn.lock` gives `yarn`; `bun.lockb` or `bun.lock` gives `bun`; `package-lock.json` or a bare `package.json` gives `npm`; no `package.json` gives `null`.

### 5.3 Verification commands per package

Let `run(s)` be `npm run s`, `pnpm s`, `yarn s`, or `bun run s` (npm uses `npm test` for `test`). Let `x` be `npx`, `pnpm exec`, `yarn`, or `bunx`. `{files}` becomes the task's test paths relative to the package root, each single-quoted for POSIX sh, space-separated. `{packages}` becomes the unique directories of those paths as `./<dir>`.

| Ecosystem (first match wins per field) | test | testFiles | typecheck | lint |
|---|---|---|---|---|
| JS with `vitest` dependency | `run(test)` if script, else `x vitest run` | `x vitest run {files}` | `run(typecheck)` if script, else `x tsc --noEmit` if `tsconfig.json` and `typescript` dependency | `run(lint)` if script |
| JS with `jest` dependency | `run(test)` if script, else `x jest` | `x jest {files}` | as above | as above |
| JS other | `run(test)` if script | null | as above | as above |
| PHP with `artisan` file | `php artisan test` | `php artisan test {files}` | `./vendor/bin/phpstan analyse --no-progress` if `phpstan/phpstan` or `larastan/larastan` | `./vendor/bin/pint --test` if `laravel/pint` |
| PHP with `pestphp/pest` | `./vendor/bin/pest` | `./vendor/bin/pest {files}` | as above | as above |
| PHP with `phpunit/phpunit` | `./vendor/bin/phpunit` | `./vendor/bin/phpunit {files}` | as above | as above |
| Python with pytest (`pytest.ini`, `conftest.py`, or `pytest` text in `pyproject.toml`/`requirements*.txt`) | `pytest -q` | `pytest -q {files}` | `mypy .` if `[tool.mypy]` or `mypy.ini` | `ruff check .` if `[tool.ruff]` or `ruff.toml` |
| Go (`go.mod`) | `go test ./...` | `go test {packages}` | `go vet ./...` | null |
| Rust (`Cargo.toml`) | `cargo test` | null | `cargo check` | null |
| Ruby with `rspec` in Gemfile | `bundle exec rspec` | `bundle exec rspec {files}` | null | `bundle exec rubocop` if `rubocop` in Gemfile |
| Ruby with `rails` in Gemfile | `bin/rails test` | `bin/rails test {files}` | null | as above |
| Elixir (`mix.exs`) | `mix test` | `mix test {files}` | null | `mix format --check-formatted` |
| .NET (`*.csproj`) | `dotnet test` | null | `dotnet build` | null |
| Maven (`pom.xml`) | `mvn -q test` | null | null | null |
| Gradle (`build.gradle*`) | `./gradlew test` if `gradlew` exists, else `gradle test` | null | null | null |
| Flutter (`flutter` in `pubspec.yaml`) | `flutter test` | `flutter test {files}` | `flutter analyze` | null |
| Dart (`pubspec.yaml` without flutter) | `dart test` | `dart test {files}` | `dart analyze` | null |

A package matching several ecosystems gets one entry per ecosystem, in table order.

### 5.4 Preview

First match wins, scanning packages in order:

| Condition | command | url |
|---|---|---|
| `composer.json` `scripts.dev` and `artisan` exists | `composer run dev` | `http://127.0.0.1:8000` |
| `artisan` exists | `php artisan serve` | `http://127.0.0.1:8000` |
| `package.json` `scripts.dev` with `next` dependency | `run(dev)` | `http://localhost:3000` |
| same with `nuxt` | `run(dev)` | `http://localhost:3000` |
| same with `astro` | `run(dev)` | `http://localhost:4321` |
| same with `vite` or `@sveltejs/kit` or `@remix-run/dev` or `@react-router/dev` | `run(dev)` | `http://localhost:5173` |
| `@angular/core` dependency and `scripts.start` | `run(start)` | `http://localhost:4200` |
| `manage.py` exists | `python manage.py runserver` | `http://127.0.0.1:8000` |
| `rails` in Gemfile | `bin/rails server` | `http://localhost:3000` |
| none | null | null |

If the dev script text contains `--port <n>` or `-p <n>`, use that port. `cwd` is the package root.

### 5.5 Change detection (`--if-changed`)

`manifestHash` = sha256 over: the plugin version, then for each file below that exists (sorted by path), its relative path and contents: every `package.json`, `composer.json`, `pyproject.toml`, `requirements*.txt`, `Pipfile`, `go.mod`, `Cargo.toml`, `Gemfile`, `mix.exs`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `*.csproj`, `pubspec.yaml`, `deno.json`, `deno.jsonc`, `dbt_project.yml`, `pnpm-workspace.yaml`, `artisan`, and `manage.py` at depth 2 or less, skipping the directories excluded by the file scan. Store it in `config.json`.

With `--if-changed`: when `config.json` exists, its `manifestHash` equals the freshly computed hash, and `.tenonry/bin/VERSION` equals the plugin version, print `{"ok": true, "skipped": true, "agentsDirCreated": false, "jevKey": <bool>}` and change nothing else. Otherwise run the full init.

## 6. `scripts/tenonry.mjs`

Single CLI used by the `run` skill. Run from the project as `node .tenonry/bin/tenonry.mjs <command> ...`. Each command prints one JSON object. Exit 0 whenever a JSON result was printed, including negative results; exit 1 only for usage or internal errors (print `{"ok": false, "error": "..."}` first).

| Command | Behavior |
|---|---|
| `new-run --prompt <text>` or `new-run --prompt-file <path>` | `state.newRun`. Returns `{ runId, runDir }`. Writes `route.json` with `jev: "fallback"`, `fallbackReason: "no_hook"`, `clarify: "auto"`, and `mainModel: { current: "unknown", notice: false }` |
| `intake <run>` | Runs `runIntake` for the run's prompt (same Jev questions and mapping as the hook) and rewrites `route.json`. Used when the hook did not route the prompt (first run before setup, or hook failure) |
| `status [<run>]` | Returns the run (default: active run) with task statuses, plus `display`: a ready-to-print plain-text summary (section 6.11) |
| `undo [<run>]` | Section 6.12 |
| `notice-shown <name>` | Sets `state.notices.<name>` to true |
| `restart-pending <true|false>` | Sets `state.restartPending` |
| `recover <run>` | Sets tasks in `running`, `verifying`, or `reviewing` back to `pending` (keeping tier, attempts, and baseline is retaken by `next`), because their agents ended with the previous session. Returns `{ recovered: [ids] }` |
| `phase <run> <phase>` | Sets `run.phase` |
| `contract-check <run>` | Section 4.5. On first valid result, adds tasks to `run.json` with status `pending`. Increments `contractFixes` on each invalid result |
| `next <run>` | Section 6.1 |
| `verify <run> <task>` | Section 6.2 |
| `ownership-check <run> <task>` | Section 6.3 |
| `revert-violations <run> <task>` | Restores each violation path with `git.restore`; returns `{ restored: [...], failed: [...] }` |
| `review-plan <run> <task>` | Section 6.4 |
| `review-status <run> <task>` | Section 6.5 |
| `checkpoint <run> <task>` | Recomputes `changedFiles` exactly as `verify` step 1 does, then commits them with message `tenonry(<task>): <title>`. Sets status `done` unless already `done_with_findings`. Not a git repo or nothing changed: `{ skipped: <reason> }` and the status still updates. Commit failure (for example a pre-commit hook rejecting it): `{ skipped: "commit_failed", error }`, note added to the task, status still updates. Otherwise returns `{ sha }` |
| `owner <path> --run <run> [--purpose <text>]` | Section 6.6 |
| `handoff <run> <task>` | Reads the task report. For each handoff path, resolves the owner with the `owner` logic. Groups paths by owner; for each owner that is not the task's own owner, appends a follow-up task to `contract.json` and `run.json`: id `T<next number>`, that owner, those files, summary `Needed by <task>: <reasons>`, acceptance `["Provides what <task> needs: <reasons>"]`, empty tests, `ui` true when the owner's layer is frontend or 3d. Adds the new ids to the original task's `dependsOn` and sets it back to `pending` (tier unchanged). Paths with no resolvable owner get a task note and are skipped. Returns `{ created: [ids], unresolved: [paths] }`. This command is the only writer of `contract.json` besides the test author |
| `task-files <run> <task>` | Returns `{ files: changedFiles }` |
| `reset-task <run> <task>` | Sets status `pending`, keeps the tier, clears `failuresOnTier`. Returns the task |
| `block-task <run> <task> --reason <text>` | Sets status `blocked` and records the reason as a note. Returns the task |
| `final-gate <run>` | Section 6.7 |
| `report <run>` | Writes `report.md` (section 6.8); sets phase `done` unless it is `stopped`; returns `{ path, summary: { done, total, tasks: [{ id, title, status }], attention: [strings], tryIt: <preview command and URL, else the first verify test command, else null>, jevCost } }` |
| `calibrate` | Section 6.9 |
| `catalog-check` | Plugin-only. Validates `library/catalog.json`: unique ids matching `^[a-z0-9-]+$`; layer counts frontend 24, 3d 1, backend 23, data 22; required fields; every glob compiles; `supersedes` ids exist; `modelFloor` in haiku, sonnet, opus; 3 to 5 idioms and 2 to 4 slop items each |

### 6.1 `next`

1. Load run, contract, config. Mark `pending` tasks with a `blocked` dependency as `blocked` (note `dependency <id> blocked`).
2. Ready tasks: `pending` with every dependency `done` or `done_with_findings`. Exclude tasks whose owner already has a `running`, `verifying`, or `reviewing` task. Take at most `maxParallel` minus active tasks, in contract order.
3. For each ready task choose the model:
   - If `task.tier` is set (escalation), use it.
   - Otherwise ask Jev the dispatch questions (`docs/04-JEV-ROUTING.md`) and map the answers.
   - Apply the owner's `modelFloor`.
4. Set `status: running`, `tier: <model>`, push an attempt `{ model, startedAt }`, set `baseline: git.snapshot(root)` (taken once per call, shared by the tasks started together).
5. Return `{ ready: [{ task, agent, model, reason, delegation }], running: [...ids], remaining: <count of not-finished tasks> }`. `delegation` is the exact message in section 6.10.
6. When no task is ready and none is active: return `{ ready: [], running: [], remaining: <n> }`. If `remaining > 0`, all remaining tasks are blocked.

### 6.2 `verify`

1. Set status `verifying`. `changedFiles` = paths from `git.diffSince(baseline)` whose owner allows the task owner.
2. Pick the verify entry whose `root` is the longest prefix of the task's first file.
3. Steps, in order, each through `exec-filter` (in-process function): tests (`testFiles` with the task's tests when both exist, otherwise skipped with reason `no_test_template` or `no_tests`), `typecheck` (if not null), `lint` (if not null). Run each step with `cwd` set to the package root.
4. `result`: `pass` when every executed step passes. The test step passes only on exit 0. Typecheck and lint run project-wide while other tasks' tests may still reference unbuilt code, so they are scoped: a typecheck or lint step passes on exit 0, and also on a non-zero exit when its full output mentions none of the task's `changedFiles` or `tests` paths (match the relative path, or the path relative to the package root). The final gate applies no such scoping.
5. Append an outcome line to the Jev log (`model` = current tier, `attempt` = attempts length).
6. On fail: increment `failuresOnTier`. If it reaches `maxTestRetriesPerTier`: if the tier is opus, set status `blocked` and `action: "blocked"`; else set `tier` to the next tier, reset `failuresOnTier`, set status `pending`, `action: "respawn"`. Otherwise `action: "resume"`.
7. On pass: `action: "review"`.
8. Return `{ result, action, steps: [{ name, command, exitCode, summary, log }], feedback, delegation }`. `feedback` joins each failed step's filtered output (at most `outputFilter.maxLines` lines in total). `delegation` is the fix-mode message (section 6.10) for `resume`, `null` otherwise.

### 6.3 `ownership-check`

Using `git.diffSince(baseline)`: each changed path is attributed to this task if its owner allows the task owner; ignored if its owner allows the owner of another task that is currently `running`, `verifying`, or `reviewing`; otherwise it is a violation. Paths under `.tenonry/runs/` are ignored. Returns `{ ok, files, violations: [{ path, owner }] }`.

### 6.4 `review-plan`

1. Set status `reviewing`.
2. Ask Jev the risk questions with state `{ task (title, summary, acceptance), files: changedFiles, diffStat (git diff --stat for those files), diffExcerpt (first 8,000 characters of git diff for those files, including untracked files shown with git diff --no-index /dev/null <file>) }`.
3. Reviewers:
   - Code: always `tenonry-review-<owner id>`. Model `opus` when `risky >= codeReviewOpus.minRisky` or `blastRadius >= codeReviewOpus.minBlastRadius`, else `sonnet`. Jev unavailable: `opus`.
   - Design: when `task.ui` is true and `tenonry-design-reviewer` is in `config.agents`. Model always `opus`.
4. Increment the matching `reviewRounds` counters.
5. Return `{ reviewers: [{ agent, kind, model, delegation }] }`.

### 6.5 `review-status`

1. For each reviewer kind planned this round, read `reviews/<task>.<kind>.json`. Missing or schema-invalid: status `error`.
2. Code pass: no finding with severity `blocking` or `major`.
3. Design: recompute `weighted` from `scores` with weights ux 0.15, visual 0.15, content 0.10, accessibility 0.10, performance 0.20, responsive 0.10, innovation 0.20 (rounded to 2 decimals; ignore the reviewer's own figure). Pass when `weighted >= 7.5`, every score `>= 6`, and no `blocking` finding. When `rendered` is false and those conditions hold, status `pass_unrendered` (counts as pass, flagged in the report).
4. `overall`: `pass` when every planned kind passes. An `error` counts as fail for that round.
5. On fail: if any failing kind has reached its round limit (`maxDesignRounds`, `maxCodeReviewRounds`), set status `done_with_findings` and `action: "checkpoint"`; otherwise `action: "fix"`.
6. On pass: `action: "checkpoint"`.
7. Return `{ design, code, overall, action, feedback, delegation }`. `feedback` lists findings as `- [severity] file:line problem -> fix`. `delegation` is the fix-mode message for `fix`, else `null`.

### 6.6 `owner`

1. Resolve with ownership rules plus run rules. If an owner exists, return `{ owner, source: "rules" }`.
2. Otherwise ask Jev the owner question with candidates = active builder specialists (`tenonry-<id>`, title, and their `owns` globs). If `ok` and confidence `>= newFileOwnerMinConfidence`, add a run rule (`source: "jev:<run>"`) and return `{ owner, source: "jev", confidence }`.
3. Otherwise heuristic: the first active specialist (catalog order) having an `owns` glob that ends with the path's extension (for example `.vue`). Add a run rule (`source: "heuristic:<run>"`) and return `{ owner, source: "heuristic" }`.
4. Otherwise `{ owner: null, source: "none" }`.

### 6.7 `final-gate`

1. For each verify entry, run `test`, `typecheck`, and `lint` (each when not null) through `exec-filter`, strictly: any non-zero exit fails the gate.
2. All pass: `finalGate: { result: "pass" }`, return `{ result: "pass" }`.
3. Fail and `finalGateReopened` is false and some entry has `testFiles`: for each `done` or `done_with_findings` task with tests, run its tests; tasks whose tests fail go back to `pending` with a note and their current tier. Set `finalGateReopened: true`. Return `{ result: "fail", reopened: [...] }` (orchestrator returns to the dispatch loop).
4. Otherwise record the failure and return `{ result: "fail", reopened: [] }`.

### 6.8 `report`

`report.md` sections, in order: title and run id; request; outcome counts by status; table of tasks (id, owner, final model, attempts, review results, commit); unresolved review findings; blocked tasks with reasons; final gate result; Jev usage (decision count, fallbacks, total cost from the log); skipped steps; paths to logs.

### 6.9 `calibrate`

Read the Jev log. Join dispatch decisions with first-attempt outcomes per task. Group by chosen model and difficulty bucket (`[0, 0.5)`, `[0.5, 1.5)`, `[1.5, 2.5)`, `[2.5, 3]`). Return counts and first-attempt pass rates plus suggestions: haiku pass rate below 0.70 suggests lowering `haiku.maxDifficulty` by 0.2; sonnet pass rate above 0.90 in buckets at or above 1.5 suggests raising `opus.minDifficulty` by 0.25; opus pass rate below 0.60 suggests reviewing contracts for over-scoped tasks. Suggestions only; never edits config. Fewer than 20 dispatch decisions: return `{ enoughData: false }`.

### 6.10 Delegation messages

Build mode (from `next`):

```
TENONRY_TASK
run: <runId>
task: <taskId>
mode: build
contract: .tenonry/runs/<runId>/contract.json
plan: .tenonry/runs/<runId>/plan.md
design_direction: .tenonry/design-direction.md
design_brief: .tenonry/runs/<runId>/design-brief.md
report_to: .tenonry/runs/<runId>/reports/<taskId>.json
```

Omit `design_direction` and `design_brief` lines when the task is not `ui`.

Fix mode (from `verify` and `review-status`): same header with `mode: fix`, followed by:

```
feedback:
<feedback text, each line indented two spaces>
```

Review (from `review-plan`):

```
TENONRY_REVIEW
run: <runId>
task: <taskId>
kind: <design|code>
round: <n>
contract: .tenonry/runs/<runId>/contract.json
files:
  - <path>
design_direction: .tenonry/design-direction.md
design_brief: .tenonry/runs/<runId>/design-brief.md
preview_command: <config.preview.command or none>
preview_url: <config.preview.url or none>
preview_cwd: <config.preview.cwd or none>
write_to: .tenonry/runs/<runId>/reviews/<taskId>.<kind>.json
```

Code reviews omit the `design_*` and `preview_*` lines.

### 6.11 Status display

`status` returns `display`, plain text the `run` skill prints as is:

```
Tenonry run <runId>: <phase in words>
Request: <first 100 characters of the request>
Tasks: <n> done, <n> in progress, <n> waiting, <n> blocked
  T1  done          tenonry-eloquent   haiku   Points table and model
  T2  in progress   tenonry-laravel    sonnet  Points API
  T3  waiting       tenonry-vue        -       Loyalty page
Next: <one line: what happens next, or "Type /tenonry:run to continue." when the run is unfinished and nothing is running>
```

Phase words: intake `Clarifying the request`, planning `Planning`, design `Designing`, contract `Writing the contract and tests`, building `Building`, final-gate `Running the final checks`, done `Finished`, stopped `Stopped`. Task status words: `done`, `done, with notes` (done_with_findings), `in progress` (running, verifying, reviewing), `waiting` (pending), `blocked`. With no runs at all, `display` is `No Tenonry runs yet. Start one with /tenonry:run <what you want>.`

### 6.12 `undo`

1. Pick the run: the given id, else the most recent run (by id) with at least one task `commit`.
2. Refuse when the working tree has uncommitted changes outside `.tenonry/`: return `{ ok: false, reason: "uncommitted_changes", files }`.
3. If that run is not `done` or `stopped`, set its phase to `stopped` first.
4. Revert the run's task commits newest first with `git revert --no-edit <sha>`, one commit at a time. Never use reset, rebase, or force.
5. On a conflict: `git revert --abort`, stop, and return `{ ok: false, reason: "conflict", reverted: [shas], stoppedAt: sha }`.
6. On success set `run.undone = true` and return `{ ok: true, reverted: [shas] }`. A run with no commits returns `{ ok: true, reverted: [] }`.

## 7. `scripts/exec-filter.mjs`

CLI: `node exec-filter.mjs --label <label> --cwd <dir> --b64 <base64 command>`. Also exports `runFiltered({ command, cwd, label, root, maxLines })` used by `tenonry.mjs`.

1. Decode the command. Spawn `/bin/sh -c <command>` with `cwd`, inheriting the environment, stdout and stderr merged.
2. Stream all output to `<project>/.tenonry/logs/exec/<UTC timestamp>-<label>.log` (project root found from `cwd`; if none, use the OS temp directory).
3. Keep the last 2,000 lines in memory plus every line matching `/\b(FAIL|FAILED|Failed|ERROR|Error|error|Traceback|AssertionError|Exception|panic:|--- FAIL|failures?:|Failures:)\b|[✗✕×]/` together with the 2 lines after it.
4. Print to stdout: header `[tenonry] <label> exit=<code> log=<path relative to project root>`. Exit 0: the last 5 lines. Non-zero: deduplicated matched lines (in order, capped at `maxLines` minus 15) followed by the last 15 lines.
5. Exit with the child's exit code; a signal exit becomes 1.

## 8. Hook scripts

All hooks read one JSON object from stdin. All exit 0 with no output when stdin is invalid or `findProjectRoot(input.cwd or $CLAUDE_PROJECT_DIR)` returns null, unless stated otherwise.

### 8.1 `hook-session-start.mjs`

Print `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "TENONRY_PLUGIN_ROOT=<absolute plugin root>"}}`. Runs in every project (no project root needed).

### 8.2 `hook-prompt-router.mjs`

This hook never blocks a prompt.

1. Continue only when `input.prompt` matches `/^\s*\/tenonry:run\b/`. Otherwise exit 0 silently.
2. Find the project root; none: exit 0 silently (the `run` skill initializes the project and runs intake through `tenonry.mjs intake`).
3. `request` = prompt without the prefix, trimmed. Exit 0 silently when it is empty or, case-insensitively, exactly `resume`, `continue`, `undo`, `help`, or `status`.
4. Read the main session's model family with `currentModelFamily(input)` (`scripts/lib/routing.mjs`): from `input.model` (string, or an object's `id` or `display_name`); else the last 256 KB of `input.transcript_path`, scanning JSONL lines from the end for the first `message.model` string; else `unknown`. Family = first of `opus`, `sonnet`, `haiku`, `fable` contained in the lowercased name, else `unknown`.
5. Create the run (`state.newRun`) and run the shared intake routine `runIntake(root, runId, request, family)` (also used by `tenonry.mjs intake`): ask Jev the intake questions (`docs/04-JEV-ROUTING.md` section 3), map them, and write `route.json`.
6. Print `{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "TENONRY_ROUTE run=<id> clarify=<yes|no|auto> route=.tenonry/runs/<id>/route.json"}}`.
7. Any internal error: exit 0 silently (the skill falls back to `new-run` plus `intake`).

### 8.3 `hook-output-filter.mjs`

1. `command = input.tool_input.command`. Skip (exit 0, no output) when: no project root; the command contains `exec-filter.mjs`; it matches `/[;&|<>`\n]|\$\(/`; it is longer than 500 characters; or it matches none of the patterns below.
2. Patterns (anchored at the start, after trimming):
   - `^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|type-check|check|build)(\s|$)`
   - `^(npx|pnpm\s+exec|yarn|bunx)\s+(vitest|jest|tsc|eslint|playwright\s+test)(\s|$)`
   - `^(php\s+artisan\s+test|\./vendor/bin/(phpunit|pest|phpstan|pint))(\s|$)`
   - `^(pytest|python3?\s+-m\s+pytest|mypy|ruff\s+check)(\s|$)`
   - `^go\s+(test|vet|build)(\s|$)`
   - `^cargo\s+(test|check|build|clippy)(\s|$)`
   - `^(bundle\s+exec\s+(rspec|rubocop)|bin/rails\s+test)(\s|$)`
   - `^mix\s+(test|compile)(\s|$)`
   - `^dotnet\s+(test|build)(\s|$)`
   - `^(mvn|\./gradlew|gradle)\s+`
   - `^(flutter\s+(test|analyze)|dart\s+(test|analyze))(\s|$)`
   - each regex string in `config.outputFilter.extraCommands`
3. Rewrite: `node "<root>/.tenonry/bin/exec-filter.mjs" --label <label> --cwd "<input.cwd>" --b64 <base64 of the original command>`. `<label>` = the first two whitespace-separated tokens joined by `-`, lowercased, non-alphanumerics replaced by `-`.
4. Print `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "tenonry: verification command routed through output filter", "updatedInput": <input.tool_input with command replaced>}}`.

### 8.4 `hook-read-guard.mjs`

1. `path = input.tool_input.file_path`; relative to the project root (outside the root: allow).
2. Allowed if it matches any glob in `config.readGuard.allow`.
3. Denied categories, checked in order:
   - lockfile: basename in the lockfile list of section 3.3. Advice: `Read the manifest (package.json, composer.json, ...) or run the package manager's list command instead.`
   - build output: a path segment in `dist`, `build`, `.next`, `.nuxt`, `.output`, `.svelte-kit`, `out`, `coverage`, `target`. Advice: `This is generated output. Read the source file instead.`
   - minified: ends with `.min.js` or `.min.css`. Advice: `Read the unminified source instead.`
   - source map: ends with `.map`. Advice: `Source maps are generated. Read the source instead.`
   - extra: matches a glob in `config.readGuard.extraDeny`. Advice: `Blocked by project read guard settings.`
4. Deny output: `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "tenonry read guard: <path> is <category>. <advice>"}}`.

### 8.5 `hook-ownership-guard.mjs` (runs from `.tenonry/bin/`, wired in agent frontmatter)

CLI: `node hook-ownership-guard.mjs <agent-name>`.

1. `path = input.tool_input.file_path ?? input.tool_input.notebook_path`. Missing: exit 0.
2. Relative to the project root. Outside the root: block (`outside the project`).
3. Owner from `loadRules(root, state.activeRun)` and `resolveOwner`.
4. Allowed (`ownerAllows`): exit 0.
5. Blocked: write the message to stderr and exit 2:
   - other owner: `tenonry ownership guard: <path> is owned by <owner>. Do not edit it. Add a handoff for it to your report (reason and suggestedOwner) and continue with your own files.`
   - `none`: `tenonry ownership guard: <path> is protected and must not be edited by agents.`
   - unowned: `tenonry ownership guard: <path> has no owner. Add a handoff with status needs_owner to your report and continue with your own files.`
6. Internal error: write `tenonry ownership guard: internal error, allowing` to stderr and exit 0.

## 9. Agent rendering

Texts are in `docs/06-AGENT-AND-SKILL-TEXTS.md`. Placeholders use `{{name}}`.

| Output file | Source | Rendered when |
|---|---|---|
| `tenonry-planner.md` | `library/core/planner.md` | always |
| `tenonry-art-director.md` | `library/core/art-director.md` | always |
| `tenonry-test-author.md` | `library/core/test-author.md` | always |
| `tenonry-design-reviewer.md` | `library/core/design-reviewer.md` | any active specialist has layer `frontend` or `3d` |
| `tenonry-<id>.md` | `library/templates/specialist.md` | per active specialist |
| `tenonry-review-<id>.md` | `library/templates/code-reviewer.md` | per active specialist |

Variables available to every file: `{{guard}}` = `node "$CLAUDE_PROJECT_DIR/.tenonry/bin/hook-ownership-guard.mjs" <agent-name>` (agent-name is the file's own `name`).

Specialist and reviewer variables:

| Variable | Value |
|---|---|
| `{{id}}` | catalog id |
| `{{title}}` | catalog title |
| `{{layer}}` | catalog layer |
| `{{owns}}` | `bullets` of the final rendered globs for this specialist across packages |
| `{{idioms}}` | `bullets` of catalog idioms |
| `{{slop}}` | catalog slop as a numbered list: `S1. ...`, `S2. ...` |
| `{{modelFloor}}` | catalog modelFloor |
| `{{uiRules}}` | for layers `frontend` and `3d`: the UI block in `docs/06` section 5.2; otherwise an empty string |
| `{{verify}}` | the task-scoped verification lines described below the table |

For each `config.verify` entry whose `root` is the root of a package where this specialist is active, in config order, `{{verify}}` emits:

- `- task tests: <testFiles>` when `testFiles` is not null. When the entry's `root` is not `.`, append ` (run from <root>; test paths relative to <root>)`.
- `- task tests: no task-scoped test command is configured; do not run tests, Tenonry runs them after you finish.` when `testFiles` is null.
- `- typecheck: <typecheck>` when not null.
- `- lint: <lint>` when not null.

The project-wide `test` command is never rendered for specialists. When the specialist has no matching verify entry, `{{verify}}` renders `- No verification commands are configured for your files.` The literal `{files}` stays in the rendered text.

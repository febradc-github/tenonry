# Tenonry

![The Tenonry workshop: an architect, an art director, and a gauge maker plan the piece, craftspeople build it at their own benches, inspection checks it, and dispatch routes the work](assets/workshop.png)

Tenonry is a Claude Code plugin that turns one request into planned, tested, reviewed, and committed work. It splits the job between narrow specialist agents that each own their own files, and it uses Jev, a cheap decision model on OpenRouter, to pick which Claude model does each piece. Every agent works lean: it starts from a short map of what your code already has, writes the least code that fully does the job, and replies in one line.

## Quick start

1. Install the plugin: `claude plugin marketplace add <path to this repository>`, then `claude plugin install tenonry@tenonry-local`.
2. Open a git project in Claude Code.
3. Type `/tenonry:run <what you want>`.

## Commands

| Command | What happens |
|---|---|
| `/tenonry:run <what you want>` | Does everything: sets up the project on first use, asks a few questions only if the request is unclear, then plans, designs, tests, builds, reviews, and commits |
| `/tenonry:run` | Shows the current run's progress, or resumes an unfinished run |
| `/tenonry:run resume` or `continue` | Resumes the unfinished run |
| `/tenonry:run undo` | Reverts every commit the last run made, as new revert commits (history is never rewritten) |
| `/tenonry:run help` | Shows these commands and examples |
| `/tenonry:init` | Optional. Re-scans the stack by hand; normally never needed because every run refreshes it automatically when manifests change |

Examples:

```
/tenonry:run add a loyalty points page for customers
/tenonry:run fix the login error when the email has uppercase letters
```

## What to expect on the first run

- Setup is automatic. Tenonry scans your project, picks the specialists that match your stack, and writes their agents into `.claude/agents/`.
- An empty folder works too: Tenonry picks a starter stack for the request and prints `New project: starting a <starter>.` See "Starting from an empty folder" below.
- If `.claude/agents/` did not exist yet, Claude Code needs one restart to see the new agents. Tenonry saves your request first. After the restart, type `/tenonry:run` and it continues where it stopped.
- Claude Code asks you to trust the workspace. Tenonry's file guards are agent hooks, and Claude Code runs project agent hooks only after you accept that prompt.
- If the request is unclear, you get a few multiple-choice questions, at most two rounds. After that Tenonry works without interrupting you.
- A small, clear request skips the plan: you see `Small request: skipping the plan.` instead of `Planning...`.
- A question gets an answer instead of a build: you see `This is a question, so no code will change. Answering directly.` If you wanted a change, say what to change and run it again.
- Progress appears as one short line per event. The run ends with what changed, how to try it, what needs attention, and how to undo it.

## Optional: smarter model routing

Add your OpenRouter key to the project's `.env` file:

```
OPENROUTER_API_KEY=sk-or-...
```

Tenonry reads the key from that file only, never from your shell environment, and never prints or logs it. With a key, Jev also decides how much of the pipeline a request needs:

- A question is answered directly, with no code changed.
- A small, clear request skips the planning step, and its contract and tests are written on Sonnet instead of Opus.
- A change that needs nothing newly designed skips the art director and keeps the look your interface already has.
- A UI task that does not change layout or styling skips the visual design review.
- A trivial, contained, low-risk task is code-reviewed on Haiku. Every task is still reviewed.
- A small mechanical change outside the interface, such as a rename or a config value, becomes one task with no new tests. Your existing tests, the code review, and the final checks still run.

Each shortcut prints its own progress line, so you always see which path a request took. Without a key everything still works and nothing is skipped: every request is planned and goes through the full pipeline, tasks run on Sonnet (never below a specialist's own minimum), and code reviews run on Opus. You see a one-time tip about it. Set `TENONRY_JEV_DISABLE=1` to turn Jev off even when a key exists.

## Signed-in screens

The design reviewer opens your pages in a browser. For screens behind a login, add a local test account to the project's `.env`:

```
TENONRY_PREVIEW_USER=test@example.com
TENONRY_PREVIEW_PASSWORD=...
TENONRY_PREVIEW_LOGIN_URL=/login
```

`TENONRY_PREVIEW_LOGIN_URL` is optional; it can be a path or a full URL and defaults to `/login` on the preview address. Use a local test account only, never a real one. Tenonry reads these values from `.env` only, hands them to the design reviewer when it needs to sign in, and never logs them. Without them, a screen that needs a login is reported as not visually checked instead of being judged by its login page.

Tenonry starts your dev server for the review when it is not already running, logs it to `.tenonry/logs/preview.log`, and stops only the one it started.

## Starting from an empty folder

Tenonry can start a project from nothing. Run `git init` in an empty folder, open it in Claude Code, and type `/tenonry:run <what you want>`. When setup finds no code it recognizes, Tenonry picks the starter that fits the request and prints `New project: starting a <starter>.` The first task sets the project up (manifest, build configuration, entry files) and installs its dependencies, including the test runner. Everything else in the run builds on it.

| Starter | Used for |
|---|---|
| `react-vite` | Web apps, dashboards, and tools with a user interface. The default when the request names no framework |
| `vue-vite` | A user interface built with Vue |
| `sveltekit` | A user interface built with Svelte or SvelteKit |
| `nextjs` | A web app built with Next.js, or one that needs server-rendered pages and its own API routes |
| `node-api` | An HTTP API or backend service without a user interface of its own |

Name the framework in your request to choose one, for example `... as a Vue app`. Laravel, Rails, Django, Angular, Flutter, and other stacks whose skeleton comes from their own new-project command are not started from an empty folder: create the project with that command, commit it, and run `/tenonry:run` again. Once the project has real files, the next run detects its stack from them and the starter is no longer used.

## What gets created

Commit these:

- `.claude/agents/tenonry-*.md`: the generated agents
- `.tenonry/config.json`, `.tenonry/ownership.json`, `.tenonry/rubrics/`
- `.tenonry/design-direction.md`: the visual direction, created on the first UI run

Tenonry adds these to `.gitignore` for you: `.env`, `.tenonry/bin/`, `.tenonry/state.json`, `.tenonry/logs/`, `.tenonry/runs/`, `.claude/settings.local.json`. A project started from an empty folder also gets its stack's generated directories, such as `node_modules/` and `dist/`.

To keep approval prompts rare, setup also adds two allow rules to your local Claude Code settings, `.claude/settings.local.json`, and leaves everything else in that file as it is:

- `Bash(node .tenonry/bin/tenonry.mjs *)`: lets Tenonry run its own bookkeeping script (task state, checks, commits) without asking each time
- `mcp__playwright`: lets the design reviewer use its browser to look at your pages

Remove either rule if you would rather approve those actions yourself.

Each finished task becomes one local commit named `tenonry(<task>): <title>`. Tenonry never pushes, and it never bypasses your git hooks.

## Optional settings

`.tenonry/config.json` holds knobs you can edit; they survive refreshes:

- `routing.thresholds`: when Jev's answers send a task to Haiku, Sonnet, or Opus (`opus.minDifficulty`: a task at or above it is built on Opus; raise it to use Opus less), when to ask you questions, and when a request is planned (`planning`: raise `minNeedsPlan` to skip the plan more often, set it to 0 to plan every request). To switch a shortcut off: `quick.maxDifficulty: -1` (always write tests), `answer.minConfidence: 2` (never answer directly), `design.minNewDesign: 0` (always run the art director), `design.minVisualChange: 0` (always run the visual review), `codeReviewHaiku.maxDifficulty: -1` (never review on Haiku)
- `limits`: parallel tasks, retries per model, and review rounds
- `readGuard`: extra paths agents may not read, or paths to allow
- `outputFilter`: how many lines of test output reach the model, and extra commands to filter
- `codebaseMap`: the short list of what your code already defines, one line per folder, that the planner, test author, builders, and code reviewers receive when they start, so they reuse code instead of searching for it. `maxChars` sets its size (default 2000); `enabled: false` turns it off

After about 20 tasks, `node .tenonry/bin/tenonry.mjs calibrate` compares Jev's choices with how often the first attempt passed and suggests threshold changes. It never edits your config.

## Requirements

- Claude Code
- Node.js 18 or newer
- git, with your project inside a git repository
- Google Chrome, for the visual design review of UI work. Without it the work still completes, and the summary tells you the design was not visually checked. Install it with `npx @playwright/mcp@0.0.83 install-browser chrome`
- macOS, Linux, or WSL

## Remove Tenonry from a project

Delete `.claude/agents/tenonry-*.md` and the `.tenonry/` directory. Then uninstall the plugin with `claude plugin uninstall tenonry`.

## Changelog

### 0.6.0

Updating to 0.6.0 needs nothing from you. If a run in an empty folder stopped at the contract under 0.5.0, start it again with `/tenonry:run <what you want>`.

- An empty folder works. When setup finds no code it recognizes, Tenonry picks a starter stack that fits the request (`react-vite` unless you name another), creates its specialists, and the first task sets the project up and installs its dependencies. See "Starting from an empty folder".
- A lockfile that the package manager writes when a task adds a dependency is committed with that task, instead of being reverted as an ownership violation. Agents still may not edit a lockfile by hand.
- In a project started from a starter, the test commands and the preview are read from the files the first task wrote, so every task is verified and screens get their visual review in the same run.

### 0.5.0

Updating to 0.5.0 needs nothing from you: the next `/tenonry:run` in a project notices the new plugin version and re-renders that project's agents, rubrics, and scripts. These changes work with or without a Jev key. The ideas come from [ponytail](https://github.com/dietrichgebert/ponytail) (MIT).

- Builders follow a least-code ladder: skip what the task does not need, then reuse what your project has, then the standard library or framework, then an installed dependency, then one line, and only then new code. Validation, error handling, security, and accessibility are never cut.
- The planner, test author, builders, and code reviewers start with a codebase map: one line per source folder naming what it defines, about 2,000 characters, built in plain code. They reuse what exists instead of searching for it first. Turn it off with `codebaseMap.enabled: false`.
- The test author prefers changing existing files to creating new ones. Every acceptance criterion still gets its tests.
- Every agent finishes with a reply of one line. Tenonry reads their results from files, so longer replies only filled the main session's context.
- The code rubric's reuse rule, C8, now also covers the standard library and installed dependencies, and no dependency is added for what a few lines do.

### 0.4.0

Updating to 0.4.0 needs nothing from you: the next `/tenonry:run` in a project notices the new plugin version and re-renders that project's agents, rubrics, and scripts. All six changes need a Jev key; without one the full pipeline runs as before.

- On a request that skipped the plan, the contract and tests are written on Sonnet instead of Opus.
- A UI request that needs nothing newly designed skips the art director and keeps the existing look.
- A UI task that does not change layout or styling skips the visual design review.
- A trivial, contained, low-risk task that passed first time is code-reviewed on Haiku instead of Sonnet.
- A question is answered directly instead of starting the pipeline.
- A small mechanical change outside the interface is built as one task without the test author, so no new tests are written for it.

### 0.3.1

Updating to 0.3.1 needs nothing from you: the next `/tenonry:run` in a project notices the new plugin version and re-renders that project's agents, rubrics, and scripts.

- Opus builds only complex tasks. A simple task no longer lands on Opus because Jev was unsure or because the change touches shared code; easy work stays on Haiku or Sonnet. A task that keeps failing its tests on Sonnet is still retried on Opus.

### 0.3.0

Updating to 0.3.0 needs nothing from you: the next `/tenonry:run` in a project notices the new plugin version and re-renders that project's agents, rubrics, and scripts.

- Jev decides whether a request needs a plan. Small, clear requests skip the planner, which runs on Opus, and go straight to the contract, the tests, and the build. Without a Jev key every request is still planned.

### 0.2.0

Updating to 0.2.0 needs nothing from you: the next `/tenonry:run` in a project notices the new plugin version and re-renders that project's agents, rubrics, and scripts.

- Builders may run their framework's own generators and migration tools for files they own.
- Builders check their work with their own task's tests only, never the whole suite.
- Styling specialists own every stylesheet, wherever it lives; Angular owns its component templates.
- On an existing app, the art director documents the current look and keeps it instead of inventing a new one.
- Fewer approval prompts: skills declare their tools, requests travel through standard input, and setup adds two local allow rules.
- The design reviewer can sign in with a local test account, and Tenonry starts and stops the preview itself.
- A design review that could not render the page never passes on guesses; the summary says how to get a visual check. The review browser version is pinned.
- Django, FastAPI, and Flask projects no longer get an unused Python agent.
- Code reviewers of frontend work check the UI rules: tokens only, every state built, accessibility in code.
- Design scoring has two profiles: showcase pages are judged as award work, product screens as tools.
- An opt-in test makes one real call to Jev (`TENONRY_LIVE=1 node --test tests/jev-live.test.mjs`).

### 0.1.0

First version.

## Development

The build documents are in `docs/`. Run the tests with `node --test`; the plugin has no dependencies.

## License

MIT. See [LICENSE](LICENSE).

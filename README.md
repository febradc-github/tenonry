# Tenonry

Tenonry is a Claude Code plugin that turns one request into planned, tested, reviewed, and committed work. It splits the job between narrow specialist agents that each own their own files, and it uses Jev, a cheap decision model on OpenRouter, to pick which Claude model does each piece.

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
- If `.claude/agents/` did not exist yet, Claude Code needs one restart to see the new agents. Tenonry saves your request first. After the restart, type `/tenonry:run` and it continues where it stopped.
- Claude Code asks you to trust the workspace. Tenonry's file guards are agent hooks, and Claude Code runs project agent hooks only after you accept that prompt.
- If the request is unclear, you get a few multiple-choice questions, at most two rounds. After that Tenonry works without interrupting you.
- A small, clear request skips the plan: you see `Small request: skipping the plan.` instead of `Planning...`.
- Progress appears as one short line per event. The run ends with what changed, how to try it, what needs attention, and how to undo it.

## Optional: smarter model routing

Add your OpenRouter key to the project's `.env` file:

```
OPENROUTER_API_KEY=sk-or-...
```

Tenonry reads the key from that file only, never from your shell environment, and never prints or logs it. With a key, Jev also decides whether a request needs a plan at all: a small, clear request skips the planning step, which runs on Opus, and goes straight to the tests and the build. Without a key everything still works: every request is planned, tasks run on Sonnet (never below a specialist's own minimum), and code reviews run on Opus. You see a one-time tip about it. Set `TENONRY_JEV_DISABLE=1` to turn Jev off even when a key exists.

## Signed-in screens

The design reviewer opens your pages in a browser. For screens behind a login, add a local test account to the project's `.env`:

```
TENONRY_PREVIEW_USER=test@example.com
TENONRY_PREVIEW_PASSWORD=...
TENONRY_PREVIEW_LOGIN_URL=/login
```

`TENONRY_PREVIEW_LOGIN_URL` is optional; it can be a path or a full URL and defaults to `/login` on the preview address. Use a local test account only, never a real one. Tenonry reads these values from `.env` only, hands them to the design reviewer when it needs to sign in, and never logs them. Without them, a screen that needs a login is reported as not visually checked instead of being judged by its login page.

Tenonry starts your dev server for the review when it is not already running, logs it to `.tenonry/logs/preview.log`, and stops only the one it started.

## What gets created

Commit these:

- `.claude/agents/tenonry-*.md`: the generated agents
- `.tenonry/config.json`, `.tenonry/ownership.json`, `.tenonry/rubrics/`
- `.tenonry/design-direction.md`: the visual direction, created on the first UI run

Tenonry adds these to `.gitignore` for you: `.env`, `.tenonry/bin/`, `.tenonry/state.json`, `.tenonry/logs/`, `.tenonry/runs/`, `.claude/settings.local.json`.

To keep approval prompts rare, setup also adds two allow rules to your local Claude Code settings, `.claude/settings.local.json`, and leaves everything else in that file as it is:

- `Bash(node .tenonry/bin/tenonry.mjs *)`: lets Tenonry run its own bookkeeping script (task state, checks, commits) without asking each time
- `mcp__playwright`: lets the design reviewer use its browser to look at your pages

Remove either rule if you would rather approve those actions yourself.

Each finished task becomes one local commit named `tenonry(<task>): <title>`. Tenonry never pushes, and it never bypasses your git hooks.

## Optional settings

`.tenonry/config.json` holds knobs you can edit; they survive refreshes:

- `routing.thresholds`: when Jev's answers send a task to Haiku, Sonnet, or Opus, when to ask you questions, and when a request is planned (`planning`: raise `minNeedsPlan` to skip the plan more often, set it to 0 to plan every request)
- `limits`: parallel tasks, retries per model, and review rounds
- `readGuard`: extra paths agents may not read, or paths to allow
- `outputFilter`: how many lines of test output reach the model, and extra commands to filter

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

Not chosen yet.

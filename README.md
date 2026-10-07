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
- Progress appears as one short line per event. The run ends with what changed, how to try it, what needs attention, and how to undo it.

## Optional: smarter model routing

Add your OpenRouter key to the project's `.env` file:

```
OPENROUTER_API_KEY=sk-or-...
```

Tenonry reads the key from that file only, never from your shell environment, and never prints or logs it. Without a key everything still works: tasks run on Sonnet (never below a specialist's own minimum) and code reviews run on Opus. You see a one-time tip about it. Set `TENONRY_JEV_DISABLE=1` to turn Jev off even when a key exists.

## What gets created

Commit these:

- `.claude/agents/tenonry-*.md`: the generated agents
- `.tenonry/config.json`, `.tenonry/ownership.json`, `.tenonry/rubrics/`
- `.tenonry/design-direction.md`: the visual direction, created on the first UI run

Tenonry adds these to `.gitignore` for you: `.env`, `.tenonry/bin/`, `.tenonry/state.json`, `.tenonry/logs/`, `.tenonry/runs/`.

Each finished task becomes one local commit named `tenonry(<task>): <title>`. Tenonry never pushes, and it never bypasses your git hooks.

## Optional settings

`.tenonry/config.json` holds knobs you can edit; they survive refreshes:

- `routing.thresholds`: when Jev's answers send a task to Haiku, Sonnet, or Opus, and when to ask you questions
- `limits`: parallel tasks, retries per model, and review rounds
- `readGuard`: extra paths agents may not read, or paths to allow
- `outputFilter`: how many lines of test output reach the model, and extra commands to filter

After about 20 tasks, `node .tenonry/bin/tenonry.mjs calibrate` compares Jev's choices with how often the first attempt passed and suggests threshold changes. It never edits your config.

## Requirements

- Claude Code
- Node.js 18 or newer
- git, with your project inside a git repository
- macOS, Linux, or WSL

## Remove Tenonry from a project

Delete `.claude/agents/tenonry-*.md` and the `.tenonry/` directory. Then uninstall the plugin with `claude plugin uninstall tenonry`.

## Development

The build documents are in `docs/`. Run the tests with `node --test`; the plugin has no dependencies.

## License

Not chosen yet.

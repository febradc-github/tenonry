# Tenonry plugin repository

This repository builds **Tenonry**, a Claude Code plugin that runs a specialist multi-agent pipeline (planner, art director, test author, 70 stack specialists, design and code reviewers) with Jev (TypeSafe's decision model via OpenRouter) choosing models and gating reviews. The full design lives in `docs/`.

Ease of use matters as much as code quality: one command for users, automatic setup, never blocking the user, plain progress lines (`docs/01-ARCHITECTURE.md` section 8).

## Autonomy protocol (highest priority rule)

You build this plugin without asking the developer anything. Never use AskUserQuestion. Never end a turn with a question. Never stop to wait for confirmation.

When you meet a gap, an ambiguity, or a conflict:

1. Look it up in this order: `docs/DECISIONS.md`, `docs/03-COMPONENT-SPECS.md`, `docs/04-JEV-ROUTING.md`, `docs/06-AGENT-AND-SKILL-TEXTS.md`, `docs/07-QUALITY-RUBRICS.md`, `docs/01-ARCHITECTURE.md`.
2. For Claude Code or Jev platform behavior, check the live official docs (index: https://code.claude.com/docs/llms.txt and https://openrouter.ai/docs/llms.txt). Live docs beat these documents on platform behavior only.
3. If still open, choose the most conservative option that keeps the plugin working, fail-open, and dependency-free.
4. Record every decision you made in `docs/DECISIONS.md` (next free `D-` number, with context, decision, and reason) and continue.

The only things you may not decide alone are listed under "Hard limits" below. Even those never become questions: you skip the action and note it in the final report.

## Hard limits

- Never commit or print secrets. `.env` is read only by scripts, never echoed, never committed.
- Never push to any remote. Commit locally only.
- Never run destructive commands outside this repository or on `.git`.
- Never add runtime npm dependencies. Dev tooling is limited to what Node.js ships (`node:test`, `node:assert`).
- If a live check is impossible (no API key, no network, `claude` CLI missing), skip it, use fixtures, and record the skip in the final report.

## Conventions

- Node.js 18+ ES modules (`.mjs`), zero dependencies. POSIX shells only (macOS, Linux, WSL).
- Every script that prints a result prints exactly one JSON object to stdout. Diagnostics go to stderr.
- Hook scripts are fail-open: any internal error exits 0 with no output, except where a spec says to block.
- Text files: UTF-8, LF line endings, no em dash characters (U+2014) anywhere in shipped text.
- Keep agent and skill descriptions under 30 words. Detail goes in bodies.
- Paths inside the plugin are referenced with `${CLAUDE_PLUGIN_ROOT}` in hooks, and with `$CLAUDE_PROJECT_DIR/.tenonry/bin/` inside rendered project agents.

## Commands

- Run all tests: `node --test`
- Validate the plugin: `claude plugin validate .` (skip if the CLI is unavailable)
- Validate the catalog: `node scripts/tenonry.mjs catalog-check`
- Install locally for a smoke test: see `docs/08-BUILD-PLAN-AND-TESTS.md`, section "Local install"

## Working method

- Build in the slices defined in `docs/08-BUILD-PLAN-AND-TESTS.md`, in order. Each slice ends with its tests passing and one local commit: `slice N: <summary>`.
- Copy agent, skill, and rubric texts from `docs/06-AGENT-AND-SKILL-TEXTS.md` and `docs/07-QUALITY-RUBRICS.md` verbatim except for placeholders. Do not paraphrase them.
- Copy `docs/05-SPECIALIST-CATALOG.json` to `library/catalog.json` verbatim.
- When the build is complete, write `BUILD-REPORT.md` at the repo root: what was built, test results, skipped checks, and every decision added to `docs/DECISIONS.md` during the build.

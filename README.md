# Tenonry build documents

Everything a Claude Code coding agent needs to build the Tenonry plugin end to end, without asking the developer questions.

## How to use

1. Create an empty git repository named `tenonry`.
2. Copy this folder's contents into it, so `CLAUDE.md` sits at the repository root and the `docs/` folder sits beside it.
3. Optional but recommended: create `.env` at the repository root containing `OPENROUTER_API_KEY=sk-or-...` so live Jev tests can run. Without it, the agent builds and tests everything against recorded fixtures and marks live tests as skipped.
4. Start Claude Code in the repository root and paste the prompt from `docs/00-START-PROMPT.md`.

## Requirements on the build machine

- Claude Code, recent version (the docs list the minimum versions of features they rely on)
- Node.js 18 or newer
- git

## Reading order for the agent

| File | Purpose |
|---|---|
| `CLAUDE.md` | Standing rules for the build session: autonomy protocol, conventions, commands |
| `docs/00-START-PROMPT.md` | The prompt the developer pastes to start the build |
| `docs/01-ARCHITECTURE.md` | What Tenonry is, every component, runtime layout, phases, decision ownership |
| `docs/02-PLATFORM-REFERENCE.md` | Verified Claude Code and Jev facts with sources, plus the Phase 0 verification checklist |
| `docs/03-COMPONENT-SPECS.md` | Exact behavior, inputs, outputs, schemas and algorithms for every file to build |
| `docs/04-JEV-ROUTING.md` | Jev endpoint, the exact question sets, thresholds, mappings and fallbacks |
| `docs/05-SPECIALIST-CATALOG.json` | The 70 builder specialists: detection signals, owned files, priorities, idioms, slop patterns |
| `docs/06-AGENT-AND-SKILL-TEXTS.md` | Final text of every skill, core agent, and agent template |
| `docs/07-QUALITY-RUBRICS.md` | Design and code rubrics shipped as runtime assets |
| `docs/08-BUILD-PLAN-AND-TESTS.md` | Build slices, acceptance criteria, test plan, definition of done |
| `docs/DECISIONS.md` | Decision log, pre-filled with every decision already made |

## Source of truth order

When two sources disagree, the higher one wins:

1. Live official documentation fetched during Phase 0 (for platform behavior only)
2. `docs/DECISIONS.md`
3. `docs/03-COMPONENT-SPECS.md` and `docs/04-JEV-ROUTING.md`
4. `docs/06-AGENT-AND-SKILL-TEXTS.md` and `docs/07-QUALITY-RUBRICS.md`
5. `docs/01-ARCHITECTURE.md`
6. Everything else

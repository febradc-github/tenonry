# Start prompt

Paste everything inside the block below into Claude Code, started at the root of the `tenonry` repository. Opus is the recommended main model for the build session.

```text
You are building the Tenonry Claude Code plugin from the specification in this repository. Work fully autonomously from start to finish.

READ FIRST, IN THIS ORDER:
CLAUDE.md, docs/01-ARCHITECTURE.md, docs/02-PLATFORM-REFERENCE.md, docs/03-COMPONENT-SPECS.md, docs/04-JEV-ROUTING.md, docs/06-AGENT-AND-SKILL-TEXTS.md, docs/07-QUALITY-RUBRICS.md, docs/08-BUILD-PLAN-AND-TESTS.md, docs/DECISIONS.md. Skim docs/05-SPECIALIST-CATALOG.json for structure; you will copy it verbatim.

AUTONOMY RULES (NON-NEGOTIABLE):
1. Do not ask me anything at any point. Do not use AskUserQuestion. Do not end any turn with a question or a request for confirmation.
2. Resolve every gap with the autonomy protocol in CLAUDE.md: look it up in the docs, then in live official docs, then choose the most conservative working option. Log each decision in docs/DECISIONS.md and keep going.
3. Hard limits in CLAUDE.md are skipped and reported, never asked about.
4. If something fails, debug it, fix it, and continue. If a check cannot run in this environment, use the fixture path, mark it skipped, and continue.
5. Do not stop early. You are done only when the definition of done in docs/08-BUILD-PLAN-AND-TESTS.md is met.

PROCESS:
Phase 0: Run the verification checklist in docs/02-PLATFORM-REFERENCE.md against live documentation. Record each result (confirmed, or changed plus what you will do instead) in docs/DECISIONS.md before writing plugin code.
Phases 1 to 6: Build slices 1 through 6 from docs/08-BUILD-PLAN-AND-TESTS.md in order. After each slice: run `node --test`, fix until green, then commit locally as `slice N: <summary>`.
Final: Run the full test suite, `claude plugin validate .` if available, and the local install smoke test if the claude CLI is available. Then write BUILD-REPORT.md as described in CLAUDE.md and commit it.

QUALITY BAR:
- Copy texts from docs/06 and docs/07 verbatim except placeholders. Copy docs/05-SPECIALIST-CATALOG.json to library/catalog.json verbatim.
- Every script has unit tests. Every hook has tests that feed it JSON on stdin and assert stdout, stderr, and exit code.
- Zero runtime dependencies. Node 18+ ESM. No em dash characters in any shipped file.
- Readable code: small functions, clear names, early returns, comments only for why, no speculative abstractions.

Begin with Phase 0 now.
```

## What the developer should expect

- The agent works through Phase 0 and six slices, committing after each.
- It never pauses for input. Questions it would have asked appear instead as entries in `docs/DECISIONS.md`.
- The run ends with `BUILD-REPORT.md` at the repository root, listing results, skipped checks, and new decisions.

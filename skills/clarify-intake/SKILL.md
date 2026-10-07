---
name: clarify-intake
description: Tenonry intake. Asks the user targeted questions until a Tenonry request is buildable, then writes the run brief.
allowed-tools: Bash(node *)
---

TENONRY_CLARIFY_SKILL

You were invoked by the Tenonry orchestrator with a run id and a mode (`yes` or `auto`).

1. Read the request from `.tenonry/runs/<id>/route.json` (`prompt`). Look at the repository only as much as needed to understand what already exists (README, top-level layout, the feature area the request names).
2. List the gaps that would change what gets built and cannot be inferred from the request or the repository: scope boundaries, users and roles, behavior and edge cases, data involved, the look and feel or references for any UI, and how success will be judged. Ignore gaps with an obvious sensible default.
3. Mode `auto` with no material gaps: go to step 5.
4. Ask with AskUserQuestion: at most 4 questions per round, each with 2 to 4 concrete options and the recommended option first, labeled "(recommended)". Ask only what matters most; skip anything with a sensible default. At most 2 rounds. After the last round, use the recommended option for any gap still open.
5. Save the brief by running `node .tenonry/bin/tenonry.mjs write-brief <id> --stdin` and passing this content through a quoted heredoc (`<<'TENONRY_BRIEF'`, the content, then a line containing only `TENONRY_BRIEF`):

```
# Request
<request verbatim>

# Clarified requirements
<one bullet per answer, stated as a requirement>

# Assumptions
<one bullet per default you chose, marked as an assumption>

# Out of scope
<anything the user excluded>

# Acceptance hints
<observable outcomes the user mentioned>
```

Never invent requirements the user did not state or clearly imply. Label every default as an assumption.

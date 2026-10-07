---
name: run
description: Tenonry. Plan, design, test, build, review, and commit a change with specialist agents. Also shows progress, resumes, undoes, and shows help.
disable-model-invocation: true
argument-hint: <what you want> | resume | undo | help
allowed-tools: Bash(node *), Bash(git rev-parse *)
---

TENONRY_RUN_SKILL

You are the Tenonry orchestrator. The user's input is: $ARGUMENTS

## Rules

- You coordinate. You never write source code, tests, plans, designs, contracts, or reviews yourself. Each comes from its owning agent.
- Use `node .tenonry/bin/tenonry.mjs <command>` for every bookkeeping step. Follow the `action` field in its JSON output exactly.
- When spawning an agent, always pass the `model` that `tenonry.mjs` returned (or the model stated in this skill) as the per-invocation model, and pass the delegation text exactly as given.
- Never change the session model or effort. Never block or delay the user over the model choice.
- Never ask the user anything, except through the clarify-intake skill in step 3.
- Talk to the user only with the progress lines below, filled in. Do not summarize agent output or add commentary.
- When agents run in the background, wait for their completion notifications. Do not poll files in a loop.

## Progress lines

Print each line when its event happens:

- `Setting up Tenonry for this project...` then `Ready: <n> specialists (<ids, comma-separated>).`
- `Tip: add OPENROUTER_API_KEY to your .env for smarter model routing. Using defaults for now.` (only when `state.notices.jevKeyMissing` is false; then run `tenonry.mjs notice-shown jevKeyMissing`)
- `Tip: Tenonry coordinates more reliably on Sonnet. Continuing on Haiku.` (when `route.mainModel.notice` is true)
- `Clarifying a few details...`
- `Planning...`
- `Designing the look...`
- `Writing the contract and tests: <n> tasks.`
- `Building <k>/<n>: <task id> <title> (<model>)`
- `Fixing <task id>: <tests failed | review notes>.`
- `Moving <task id> to <model> after repeated test failures.`
- `Reviewed <task id>: code <passed | needs fixes>, design <weighted score | n/a>.`
- `Done <task id>, committed <short sha>.`
- `Blocked <task id>: <reason>.`
- `Running the final checks...`

## Step 0: read the input

Find the plugin root first: use `${CLAUDE_SKILL_DIR}/../..`; if that text appears unexpanded, use the value after `TENONRY_PLUGIN_ROOT=` from the session context.

Then, by `$ARGUMENTS` (case-insensitive, trimmed):

- `help`: print the help block below and stop.
- empty, `status`, `resume`, or `continue`: go to "Continue a run" below.
- `undo`: run `tenonry.mjs undo` and print one line, then stop:
  - `ok: true`: `Undone: reverted <n> commits from run <id>.` (or `Nothing to undo.` when `reverted` is empty)
  - `uncommitted_changes`: `Undo needs a clean working tree. Commit or stash these first: <files>.`
  - `conflict`: `Undo stopped at <short sha> because of a conflict. Reverted <n> commits before it.`
- anything else: it is a new request. Go to step 1.

Help block:

```
Tenonry
  /tenonry:run <what you want>   Build it: plan, design, tests, code, reviews, commits
  /tenonry:run                   Show progress, or continue an unfinished run
  /tenonry:run undo              Revert the last run's commits
  /tenonry:run help              Show this help

Examples
  /tenonry:run add a loyalty points page for customers
  /tenonry:run fix the login error when the email has uppercase letters

Setup is automatic. Optional: add OPENROUTER_API_KEY to .env for smarter model routing.
```

### Continue a run

1. If `.tenonry/config.json` does not exist, print `No Tenonry runs yet. Start one with /tenonry:run <what you want>.` and stop.
2. Run `tenonry.mjs restart-pending false`, then `tenonry.mjs status` and print its `display`.
3. If there is no active run, or its phase is `done` or `stopped`, stop.
4. Otherwise run `tenonry.mjs recover <run>` (tasks whose agents were lost go back to waiting) and continue at the step matching the phase: `intake` step 3, `planning` step 4, `design` step 5, `contract` step 6, `building` step 7, `final-gate` step 8.

## Step 1: setup (automatic, every new request)

1. `git rev-parse --is-inside-work-tree` fails: print `Tenonry needs a git repository. Run git init and commit your files, then try again.` and stop.
2. Run `node "<plugin root>/scripts/init.mjs" --if-changed` from the project directory.
   - `ok: false`: print `Setup failed: <error>.` and stop.
   - `skipped: false`: print the two setup progress lines.
   - `jevKey: false`: print the key tip if it has not been shown.
3. If `agentsDirCreated` is true: save the request by passing it verbatim through a quoted heredoc: `node .tenonry/bin/tenonry.mjs new-run --prompt-stdin <<'TENONRY_REQUEST'`, then the request on the following lines, then a line containing only `TENONRY_REQUEST`. Then run `tenonry.mjs restart-pending true`, print `Tenonry is set up. Restart Claude Code once so it can load the new agents, then type /tenonry:run to continue.` and stop.

## Step 2: run directory

- If the context for this prompt contains `TENONRY_ROUTE run=<id> ...`, use that run and read `.tenonry/runs/<id>/route.json`.
- Otherwise run `tenonry.mjs new-run --prompt-stdin` with the request passed verbatim through a quoted heredoc as in step 1, then `tenonry.mjs intake <id>`, and read `route.json`.
- When resuming a run whose `route.json` has `fallbackReason: "no_hook"`, run `tenonry.mjs intake <id>` first.
- If `mainModel.notice` is true, print the Haiku tip.

## Step 3: intake

- `clarify: yes` or `auto`: print `Clarifying a few details...` and invoke the clarify-intake skill with the run id and mode (`yes` or `auto`).
- `clarify: no`: run `tenonry.mjs write-brief <id>`.

## Step 4: planning

Print `Planning...`. Run `tenonry.mjs phase <id> planning`. Spawn `tenonry-planner` with model `opus` and this delegation:

```
TENONRY_PLAN
run: <id>
brief: .tenonry/runs/<id>/brief.md
route: .tenonry/runs/<id>/route.json
write_to: .tenonry/runs/<id>/plan.md
```

When it finishes, read only the metadata block at the top of `plan.md` and note `ui`.

## Step 5: design (only when `ui: yes`)

Print `Designing the look...`. Run `tenonry.mjs phase <id> design`. Spawn `tenonry-art-director` with model `opus`:

```
TENONRY_DESIGN
run: <id>
mode: <create if .tenonry/design-direction.md does not exist, otherwise extend>
plan: .tenonry/runs/<id>/plan.md
brief: .tenonry/runs/<id>/brief.md
direction: .tenonry/design-direction.md
write_brief_to: .tenonry/runs/<id>/design-brief.md
```

## Step 6: contract

Run `tenonry.mjs phase <id> contract`. Spawn `tenonry-test-author` with model `opus`:

```
TENONRY_CONTRACT
run: <id>
mode: create
plan: .tenonry/runs/<id>/plan.md
design_brief: .tenonry/runs/<id>/design-brief.md   (omit this line when ui is no)
write_to: .tenonry/runs/<id>/contract.json
summary_to: .tenonry/runs/<id>/contract.md
```

Then run `tenonry.mjs contract-check <id>`.
- Invalid and `contractFixes` is at most `limits.maxContractFixes`: resume the test author with `mode: fix` and the errors listed under `errors:`, then check again.
- Invalid after that: run `tenonry.mjs phase <id> stopped` and `tenonry.mjs report <id>`, print `Stopped: the contract could not be completed. Details: <report path>`, and stop.
- Valid: print `Writing the contract and tests: <n> tasks.` and run `tenonry.mjs phase <id> building`.

## Step 7: dispatch loop

Repeat:

1. Run `tenonry.mjs next <id>`.
2. If `ready` and `running` are both empty, leave the loop.
3. Spawn every entry in `ready` (agent, model, delegation) before waiting for any of them, printing a `Building` line for each.
4. As each specialist finishes, handle its task by reading `.tenonry/runs/<id>/reports/<task>.json`:
   - `needs_owner`: run `tenonry.mjs handoff <id> <task>`. It creates follow-up tasks and re-queues this task. Continue the loop.
   - `contract_issue`: resume the test author with `mode: fix`, the task id, and the report's `contractIssues` under `issues:`. Run `tenonry.mjs contract-check <id>`, then `tenonry.mjs reset-task <id> <task>`. Continue the loop.
   - `blocked`: run `tenonry.mjs block-task <id> <task> --reason "<report summary>"`, print the `Blocked` line, and continue the loop.
   - `done`, or the report is missing: run `tenonry.mjs verify <id> <task>` and follow `action`:
     - `resume`: print `Fixing <task>: tests failed.`, resume the same agent (SendMessage) with `delegation`; when it finishes, handle its report again.
     - `respawn`: print the `Moving` line and continue the loop (the next `next` call starts a fresh attempt on the new model).
     - `blocked`: print the `Blocked` line and continue the loop.
     - `review`: run `tenonry.mjs ownership-check <id> <task>`.
       - Violations: run `tenonry.mjs revert-violations <id> <task>`, resume the agent with the list of violating paths and the instruction to keep changes inside owned files, then verify again.
       - OK: run `tenonry.mjs review-plan <id> <task>`, spawn every reviewer it returns (agent, model, delegation) in parallel, wait for all, then run `tenonry.mjs review-status <id> <task>`, print the `Reviewed` line, and follow `action`:
         - `fix`: print `Fixing <task>: review notes.`, resume the specialist with `delegation`; when it finishes, verify again and continue from there.
         - `checkpoint`: run `tenonry.mjs checkpoint <id> <task>` and print the `Done` line.

## Step 8: final checks

Print `Running the final checks...`. Run `tenonry.mjs phase <id> final-gate`, then `tenonry.mjs final-gate <id>`. If `reopened` is not empty, run `tenonry.mjs phase <id> building` and return to step 7.

## Step 9: finish

Run `tenonry.mjs report <id>` and print, using its `summary`:

```
Finished: <done>/<total> tasks.
What changed:
  <task id> <title>   (one line per finished task)
Try it: <preview command and URL, or the test command, or "see the report">
Needs attention: <blocked tasks and unresolved review notes, or "nothing">
Report: <report path>
Undo this run: /tenonry:run undo
```

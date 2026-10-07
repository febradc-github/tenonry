# Tenonry code rubric

A change passes review when it has no blocking or major findings. Rule ids are cited in findings.

## Rules

- **C1 Correctness.** The change satisfies every acceptance criterion of its task and matches the contract's interfaces exactly (shapes, status codes, error forms). Edge cases named in the plan are handled.
- **C2 Naming.** Names say what things are and do, in the domain's language. No vague names (data, info, handle, manager, util) where a precise one exists.
- **C3 Security and data handling.** External input is validated at the boundary. Authorization is enforced server-side for every action. No secrets in code. Queries are parameterized. No mass assignment of ownership or permission fields. Sensitive data is not logged.
- **C4 Small, single-purpose units.** Each function does one thing. Long functions are split at natural seams, not into arbitrary fragments.
- **C5 Readable control flow.** Early returns over deep nesting. No clever one-liners that hide intent. No nested ternaries.
- **C6 Error handling at the right level.** Errors are handled where something useful can be done, and propagated otherwise. No swallowed exceptions. No defensive try/catch around trusted internal calls.
- **C7 No speculative generality.** No abstractions, interfaces, factories, options, or extension points without a current second use. Three similar lines beat a premature helper.
- **C8 Reuse over reinvention.** Existing project utilities, components, and framework features are used instead of re-implemented.
- **C9 Comments explain why.** No comments restating the code. No narrative comments. No docstrings, comments, or type annotations added to code the task did not change.
- **C10 No leftovers.** No dead code, commented-out code, debug output, TODOs without an issue reference, or scaffolding from earlier attempts.
- **C11 Consistency.** The change follows the project's existing structure, naming, formatting, and patterns. A newcomer could not tell which lines were generated.
- **C12 Performance basics.** No N+1 queries, unbounded queries or loops over user-controlled sizes, blocking I/O in request paths, or work repeated inside loops that could run once.

## Severity guide

- **blocking**: violates C1 or C3, or causes data loss, crashes, or a broken build.
- **major**: violates any other rule in a way a careful human reviewer would request changes for, or matches an item on the specialty's slop list.
- **minor**: a worthwhile improvement that does not block merging.

## Common generated-code tells (each is at least major when found)

- Comments that narrate what the next line does.
- Wrapper functions that only call another function.
- A new helper that duplicates an existing project utility.
- Broad try/catch blocks that log and continue.
- Unused parameters, options, or configuration flags "for flexibility".
- Several near-identical versions of the same logic in one change.
- Type annotations, docstrings, or reformatting applied to unrelated code.
- Tests or assertions weakened, skipped, or deleted to make a run pass.

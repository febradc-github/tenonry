# 07. Quality rubrics

Two runtime assets. Copy each block between `<<<` and `>>>` verbatim to the named file. `tenonry.mjs review-status` enforces the pass rules numerically; the texts tell reviewers how to score.

---

## 1. `library/rubrics/design.md`

<<<
# Tenonry design rubric

Based on the public judging rubric of the Web Design Awards (webdesignawards.io), where winning sites typically score between 7.5 and 8.5 out of 10. Score each criterion from 0 to 10. Tenonry computes the weighted score itself.

## Pass rule

Weighted score of at least 7.5, every criterion at least 6, and no blocking finding.

## Criteria

### ux: User experience and strategy (weight 0.15)
The journey is intentional and earns the visitor's time. The primary action on each screen is obvious. Navigation, hierarchy, and flow follow from what users are trying to do. The strategy is visible in the design itself, not assumed.

### visual: Visual design and branding (weight 0.15)
The visuals feel original and unmistakably on brand for this subject. Palette, typography, layout, and imagery work as one identity. Decorative competence is not enough: a tidy page built from defaults scores 5 to 6.

### content: Content and storytelling (weight 0.10)
The copy communicates value quickly and rewards a closer read. Words are written from the user's point of view, buttons say what happens, and empty and error states tell users what to do next. No filler, no lorem ipsum.

### accessibility: Accessibility and inclusivity (weight 0.10)
Baseline compliance is the floor: semantic structure, labels, visible focus, full keyboard operation, contrast of at least 4.5:1 for body text and 3:1 for large text and UI components, touch targets of at least 44 by 44, and reduced motion respected. Higher scores go to work that serves diverse needs beyond the floor.

### performance: Performance and technical implementation (weight 0.20)
The experience feels immediate and stable: fast first paint, no layout shift, no heavy assets loaded before they are needed, motion that stays smooth. Heavy sites do not win. 3D and large media are lazy-loaded with fallbacks.

### responsive: Responsiveness and multi-device support (weight 0.10)
Layouts adapt fluidly at 375, 768, and 1440 pixels and across touch, mouse, and keyboard input. The mobile view is designed, not a squeezed desktop.

### innovation: Innovation and future readiness (weight 0.20)
Original concepts that push the medium forward, with responsible use of new technology and durable thinking. One memorable signature element done well beats many effects.

## Score anchors (all criteria)

- 9 to 10: award-worthy; distinctive and executed with no notable flaws.
- 7 to 8: strong and intentional, with minor issues.
- 5 to 6: competent but generic, or good ideas with uneven execution.
- 3 to 4: clear flaws that users would notice.
- 0 to 2: broken or missing.

## Common generated-design tells (each is a finding unless the design direction calls for it)

- One border radius and one soft grey shadow on every element; content chopped into identical cards.
- Gradient washes and glows used as decoration.
- Uppercase eyebrow labels above every heading; numbered markers on content that is not a sequence.
- Accenting a single word of a headline in a different color or style.
- Middle-dot meta strings and arrows appended to every link or button.
- A big-number hero with a small label and a gradient accent.
- Fade-and-slide-up entrances on every section; hover animations on every card.
- Default framework palettes and default type stacks.
- A 3D object or animation unrelated to the subject.
- Placeholder or salesy copy instead of plain, specific language.

## Findings

Every finding names the criterion, the responsible file when it can be identified, the problem as observed, and a fix that stays inside the design direction. Deviations from the design direction are findings even when they look acceptable.
>>>

---

## 2. `library/rubrics/code.md`

<<<
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
>>>

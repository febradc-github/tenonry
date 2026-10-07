# Tenonry design rubric

Based on the public judging rubric of the Web Design Awards (webdesignawards.io), where winning sites typically score between 7.5 and 8.5 out of 10. Score each criterion from 0 to 10. Tenonry computes the weighted score itself.

## Pass rule

Each screen has a profile set in the design brief: `showcase` or `product`. A review uses the strictest profile among its screens. Pass with a weighted score of at least 7.5 using that profile's weights, no blocking finding, and every criterion at least 6, except that on `product` screens innovation needs only 5.

## Profiles

| Criterion | showcase | product |
|---|---|---|
| ux | 0.15 | 0.25 |
| visual | 0.15 | 0.15 |
| content | 0.10 | 0.05 |
| accessibility | 0.10 | 0.15 |
| performance | 0.20 | 0.15 |
| responsive | 0.10 | 0.15 |
| innovation | 0.20 | 0.10 |

Showcase pages are judged as award entries. Product screens are judged as tools: clarity, accessibility, and responsiveness carry more weight, and the identity is applied consistently rather than reinvented.

## Criteria

### ux: User experience and strategy (weight: showcase 0.15, product 0.25)
The journey is intentional and earns the visitor's time. The primary action on each screen is obvious. Navigation, hierarchy, and flow follow from what users are trying to do. The strategy is visible in the design itself, not assumed.

### visual: Visual design and branding (weight: showcase 0.15, product 0.15)
The visuals feel original and unmistakably on brand for this subject. Palette, typography, layout, and imagery work as one identity. Decorative competence is not enough: a tidy page built from defaults scores 5 to 6.

### content: Content and storytelling (weight: showcase 0.10, product 0.05)
The copy communicates value quickly and rewards a closer read. Words are written from the user's point of view, buttons say what happens, and empty and error states tell users what to do next. No filler, no lorem ipsum.

### accessibility: Accessibility and inclusivity (weight: showcase 0.10, product 0.15)
Baseline compliance is the floor: semantic structure, labels, visible focus, full keyboard operation, contrast of at least 4.5:1 for body text and 3:1 for large text and UI components, touch targets of at least 44 by 44, and reduced motion respected. Higher scores go to work that serves diverse needs beyond the floor.

### performance: Performance and technical implementation (weight: showcase 0.20, product 0.15)
The experience feels immediate and stable: fast first paint, no layout shift, no heavy assets loaded before they are needed, motion that stays smooth. Heavy sites do not win. 3D and large media are lazy-loaded with fallbacks.

### responsive: Responsiveness and multi-device support (weight: showcase 0.10, product 0.15)
Layouts adapt fluidly at 375, 768, and 1440 pixels and across touch, mouse, and keyboard input. The mobile view is designed, not a squeezed desktop.

### innovation: Innovation and future readiness (weight: showcase 0.20, product 0.10)
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

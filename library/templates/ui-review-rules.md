
## UI rules to check

For UI work, read `design_direction` and `design_brief` from the delegation, then check every UI file in the change. A violation is `major`; a missing state that breaks a user flow is `blocking`.

- U1. Only the direction's tokens are used for color, type, spacing, radius, elevation, and motion. No hardcoded values.
- U2. Every state the brief lists is implemented: loading, empty, error, success, and long content.
- U3. Accessibility in code: semantic elements, labels on controls, alt text, visible focus styles, keyboard support on custom controls, and `prefers-reduced-motion` respected.
- U4. Copy comes from the brief. No lorem ipsum. Buttons say what they do.
- U5. No decoration, animation, or effect the direction does not call for.

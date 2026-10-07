
## UI rules

- Before writing UI, read `design_direction` and `design_brief`. Implement them exactly; they are decisions, not suggestions.
- Use only the direction's tokens for color, type, spacing, radius, elevation, and motion. No hardcoded values.
- Build every state the brief lists: loading, empty, error, success, and long content.
- Make layouts work at 375, 768, and 1440 pixels wide. Touch targets are at least 44 by 44.
- Accessibility floor: semantic elements, labels, visible focus, full keyboard operation, the direction's contrast, and `prefers-reduced-motion` respected.
- Use the brief's copy and voice. No lorem ipsum. Buttons say what they do.
- Add no decoration, animation, or effect the direction does not call for.

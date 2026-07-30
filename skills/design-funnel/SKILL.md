---
name: design-funnel
description: Design, compose, or visually improve an Astro sales funnel using the repository's AstroDeck foundation and generic conversion-design primitives. Use for landing-page structure, new sections, brand customization, responsive behavior, large CTA hierarchy, product previews, checkout and upsell presentation, or visual work that should feel intentionally human-designed without forcing a fixed block template.
---

# Design a Funnel

Give the offer an original composition. Constrain what must work, not every creative decision.

## Process

1. Read `PROJECT.md`, `AGENTS.md`, [references/composition.md](references/composition.md), and the relevant files in `system/globals/` before deciding.
2. Inspect the current page, shared components, design tokens, and owned golden funnel. Reuse strong primitives; do not recreate proven checkout or upsell surfaces.
3. Translate the offer into persuasion jobs and a responsive visual sequence.
4. Compose explicit Astro using existing components where useful. Create or extend a component when the offer needs a genuinely different treatment.
5. Keep editable words and media separate from layout code and expose them through the content model.
6. Customize semantic tokens rather than scattering hardcoded styles.
7. Design mobile transformations deliberately. Decide what reorders, simplifies, stacks, crops, or disappears.
8. Review first-fold clarity, section rhythm, CTA prominence, checkout continuity, and upsell continuity in rendered pages.

## Creative freedom

Choose the section order, visual rhythm, composition, artwork, and necessary component extensions. Do not force a universal block renderer or make every offer look identical.

## Invariants

- Keep one obvious primary action and large, unmistakable buttons.
- Keep the first viewport focused on promise, product, price, and action.
- Preserve readable type, strong contrast, touch targets, focus states, and no horizontal overflow.
- Use real product visuals or honest placeholders; never add stock imagery, fake logos, or invented proof.
- Keep checkout, bump, decline, and upsell actions visually calm and unambiguous.
- Do not carry a design-reference site's identity, screenshots, assets, copy, URL, or provenance into the product. Honest competitor comparisons are allowed when they are relevant, accurate, and not confusing about affiliation.

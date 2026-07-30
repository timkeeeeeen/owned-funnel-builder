# Keystatic field conventions

## Field language

Use labels a first-time website owner understands:

- **Main headline** — “The largest promise at the top of the page. Aim for one clear sentence.”
- **Button text** — “What the main purchase button says.”
- **Regular price** — “The comparison price shown crossed out, if it is real.”
- **Order bump** — “A small optional extra offered during checkout.”
- **First offer after checkout** — Avoid requiring the user to know “upsell.”

## Expose

- Copy, images, video, proof, FAQs, guarantee, price display, CTA labels, bump copy, upsell copy, completion copy, email copy, and safe brand settings.
- Hero preview copy and steps, section headings, highlight-bar items, price-card inclusions, and demo-link labels live in the offer record rather than the Astro component.

## Verify the editor

- Load `/keystatic`, the target landing-page item, its matching checkout-funnel item, and the site singleton in a real browser.
- Treat a styled error page with HTTP 200 as a failure. Check visible fields and browser errors.
- Keep offer routes pre-rendered in editor mode so the generic `src/pages/[slug].astro` route cannot intercept `/keystatic`.

## Protect

- API keys, product IDs, payment state, database bindings, routes, CSS classes, arbitrary styles, build configuration, and deployment controls.

## Validation

Name the field and the remedy. Prefer “Main headline is 104 characters; shorten it to about 70” over a schema error. Warn for subjective quality limits; block only malformed or unsafe state.

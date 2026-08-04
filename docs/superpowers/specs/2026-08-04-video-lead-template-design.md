# Video Lead Funnel Template Design

## Goal

Add a second, unpublished version of the current Owned Funnel Builder offer so its existing copy and checkout can be tested in a fully different landing-page layout. The new layout should closely follow the visual character and section rhythm of the supplied Perspective reference without copying its brand, claims, testimonials, media, or wording.

## Scope Guard

This change adds template selection, one new landing-page template, and one duplicate test offer. It does not change payment processing, checkout behavior, fulfillment, publishing, or the original offer page. The two existing unrelated working-tree edits remain untouched.

## Template Architecture

- Add an optional `template` field to the offer content model. Missing values continue to render the existing default layout.
- Route offer rendering through a small explicit template registry with `default` and `video-lead` entries.
- Implement `video-lead` as its own Astro landing-page component while reusing the shared layout, analytics, checkout dialog, and existing offer primitives.
- Duplicate the current Owned Funnel Builder offer into an unpublished comparison route using `template: "video-lead"`.
- Let the comparison offer reuse the original offer's checkout funnel through an optional checkout-funnel reference, avoiding duplicate products or payment configuration.
- Extend the new-offer command only as far as needed to accept a template choice, defaulting to `default`.

Adding another template later should require one Astro component and one registry entry. No generic block renderer, plugin system, or template factory is introduced.

## Visual Design

The `video-lead` template uses the reference's restrained visual language:

- plain white primary canvas;
- near-black headings and body text;
- bright blue primary buttons with white labels;
- pale neutral-gray section bands and cards;
- one black inverted bonus band;
- Geist in straightforward sans-serif weights and compact, centered headline measures;
- small radii, light borders, restrained shadows, and generous vertical whitespace;
- a subtle blue-to-pink accent only around the main product demonstration;
- no decorative gradients elsewhere, stock imagery, copied logos, or reference assets.

Template colors are scoped semantic OKLCH variables so the existing funnel keeps its current appearance.

## Page Sequence

1. A narrow, centered hero with the existing headline, supporting copy, prominent video/product demonstration, price CTA, and CTA note.
2. A quiet trust/highlights strip using only the offer's existing truthful highlights.
3. A product-included section with the current deliverables arranged around the existing product preview.
4. A centered product/platform explanation followed by a simple two-column feature grid.
5. A proof section using the current verified proof metrics and examples instead of testimonials.
6. A repeated CTA close.
7. A black bonus band using the current bonuses.
8. A three-step getting-started section derived from the current offer workflow.
9. The current FAQ content in compact accessible disclosure rows.
10. Final CTA and the shared checkout dialog.

Sections without a useful mapping are omitted rather than forcing all default-template blocks into the new composition. All current copy remains available in the source offer; the new page selects and recomposes it without introducing claims.

## Responsive Behavior

- Mobile preserves headline, product/video proof, price, and primary action near the first viewport.
- Multi-column sections stack in reading order at small widths.
- Buttons remain at least 44px tall and become full-width where useful.
- Product media scales within the viewport with no horizontal overflow.
- Desktop uses narrow text measures and wider visual demonstrations rather than oversized type.

## Failure and Compatibility Behavior

- An absent template value renders the existing default template.
- An unknown template value fails clearly during the build instead of silently rendering the wrong page.
- Missing optional video or media falls back to the existing honest product-preview treatment.
- Checkout remains centralized and uses the same managed-checkout behavior as the original offer.

## Quality Targets

- The original funnel is visually and behaviorally unchanged.
- The comparison route clearly looks like the supplied reference: white, simple, compact, video-led, blue-actioned, and sectionally restrained.
- All visible words come from Owned Funnel Builder content or neutral interface labels.
- No serious or critical accessibility findings, resource errors, or horizontal overflow.

## Test Plan

- Add a focused test for default and `video-lead` template resolution, including rejection of an unknown template.
- Run content generation, Astro type checking, and the production build.
- Render both the original and comparison routes at mobile, tablet, and desktop sizes.
- Confirm the original screenshots remain unchanged in intent and the new route matches the approved composition.
- Check horizontal overflow, failed resources, heading order, keyboard focus, and serious/critical Axe findings.
- Activate the comparison route's primary CTA and confirm the shared checkout dialog opens without submitting a payment.

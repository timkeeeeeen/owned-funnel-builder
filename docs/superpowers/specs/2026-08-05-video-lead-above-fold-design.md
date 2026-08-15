# Video Lead Above-the-Fold Design

## Goal

Keep the Perspective-inspired centered hero while ensuring the complete hero video and primary checkout button are visible without scrolling at a strict 1366×768 desktop viewport.

## Design

- Preserve the centered single-column composition, copy, checkout behavior, colors, and remaining page sections.
- On desktop, reduce header and hero vertical padding, tighten headline/subheadline gaps, cap the video width so its 16:9 height fits the available viewport, and compact the price/button group.
- Keep the existing mobile flow and readable type sizes; do not force the entire mobile hero above the fold.
- Keep the CTA in normal document flow rather than making it sticky.

## Acceptance

- At 1366×768, the hero video and primary hero button have bounding rectangles fully inside the viewport.
- At desktop and mobile widths, the page has no horizontal overflow and the CTA remains usable.
- Existing offer-template, checkout-identity, noindex, sitemap, and production-build checks remain green; typecheck introduces no errors beyond the recorded 50-error repository baseline.

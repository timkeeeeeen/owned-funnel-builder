---
name: audit-funnel
description: Audit a funnel before or after publication for copy truth, conversion clarity, responsive visual quality, accessibility, performance, SEO, Keystatic editability, Dodo checkout, order bump, upsell flows, Resend fulfillment, Cloudflare deployment, and secret safety. Use for QA, release gates, regression checks, visual review, or investigating whether a live funnel is actually ready for paid traffic.
---

# Audit a Funnel

Gather evidence from source, rendered pages, provider state, and the exact live deployment. Absence of an obvious error is not proof.

## Workflow

1. Read `PROJECT.md`, `AGENTS.md`, [references/checklist.md](references/checklist.md), and relevant self-audit prompts in `system/prompts/`.
2. Establish the exact offer, routes, commit, environment, prices, products, and expected funnel sequence.
3. Run the repository's format, lint, type, KPI, build, Functions, payment-function, and quality-tool tests that exist. Inspect their scope before relying on them.
4. Render desktop, tablet, and mobile views. Capture the first fold and full page when browser tooling exists.
5. Inspect browser errors, failed resources, horizontal overflow, keyboard behavior, focus, contrast, touch targets, headings, metadata, and CTA destinations.
6. Verify copy against product truth and confirm price, guarantee, delivery, and CTA consistency.
7. Verify Keystatic exposes all intended customer-visible content without exposing secrets or infrastructure.
8. Run publish-mode configuration validation and require real support addresses, customer access links, and existing social assets.
9. Exercise checkout with the bump declined and selected at a no-charge level. Verify upsell decline paths and structurally verify accept paths without an unauthorized charge.
10. Verify fulfillment idempotency and entitlements through sandbox or safe fixtures.
11. Repeat relevant checks against the stable production URL and exact commit.
12. Fix in-scope defects, rerun affected checks, and report residual limitations precisely.

## Evidence standard

Do not call the funnel ready for paid traffic while required evidence is missing. Distinguish passed, failed, unverified, and intentionally uncharged behavior.

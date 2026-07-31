# PROJECT.md — Owned Funnel Builder

## Purpose

This repository lets a nontechnical owner launch and operate high-converting offer funnels through an intelligent coding agent and a visual copy editor.

The product is not a rigid block renderer. A good agent may compose explicit Astro around the offer. Shared primitives, payment contracts, and release checks provide the consistency.

## Product promise

The owner can:

1. describe an offer in plain language;
2. preview a polished landing page;
3. hand-edit routine copy in Keystatic;
4. connect Dodo or Stripe and Cloudflare through guided browser authorization;
5. publish a tested funnel with a main checkout, order bump, and up to two one-click upsells;
6. own the repository and hosting permanently.

## Creative rule

Constrain what must be true, not exactly how the agent creates it.

A strong page should usually have a clear promise, useful specificity, visible product proof, honest objections, a qualified audience, repeated conversion opportunities, and intentional mobile composition. The offer determines the best section order.

Do not invent testimonials, revenue, customer logos, scarcity, guarantees, or product capabilities. Label concepts and examples honestly.

## Stable design primitives

Read the relevant files under `system/globals/` before design work.

Preserve these outcomes:

- unmistakable hierarchy and readable fonts;
- large, high-contrast action buttons;
- constrained text widths;
- alternating surfaces and clear section rhythm;
- strong first-fold promise, price, and action;
- deliberate desktop, tablet, and mobile layouts;
- accessible focus states and touch targets;
- payment surfaces that remain visually calm and trustworthy.

Users may change tokens and compositions. New work should feel designed by a human, not generated from a generic component catalog.

## Content architecture

- `src/content/offers/*.json`: landing-page copy.
- `src/content/funnels/*.json`: products, bump, upsells, delivery, and completion copy.
- `src/content/site.json`: site name, contact details, and home-page defaults.
- `keystatic.config.ts`: visual editing schema.
- `src/components/offers/`: reusable conversion components.
- `src/pages/[slug].astro`: static offer routes.

Routine edits belong in content. Add or revise explicit Astro when the offer benefits from a custom visual or persuasion role. Do not force every future idea into a universal block schema.

## Payment invariants

Dodo is the supported default. Stripe is an optional first-class provider.

- Capture email before opening secure provider checkout.
- Never expose provider secrets to the browser.
- Record consent and campaign attribution in D1.
- Resolve every product through the server-side product registry.
- Accept at most one order bump and two upsells.
- Verify the original payment before showing an actionable upsell.
- Lock and idempotently process each upsell decision.
- Reuse a saved method when eligible; otherwise offer secure checkout.
- Always show a readable decline path.
- Treat signed provider payment webhooks as fulfillment truth.
- Deliver access through Dodo-native entitlements; when Resend is configured, send one additional idempotent branded access email.
- Never let an email retry create or repeat a payment.
- Keep the original known-good funnel tag recoverable.
- Record the selected provider on each lead and funnel so changing a site setting never changes an in-progress order.
- With Stripe, save the first card for off-session use, charge eligible upsells through PaymentIntents, and use hosted Checkout whenever the saved method needs customer action.
- With Stripe, require Resend and a real product access URL because Stripe does not provide Dodo-style digital entitlements.

## Release definition

Before calling a funnel ready:

- validate content and delivery links;
- typecheck and build Astro;
- compile Cloudflare Pages Functions;
- run focused unit tests;
- verify checkout cart, bump, upsell ordering, idempotency, webhook rejection, and email retry tests;
- verify desktop, tablet, and mobile routes;
- check horizontal overflow and resource errors;
- check serious and critical Axe findings;
- activate the checkout CTA without submitting a payment;
- capture fresh screenshots tied to the current build;
- verify Dodo entitlement delivery or Stripe's Resend access delivery to an address the owner controls;
- perform a test-mode purchase with the selected provider before live traffic;
- verify the exact public HTTPS URL after deployment.

A Git push is backup. It is not proof that a public deployment or payment flow works.

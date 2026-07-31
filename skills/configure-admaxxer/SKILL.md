---
name: configure-admaxxer
description: Configure, verify, or troubleshoot Admaxxer analytics for an owned funnel, including the first-party pixel, email identification, Lead events, Dodo or Stripe visitor metadata, signed revenue webhooks, Meta Conversions API, Google attribution, and an optional first-party tracking CNAME. Use when launching paid traffic, connecting Admaxxer or Meta, fixing missing attribution, or proving that leads and purchases reach the analytics platform without duplicates.
---

# Configure Admaxxer

Own the technical work. The customer should only need to approve account access, choose their public domain, and complete a no-charge or test checkout when required.

## Workflow

1. Read `PROJECT.md`, `AGENTS.md`, [references/integration.md](references/integration.md), the current Admaxxer documentation index at `https://admaxxer.com/llms.txt`, and the specific live documentation pages linked from that index. Treat the live documentation as authoritative.
2. Inspect the published hostname, Cloudflare Pages project, Admaxxer website selection, pixel status, selected payment provider and mode, existing payment webhooks, and Meta/Google integrations before changing anything.
3. Install one shared pixel through `src/components/AdmaxxerPixel.astro`. Configure it with `PUBLIC_ADMAXXER_WEBSITE_ID` and `PUBLIC_ADMAXXER_DOMAIN`; never copy a website-specific ID into a reusable source component.
4. Use only the canonical `window.admaxxer` API. Do not invent or use a legacy `window.admx` global.
5. Identify the submitted email and emit one `Lead` event only after `/api/checkout` successfully creates a valid provider checkout session. Do not emit Lead on typing, validation failure, or a failed provider request.
6. Read `window.admaxxer.getVisitorId()` on the client and send it with the checkout request. Sanitize it, store it in D1, and attach it server-side as `metadata.admx_visitor_id` on the original Dodo or Stripe payment objects and every upsell.
7. Use the selected provider's signed payment-success webhook as the authoritative Purchase/revenue event. After fulfillment succeeds, send the verified payment server-side to `POST https://admaxxer.com/api/v1/payments`. Do not add a second browser Purchase event unless current Admaxxer documentation provides an explicit shared deduplication contract.
8. Create a workspace-scoped Admaxxer key with the write scope required by the current Payments API. Store it as the private Cloudflare secret `ADMAXXER_API_KEY`; never expose it to browser code. Send the immutable Dodo payment ID or Stripe PaymentIntent ID as `transaction_id`, normalize the provider's minor-unit amount, and include `admaxxer_visitor_id` plus the verified customer email when available. Treat the transaction ID as the idempotency key.
9. Connect Meta and enable its server-side conversion destination inside Admaxxer. Verify the browser/server event pair and deduplication in Admaxxer and Meta Events Manager; do not paste a Meta access token into the funnel repository.
10. If first-party tracking is requested, use a separate tracking hostname such as `t.example.com` and follow the current CNAME documentation. Never point the storefront hostname at Admaxxer's tracking edge.
11. Update the privacy page so it truthfully describes visitor identifiers, email identification, Lead tracking, payment attribution, and the analytics provider.
12. Run repository tests, apply pending D1 migrations, publish through `$publish-cloudflare`, and verify the exact HTTPS production hostname.

## Safety and proof

- Never expose, log, commit, or repeat Dodo, Stripe, Meta, Admaxxer, or Cloudflare credentials.
- Treat the Admaxxer visitor ID as attribution metadata, never as authentication or authorization.
- Preserve same-origin checks, checkout locks, idempotency keys, payment verification, and hosted-checkout fallback. A temporary Admaxxer failure may retry the signed provider webhook only because fulfillment and Payments API ingestion are both idempotent.
- Do not make a real charge without explicit approval. Use the selected provider's test mode for end-to-end verification.
- A script tag in built HTML is not sufficient proof. Confirm a live page view, one successful Lead, non-empty `admx_visitor_id` in payment metadata, and one API-ingested Purchase attributed in Admaxxer.

## Nontechnical handoff

Report only what the customer needs: the public URL, whether page views, leads, and purchases are flowing, which ad destinations are connected, and any single account approval still required. Do not ask them to edit code, run commands, create DNS records manually, or name environment variables.

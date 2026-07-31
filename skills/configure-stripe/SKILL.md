---
name: configure-stripe
description: Configure, test, or troubleshoot Stripe for this funnel system, including hosted Checkout, product and Price registration, D1 provider mappings, card saving, off-session one-click upsells, hosted SCA fallback, signed webhooks, Resend fulfillment, Admaxxer attribution, and duplicate-charge protection. Use for Stripe setup or any change to Stripe prices, checkout sessions, PaymentIntents, webhooks, upsell decisions, or fulfillment.
---

# Configure Stripe

Treat payment setup as a low-freedom operation. Preserve provider pinning, server-side verification, and stable idempotency keys.

## Workflow

1. Read [references/safety.md](references/safety.md), `functions/_lib/stripe.ts`, `functions/_lib/products.ts`, `functions/_lib/funnel.ts`, `functions/api/checkout.ts`, `functions/api/funnel/decision.ts`, `functions/api/webhooks/stripe.ts`, and the D1 migrations.
2. Fetch Stripe's current documentation index at `https://docs.stripe.com/llms.txt`, then read the current hosted Checkout save-during-payment, Checkout Session create, PaymentIntent create, and webhook signature pages. Treat those pages as authoritative.
3. Confirm the exact test or live mode, product names, one-time prices, currencies, return paths, bump default, upsell order, refund policy, and real customer-access URLs. Require Resend because Stripe has no native digital-file entitlement.
4. Collect credentials through the private setup screen. Never commit, log, echo, or pass a secret as a command argument.
5. Apply pending D1 migrations and run `npm run setup:stripe`. Let the setup script create or reuse Products, Prices, and the required webhook idempotently, then read the mappings back. Do not bypass its refusal of Dodo customer-portal access URLs.
6. Keep the base payment on hosted card-only Checkout. Create a Stripe Customer, set `payment_intent_data[setup_future_usage]=off_session`, and attach funnel plus Admaxxer metadata to both the Checkout Session and PaymentIntent.
7. Charge eligible upsells with a server-created PaymentIntent using the saved customer and payment method, `confirm=true`, `off_session=true`, `error_on_requires_action=true`, and an idempotency key scoped to funnel and step.
8. On a missing method, decline, or authentication requirement, open a new hosted Checkout Session. Reuse the same customer, save the replacement card, retain the checkout URL for duplicate requests, and never loop an automatic charge.
9. Pin the provider on each lead and funnel row. Never let a later site setting switch an in-progress Dodo funnel to Stripe or the reverse.
10. Verify the raw webhook body, timestamp tolerance, mode, and Stripe signature before changing state. Deduplicate events durably, fulfill through Resend, and send Admaxxer revenue only from verified payment success.
11. Run function tests, type checks, a Workers Functions build, and local D1 migrations. Test invalid signatures, stale signatures, repeated accepts, fallback checkout, duplicate events, and missing Resend without making a live charge.
12. Run `$audit-funnel` before publishing. A live paid test requires explicit approval of the amount and refund handling.

## Handoff

Tell the owner which mode is connected, whether all Products and Prices are mapped, whether the webhook and Resend are verified, and which no-charge tests passed. Do not expose IDs or secrets unless an exact non-secret identifier is necessary for troubleshooting.

---
name: configure-dodo
description: Configure, generalize, test, or troubleshoot Dodo Payments for this funnel system, including inline checkout, pre-checkout email capture, a one-time order bump, up to two one-click upsells, product registration, D1 funnel state, saved-payment charging, and secure fallback checkout. Use for payment setup or any change that could affect prices, product IDs, checkout, upsell decisions, or duplicate-charge protection.
---

# Configure Dodo

Treat payment work as a low-freedom operation. Preserve the golden implementation and prove each mutation with readback.

## Workflow

1. Read [references/safety.md](references/safety.md), `functions/_lib/products.ts`, `functions/_lib/funnel.ts`, `functions/api/checkout.ts`, `functions/api/funnel/decision.ts`, and the D1 migrations.
2. Compare the requested funnel with the tagged `funnel-v1-golden` behavior before changing shared payment code.
3. Confirm product names, exact prices, currency, tax posture, refund policy, bump default, upsell sequence, and return paths from authoritative offer data.
4. Use server-side provider calls and secret storage. Never place an API key or authoritative product ID in browser content or committed offer copy.
5. Create or reuse products idempotently and store their provider IDs in the generic product registry.
6. Model a one-time bump as a second cart line. Leave it unselected.
7. Reuse the verified customer and eligible saved payment method for one-click upsells; retain secure hosted-checkout fallback.
8. Preserve opaque hashed flow tokens, same-origin checks, provider response validation, server-side locks, idempotency keys, and payment-status verification.
9. Verify created products by reading them back. Test declined and no-charge paths. Do not make a real charge without explicit approval.
10. Run `$audit-funnel` before publishing.

## Buyer communication

Ask only for prices, product names, policies, and account approval. Handle IDs, API calls, migrations, bindings, and verification yourself. Never display or repeat a secret after it is supplied.

# Stripe funnel safety contract

## State sequence

1. Capture email, consent, attribution, bump choice, provider, and a hashed flow token.
2. Create hosted Checkout with a new Customer and off-session card-saving intent.
3. Verify the paid Checkout Session or PaymentIntent before exposing chargeable upsells.
4. Persist the verified Customer and PaymentMethod on the provider-pinned funnel.
5. Move one upsell from offered or failed to charging through one D1 lock.
6. Attempt one idempotent off-session PaymentIntent.
7. If customer action or a new card is needed, persist one hosted fallback Checkout URL.
8. Mark accepted and fulfill only from verified payment success.

## Required checks

- The displayed amount, D1 mapping, and active Stripe Price agree.
- The bump is unselected and adds exactly one Checkout line item.
- Checkout creates or attaches a Customer and saves a card for off-session use.
- Session and PaymentIntent metadata both contain the funnel, lead, product, and attribution identity.
- Repeated accepts reuse the same PaymentIntent idempotency key or stored Checkout URL.
- Declines, SCA, and missing methods open hosted Checkout instead of retrying automatically.
- Checkout URLs are HTTPS on `checkout.stripe.com`.
- Webhooks use the unchanged raw body, a current `Stripe-Signature`, matching live mode, and a durable event key.
- Stripe payments cannot start without a verified Postmark configuration and real access URL.
- Logs omit secret keys, webhook secrets, flow tokens, card details, and full webhook payloads.

Use test mode and fixtures by default. Never create a live PaymentIntent or Checkout Session without the owner's explicit approval.

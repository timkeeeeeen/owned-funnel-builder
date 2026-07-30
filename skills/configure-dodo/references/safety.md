# Dodo funnel safety contract

## Proven state sequence

1. Capture email, consent version, attribution, bump choice, and checkout session.
2. Hash the opaque flow token before storing it.
3. Verify the core checkout and payment server-side before showing a chargeable upsell.
4. Allow an upsell to move from offered or failed to charging through one database lock.
5. Send an idempotency key scoped to funnel and upsell.
6. Mark accepted only after provider payment verification.
7. Make decline visible, easy, and final.
8. Proceed to the next offer or completion page without loops.

## Required checks

- Page price, configured amount, and provider product agree.
- The bump is not preselected and is visibly optional.
- A bump adds exactly one product-cart line.
- Repeated accept requests cannot create repeated charges.
- A missing reusable payment method opens secure standard checkout.
- Unknown provider URLs are rejected.
- Failed or cancelled payments never become purchases.
- Logs omit API keys, raw flow tokens, and sensitive payment data.

Use sandbox or no-charge verification by default. A live paid test requires the user's explicit approval of the amount and refund handling.

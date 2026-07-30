# Funnel audit checklist

## Offer and copy

- One clear promise, offer, price, and primary action.
- Real proof only; no unresolved placeholders or fabricated urgency.
- Buyer fit, prerequisites, delivery, guarantee, and support are explicit.
- Page, checkout, bump, upsells, completion, and email agree.

## Visual and interaction

- First fold communicates promise, product, price, and action.
- Buttons are large, high contrast, specific, and easy to tap.
- Mobile is intentionally recomposed with no horizontal overflow.
- Checkout fields and wallet controls have comfortable spacing.
- Bump is optional and unselected; decline links are visible.
- Loading, error, retry, disabled, and success states are understandable.

## Technical

- Format, lint, typecheck, build, Functions build, accessibility, and KPI checks pass where configured.
- No browser errors, failed assets, broken links, stale screenshots, or secret leakage.
- Prices and product IDs match verified provider state.
- Flow tokens are opaque and hashed; API requests are same-origin and validated.
- Duplicate accept requests cannot duplicate charges.
- Fulfillment uses verified payment truth and durable idempotency.

## Production

- GitHub contains the exact deployed commit.
- Cloudflare stable URL serves that commit and every required route.
- D1 migrations and bindings are present without altering real records.
- Checkout is enabled; it has not fallen back to email contact.
- Real paid paths are marked unverified unless an authorized charge proved them.

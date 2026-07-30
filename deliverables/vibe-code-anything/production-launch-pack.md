# Production Launch Pack

Use this as a decision and verification guide. It does not contain credentials and does not pretend a provider is connected before it is tested.

## Authentication

Choose who owns identity, how workspaces are created, and what happens when a user loses access. Verify sign-in, sign-out, expired sessions, wrong-workspace denial, invitations, and account recovery.

## Billing

Define products, prices, tax category, refunds, payment truth, entitlements, and webhook idempotency. Test success, cancel, failure, duplicate events, bump totals, upsell accept, upsell decline, and access delivery in sandbox mode.

## Transactional email

Verify the sending domain, From and Reply-To identity, support address, unsubscribe posture, retries, idempotency, and useful plain-text content. Send to an address you control before launch.

## Storage

Classify public assets, private customer uploads, exports, and backups. Verify authorization at read time, upload limits, content type, retention, deletion, and restore behavior.

## Analytics and errors

Record the conversion events needed to answer a business question. Strip secrets and unnecessary personal data. Confirm exceptions include a traceable request identifier and a useful release version.

## Deployment

Use separate preview and production configuration. Apply migrations without deleting real data. Verify the exact commit, public route, assets, functions, environment bindings, HTTPS, and rollback target.

## Final launch receipt

- Product and buyer outcome
- Exact source commit
- Production URL
- Provider accounts and owners
- Database migrations applied
- Payment test evidence
- Email delivery evidence
- Privacy and tenant checks
- Desktop and mobile checks
- Known limitations
- Rollback target


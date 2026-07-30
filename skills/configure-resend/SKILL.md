---
name: configure-resend
description: Configure or troubleshoot Resend fulfillment for paid funnels, including sender-domain verification, secret storage, purchase and access emails, bump and upsell entitlements, idempotent webhook-driven delivery, test messages, and delivery-status recording. Use when buyers need product access or transactional email after Dodo payment.
---

# Configure Resend

Keep fulfillment narrow, reliable, and separate from payment receipts.

## Workflow

1. Read [references/delivery.md](references/delivery.md) and inspect the current payment verification, webhook, entitlement, and email implementation.
2. Confirm the sender name, sender domain, reply-to address, support address, delivery promise, and files or access links.
3. Guide the user through account or DNS approval in plain English. Perform technical configuration and verification yourself.
4. Store the API key as a Cloudflare secret. Never commit, log, or repeat it.
5. Send fulfillment only from verified provider events or verified payment state, never from the browser redirect alone.
6. Derive core, bump, and upsell entitlements from verified purchases.
7. Use stable event or payment identifiers for idempotency and record delivery status before retrying.
8. Escape untrusted content and keep the plain-text version useful.
9. Send a test message, verify receipt with the user if necessary, then test one no-charge or sandbox fulfillment path.

## Scope

Implement product confirmation, access delivery, support details, and relevant add-on access. Let Dodo issue payment receipts. Do not turn the funnel repository into a marketing automation platform.

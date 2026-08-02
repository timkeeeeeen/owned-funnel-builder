---
name: configure-email
description: Configure or troubleshoot provider-neutral Postmark email for purchase fulfillment and simple broadcasts to explicitly opted-in funnel subscribers, including sender verification, secret storage, templates, message streams, webhooks, unsubscribe, idempotency, safe tests, and delivery status.
---

# Configure Email

Keep transactional fulfillment reliable and marketing email simple, consented,
and separate.

## Workflow

1. Read [references/delivery.md](references/delivery.md) and inspect the current payment, consent, suppression, campaign, webhook, and email implementation.
2. Confirm the sender name, verified domain, transactional From, marketing From, reply-to, support address, physical postal address, and purchase access links.
3. Configure Postmark's `outbound` Message Stream for transactional mail and `broadcast` for marketing. Never mix them.
4. Store the server token and generated webhook/operator/unsubscribe secrets through the private local setup screen. Never print or commit them.
5. Create the `purchase-access` and `simple-broadcast` templates with useful HTML and plain text. Use stable aliases.
6. Send fulfillment only from verified provider payment state. Keep `fulfillment:{paymentId}:{productKey}` idempotent.
7. Send broadcasts only through `npm run email:send`; it rechecks explicit consent and suppression before dispatch.
8. Configure authenticated Postmark webhooks for bounces, spam complaints, deliveries, and subscription changes.
9. Use `POSTMARK_API_TEST`, a sandbox server, the black-hole address, and Postmark bounce-test addresses before real delivery.
10. Verify SPF, DKIM, and DMARC, then warm a new broadcast domain gradually.

## Scope

Implement product access delivery and one-off updates to opted-in funnel people.
Do not add drip automation, a CRM, purchased-list imports, or a public campaign
dashboard.

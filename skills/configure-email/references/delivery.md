# Email delivery contract

## Purchase truth

- Trust a verified Dodo or Stripe webhook, or a server-side payment lookup tied to the recorded provider.
- Ignore duplicate events through a durable payment/product key.
- Never grant access because a visitor reached a success URL.
- Require Postmark before enabling Stripe; Dodo native entitlements may operate without application email.

## Marketing truth

- Require an unchecked, explicit opt-in and retain its version, wording, source, and timestamp.
- Query only subscribed addresses with no local suppression immediately before sending.
- Use the `broadcast` stream, a physical postal address, and signed unsubscribe links.
- Suppress hard bounces, spam complaints, and unsubscribes immediately.

## Operations

- Record pending, accepted, transient-failure, and permanent-failure states per recipient.
- Retry transient failures without resending accepted recipients.
- Log provider message identifiers, not tokens, addresses, or message content.
- Keep payment receipt language out of purchase-access email unless verified and necessary.

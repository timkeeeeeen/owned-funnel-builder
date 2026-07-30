# Fulfillment contract

## Purchase truth

- Trust a verified Dodo webhook or server-side payment lookup.
- Verify webhook authenticity before parsing entitlements.
- Ignore duplicate events through a durable unique event or payment key.
- Never grant access merely because a visitor reached a success URL.

## Email contents

- State what was purchased.
- Put the access link or download action near the top.
- Include bump and accepted-upsell access separately when applicable.
- State support contact and expected response path.
- Include an honest fallback when access needs manual review.

## Operations

- Record pending, sent, and failed delivery states.
- Retry transient failures without creating duplicate email bursts.
- Log provider request identifiers, not secrets or full personal content.
- Keep payment receipt language out of the fulfillment email unless it is verified and necessary.

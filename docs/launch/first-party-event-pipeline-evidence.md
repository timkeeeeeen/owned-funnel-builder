# First-Party Event Pipeline Authority Evidence

Recorded 2026-08-04 from the clean `codex/first-party-event-pipeline` worktree
at `ca35d223f333d06ee662e809a526e8283780882e`. This is a source-contract
inventory, not provider provisioning or a deployment readback. Any field marked
`UNVERIFIED` blocks activation for that funnel.

<!-- authority-catalog
{
  "eventNames": ["PageView", "Lead", "InitiateCheckout", "Purchase"],
  "pagesProductKeys": ["owned-funnel-builder", "talking-head-ad-machine", "vibe-code-anything"],
  "blueprintClientPaths": ["capabilities/billing/blueprintCheckoutStarts:start", "capabilities/billing/blueprintPurchases:getCheckoutStatus"],
  "noStripeForLaunch": true,
  "rows": [
    {"environment":"preview/live","funnel":"Owned Funnel Builder","publicRoute":"/owned-funnel-builder/","sourceSystem":"pages","checkoutOwner":"Pages","paymentOwner":"pages","fulfillmentOwner":"Pages/Dodo","dodoProductId":"owned-funnel-builder","baseSha":"ca35d223f333d06ee662e809a526e8283780882e","status":"unverified"},
    {"environment":"preview/live","funnel":"Talking Head Video VBuilder","publicRoute":"/talking-head-ad-machine/","sourceSystem":"pages","checkoutOwner":"Pages","paymentOwner":"pages","fulfillmentOwner":"Pages/Dodo","dodoProductId":"talking-head-ad-machine","baseSha":"ca35d223f333d06ee662e809a526e8283780882e","status":"unverified"},
    {"environment":"preview/live","funnel":"Vibe Code Anything","publicRoute":"/vibe-code-anything/","sourceSystem":"pages","checkoutOwner":"Pages","paymentOwner":"pages","fulfillmentOwner":"Pages/Dodo","dodoProductId":"vibe-code-anything","baseSha":"ca35d223f333d06ee662e809a526e8283780882e","status":"unverified"},
    {"environment":"preview/live","funnel":"App-Idea Evaluator","publicRoute":"ROUTE_UNVERIFIED","sourceSystem":"app_idea","checkoutOwner":"RUNTIME_UNVERIFIED","paymentOwner":"RUNTIME_UNVERIFIED","fulfillmentOwner":"RUNTIME_UNVERIFIED","dodoProductId":"UNVERIFIED","baseSha":"UNVERIFIED","status":"unverified"},
    {"environment":"preview/live","funnel":"Maestro $5 Blueprint","publicRoute":"/authority-snapshot/AUDIENCE","sourceSystem":"blueprint","checkoutOwner":"RUNTIME_UNVERIFIED","paymentOwner":"RUNTIME_UNVERIFIED","fulfillmentOwner":"RUNTIME_UNVERIFIED","dodoProductId":"UNVERIFIED","baseSha":"UNVERIFIED","status":"unverified"}
  ]
}
-->

| Environment | Funnel | Public route | Source system | Checkout owner | Payment/webhook owner | Fulfillment owner | Dodo product ID/key | Base SHA | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| preview/live | Owned Funnel Builder | /owned-funnel-builder/ | pages | Pages | Pages | Pages/Dodo | owned-funnel-builder | ca35d223f333d06ee662e809a526e8283780882e | unverified |
| preview/live | Talking Head Video VBuilder | /talking-head-ad-machine/ | pages | Pages | Pages | Pages/Dodo | talking-head-ad-machine | ca35d223f333d06ee662e809a526e8283780882e | unverified |
| preview/live | Vibe Code Anything | /vibe-code-anything/ | pages | Pages | Pages | Pages/Dodo | vibe-code-anything | ca35d223f333d06ee662e809a526e8283780882e | unverified |
| preview/live | App-Idea Evaluator | ROUTE_UNVERIFIED | app_idea | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | UNVERIFIED | UNVERIFIED | unverified |
| preview/live | Maestro $5 Blueprint | /authority-snapshot/AUDIENCE | blueprint | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | UNVERIFIED | UNVERIFIED | unverified |

## Observed local contracts

| Funnel | Source repository / clean base | Runtime | Payment provider | Webhook owner | Fulfillment owner |
| --- | --- | --- | --- | --- | --- |
| Owned Funnel Builder | Owned Funnel Builder, `codex/first-party-event-pipeline`, `ca35d223f333d06ee662e809a526e8283780882e` | Cloudflare Pages Functions | Dodo | `functions/api/webhooks/dodo.ts` | Pages/Dodo |
| Talking Head Video VBuilder | Owned Funnel Builder, `codex/first-party-event-pipeline`, `ca35d223f333d06ee662e809a526e8283780882e` | Cloudflare Pages Functions | Dodo | `functions/api/webhooks/dodo.ts` | Pages/Dodo |
| Vibe Code Anything | Owned Funnel Builder, `codex/first-party-event-pipeline`, `ca35d223f333d06ee662e809a526e8283780882e` | Cloudflare Pages Functions | Dodo | `functions/api/webhooks/dodo.ts` | Pages/Dodo |
| App-Idea Evaluator | REPOSITORY_UNVERIFIED | RUNTIME_UNVERIFIED | PROVIDER_UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED |
| Maestro $5 Blueprint | Deployed contract only; source/deployed base UNVERIFIED | Convex contract referenced by client; deployment UNVERIFIED | Dodo metadata UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED |

- `functions/_generated/funnels.ts` supplies the three Pages product keys above;
  `functions/api/checkout.ts` creates their Dodo checkout; and
  `functions/api/webhooks/dodo.ts` owns their verified webhook processing and
  fulfillment handoff.
- `src/scripts/blueprint-funnel-client.ts` references
  `capabilities/billing/blueprintCheckoutStarts:start` and
  `capabilities/billing/blueprintPurchases:getCheckoutStatus`. Its commercial
  runtime, Dodo product ID, webhook owner, fulfillment owner, and deployed base
  are not present locally and remain unverified.
- No App-Idea checkout/status source module or deployed contract is present in
  this repository. Its route, runtime, Dodo product ID, webhook/fulfillment
  owner, and base remain unverified; no path was inferred.
- Launch uses Dodo only. Stripe is not a launch payment owner.

## DNS and cookie trust boundary

| Scope | DNS/readback evidence | Owner | TLS/deployment | Takeover risk | Cookie trust |
| --- | --- | --- | --- | --- | --- |
| `*.shop.maestrogtm.com` | UNVERIFIED: no authoritative Cloudflare zone enumeration or hostname readback was captured in this task | UNVERIFIED | UNVERIFIED | UNVERIFIED | **blocked** |

The design requires `events.shop.maestrogtm.com` and parent-domain cookies for
`shop.maestrogtm.com`; it does not prove the complete sibling inventory. Do not
set parent-domain cookies until an authoritative DNS/TLS/deployment readback
lists every sibling and confirms each is owned, non-dangling, and hardened.

## Task 8 context-exchange prerequisite

The Worker accepts only the canonical `X-Maestro-*` signed bridge contract
(`v1`, timestamp, 32-byte base64url nonce, and body hash). Source envelopes
carry a Worker-minted, expiring `context_hash` and signed privacy snapshot;
raw `buyer_context`, bearer tokens, and legacy `x-tracking-*` headers are
rejected. Context exchanges are stored in tracking D1 and resolved within
tenant/site/funnel scope. App-Idea and Blueprint remain shadow-only until
their exact owners, products, SHAs, and token-verifier bindings are recorded.

## Task 9 deployment controls

Product ownership, provider capability, resource, and CI-authority readbacks
remain unverified. No repository-local Woodpecker pipeline is created while
`ci_authority` is unknown. Pages/Worker publishing, preview provisioning, and
migration commands are dry-run by default and reject mutation without both
`--execute` and `--approval-id`.

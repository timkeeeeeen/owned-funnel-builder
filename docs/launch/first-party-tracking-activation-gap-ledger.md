# First-Party Tracking Activation Gap Ledger

The read-only baseline was captured at `2026-08-14T17:53:00Z` from
`origin/main` `17d0b3d266ab0366be30d1612d2e41d03e35e5ee`; PR #6 merged as
`ad2f72684af8056cf21c26d5d9e791c6fdd537a8`. The owner subsequently approved
preview-only activation. Evidence below names resources and secret bindings,
never secret values. Production, destinations, Dodo, campaigns, canaries,
cards, charges, and live traffic remain outside that approval.

Status rule: `verified blocked` means the readback conclusively found a missing
or unsafe prerequisite. `unverified` means the available credential or API did
not permit a safe readback. Neither status permits activation.

## Preview activation evidence

Runtime/source SHA: `161e4b1ee6c5e2c7f71b6de35c8a80dc098928eb`.
Migration-set SHA:
`78b81e1bb4519c3277dbd318b7ccd102b220b29c23e6c4b02babe3270c81c9e5`.

| Scope | Verified evidence |
| --- | --- |
| Preview CI guardrails | GitHub environment `tracking-preview` accepts only branch `main`. It contains secret bindings `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `TRACKING_CONTEXT_SIGNING_KEY_CURRENT`, `TRACKING_PAGES_BRIDGE_KEY_CURRENT`, and `TRACKING_PREVIEW_PROOF_TOKEN`, plus `TRACKING_MIGRATION_SET_SHA`. Cloudflare token `owned-funnel-tracking-preview-ci` (`914b52a9f5afbaada9a57e237c1c13b9`) has only the required account-level Workers Scripts, D1, Queues, and Pages permissions plus Worker Routes for the `maestrogtm.com` zone. The workflow and preview contract restrict named resources, but the provider credential is not resource-isolated from production-capable account resources. A dedicated provider boundary and authoritative required CI gate remain mandatory production blockers. |
| Events Worker | `maestro-first-party-events` is deployed at version `2ca9cae8-6fee-455c-b765-acdf5d390689`. It has only the three expected secret names, preview D1/Queue/DLQ bindings, preview variables, and a sender manifest with Meta and Tinybird `false`. `https://events-preview.shop.maestrogtm.com/healthz` returns HTTP 200 with valid TLS. |
| Tracking D1 | `maestro-tracking-preview` (`6a1e98a6-7d32-4b16-bdce-f7078ecc481d`) has no pending migrations. Release state is `ready` for the exact runtime and migration-set SHAs. Ingress capability hash `3908741f5b332d5f68e51322d287e58456deb723155f87517e7b2d8451f0f2b0` is verified until `2026-08-16T17:27:54.511Z`. |
| Queue and DLQ | `maestro-events-preview` (`32c379a9b0bf4ffab3ecfa2ee3f6fab0`) and `maestro-events-preview-dlq` (`3f21c599adfa4bf3863e3d4393deaba4`) each have one expected producer and consumer. |
| Pages preview | `owned-funnel-builder-preview` D1 (`fd9f29b7-3b15-4655-a72c-f2fe73e54c24`) has no pending migrations. Preview deployment `27d5eea3-c69b-4b3d-a505-5eff232c8ad0` serves exact source `161e4b1` at `https://tracking-preview.owned-funnel-builder.pages.dev`. Preview bindings are only `LEADS`, `TRACKING_SOURCE_BRIDGE`, the expected preview variables, and two secret names. The alias returns HTTP 200 with valid TLS; its proof endpoint rejects an unauthenticated POST with HTTP 401. |
| Signed event proof | Worker D1 contains exact `PageView` `pageview_f89c0727-036f-477e-bfdc-ba9dfe1c98b9`, `Lead` `lead_preview_bc06af45-9b4a-4e12-a6c8-b74d1c8fcf31`, and `InitiateCheckout` `checkout_preview_859f24ec-ebce-4088-a587-bd4d06b69cc3`. Pages D1 shows the two source events delivered through the bridge in one attempt, accepted, and payload-redacted. The preview payment gate rejected Purchase, and `tracking_deliveries` contains zero rows. |

## Pre-activation gap baseline (historical)

| Scope | Status | Verified evidence | Required next action |
| --- | --- | --- | --- |
| Live Pages source SHA | verified blocked | Cloudflare Pages production serves `9bd0460206562f10a04feca60f44376594d212fb`. It diverged before PR #6 and from current `origin/main`; the deployed `/api/tracking/source-browser-events` and `/api/funnel/browser-events` routes return `404`. | Review and deploy an exact approved source SHA after the tracking infrastructure and source binding are ready. |
| Events Worker | verified blocked | Both configured names, `maestro-first-party-events` and `maestro-first-party-events-live`, return Cloudflare `10007` / not found. No deployment exists. | Provision preview first, replace reviewed release bindings, then deploy only with an approval ID. |
| Tracking D1 | verified blocked | Neither `maestro-tracking-preview` nor `maestro-tracking-live` exists. The committed Worker configuration still contains placeholder database IDs and release hashes. | Create isolated preview/live databases and apply the reviewed Worker migrations in lexical order under the release-state lock. |
| Pages D1 source migrations | verified blocked | Production `LEADS` is bound to the expected business database, but remote migrations stop at `0009_email_campaigns.sql`. The source-tracking migrations `0010` through both `0012` files and their tables are absent. | Back up and apply the missing business-D1 source migrations only after exact-SHA approval. |
| Queue and DLQ | verified blocked | `maestro-events-preview`, `maestro-events-preview-dlq`, `maestro-events-live`, and `maestro-events-live-dlq` do not exist. No configured producer or consumer was found. | Provision isolated preview resources, verify consumer/DLQ settings, then repeat for live after preview proof. |
| Worker bindings and senders | verified blocked | No Worker exists to hold secrets or bindings. Committed sender manifests keep Meta and Tinybird `false`, and release/migration hashes are placeholders. Pages has only `LEADS`; it has no tracking service binding or source-bridge binding. | Bind preview resources and secret names, retain senders off, and verify `/healthz` before any destination is enabled. |
| DNS and TLS | verified blocked | `shop.maestrogtm.com` is an active proxied Pages CNAME with valid TLS. `events.shop.maestrogtm.com` has no DNS record, no TLS endpoint, and no `/healthz`. | After the preview Worker exists, attach the approved tracking hostname and verify DNS, certificate, ownership, and sibling-domain safety. |
| Cloudflare operator credential | verified blocked | The account-owned token is active and can read the required resources, but its `staging` policy grants broad account and zone write permissions, including Workers, D1, Queues, Pages, DNS, and security controls. | Replace routine activation access with a least-privilege, environment-scoped operator/deploy token before production use. |
| Tinybird | verified blocked | The configured token is an administrator token. Readback succeeds, but the workspace contains three unrelated datasources and five unrelated pipes; `first_party_events`, `privacy_tombstones`, `first_party_events_dedup`, and `privacy_tombstone_filter` are absent. | Provision the reviewed Tinybird schema, then issue a destination-specific append token instead of using the admin token. |
| Meta | unverified | No Meta destination binding exists because the Events Worker is absent. No safely retrievable Meta credential was available in this session, so dataset ownership and token scopes were not queried. | Unlock or connect the approved secret store for a read-only dataset/system-user capability check; do not paste or commit a token. |
| Dodo ownership | partial / unverified provider | Production D1 contains the eleven expected Pages product mappings and historical Dodo webhook/fulfillment records. The Dodo secret is present by binding name only; provider-side product ownership, live prices, entitlements, webhook URL/events, and token capability remain unverified. Blueprint and App-Idea products are absent from the ownership manifest. | Connect a readable Dodo live credential through the approved secret store and perform catalog/webhook readbacks only. |
| Pages source runtime | verified blocked | Current production has no PR #6 source routes, no source-outbox tables, and no Worker service binding. `config/source-runtime-manifest.json` correctly remains `shadow`. | Complete preview infrastructure, migrate Pages D1, bind the source bridge, deploy an exact SHA, and prove signed PageView/Lead/InitiateCheckout/Purchase flow before pilot. |
| Blueprint source runtime | verified blocked | `blueprint.maestrogtm.com` maps to `maestro-blueprint-production`, whose only Cloudflare binding is `ASSETS`; no first-party source bridge or tracking binding is present. | Identify and review the authoritative Blueprint source/runtime before adding a signed bridge. |
| App-Idea source runtime | verified blocked | No production App-Idea runtime with a first-party source binding was identified in the owned-funnel authority. Existing Maestro web/brain Worker readbacks contain no tracking bridge binding. | Record its exact repository, production route, runtime, payment owner, and release SHA before integration. |
| CI authority | verified blocked | GitHub reports no repository ruleset, no `main` branch protection, and no check runs on current `main`. PR #6 and PR #12 expose CodeRabbit review only. The configured Woodpecker required status therefore remains unverified. | Establish the repository-authoritative required check before any deployment script is allowed to execute. |
| Canary and campaigns | intentionally blocked | Every row in `config/five-funnel-canary-matrix.json` remains shadow with blank approval and payment evidence. | Keep campaigns absent/paused. Live `$1` canaries require a separate explicit approval and owner-entered card after preview activation is proven. |

## Safe readbacks completed

- Cloudflare account-token status and redacted permission categories.
- Zone, DNS, Workers/custom domains, Pages project/deployments/bindings, D1,
  Queues, and DLQ inventory.
- Public DNS, TLS, `/healthz`, and non-mutating route probes.
- Business-D1 table/migration names, redacted product mappings, and aggregate
  webhook/fulfillment states; no customer or payload data was read.
- Tinybird token scope names and resource-name inventory.
- GitHub exact SHAs, ancestry, rulesets, branch protection, and check records.

Meta and Dodo provider capability readbacks remain unverified because their
secret values are not readable from Cloudflare and the local Bitwarden vault is
locked. No secret from chat history was copied into a command, file, or log.

## Remaining production approval gate

Preview activation is bounded and proven; it does not authorize production.
Any next activation needs a new exact-SHA owner approval covering the specific
production D1, Queue/DLQ, Worker, hostname, Pages migrations/binding, and source
deployment. Meta and Tinybird also require safe provider capability readback,
destination-specific credentials, an explicit sender-enablement approval, and
fresh zero-delivery/rollback evidence. Dodo, campaigns, live `$1` canaries,
cards, charges, and live traffic remain separate gates. The 24-hour ingress
capability evidence must be refreshed before relying on it for a later release.

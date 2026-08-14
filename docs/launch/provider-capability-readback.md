# Provider capability readback

Read-only audit captured `2026-08-14T17:53:00Z` against current `origin/main`
`17d0b3d266ab0366be30d1612d2e41d03e35e5ee`. Secret values and unrestricted
provider responses were not printed or retained.

| Provider | Readback | Result | Activation state |
| --- | --- | --- | --- |
| Tinybird | The configured JWT authenticated successfully and exposed `ADMIN` / `ADMIN_USER` scopes. Datasource and pipe inventory was readable. | The workspace has three unrelated datasources and five unrelated pipes. The two committed first-party datasources and two committed pipes do not exist. The token is too broad for an append-only sender. | disabled / verified blocked |
| Meta | No Events Worker or Meta binding exists. No safely retrievable Meta credential was available for dataset or system-user permission readback. | Dataset ownership, token scopes, and CAPI capability remain unverified. | disabled / unverified |

Cloudflare infrastructure evidence, Dodo ownership limits, source-runtime
gates, and the exact next approval boundary are recorded in
[`first-party-tracking-activation-gap-ledger.md`](./first-party-tracking-activation-gap-ledger.md).
`config/provider-capabilities.json` correctly remains fail-closed: both
destinations are disabled and no readback is marked verified.

# First-Party Event Pipeline Fresh Review

Date: 2026-08-04  
Reviewers: independent security/privacy and delivery/operations passes

## Verdict

The architecture is viable, but the spec and plan needed stronger launch
controls at the trust, schema, and recovery boundaries. The changes below make
those controls executable without expanding the v1 destination scope.

## Findings and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| Important | Parent-domain cookies make every sibling host a trust boundary; an inventory alone does not prevent takeover or drift. | Launch now requires DNS/TLS/CNAME ownership evidence, HSTS, no user-content sibling, and continuous drift monitoring before cookie issuance. |
| Important | Privacy behavior and US/GPC/LDU handling were policy prose, not a machine-checkable approval. | Add versioned field/privacy policy artifacts, named legal owner approval, and Meta LDU/data-processing handling where applicable. |
| Critical | Tinybird/Meta deletion capability and tombstone lifetime were conditional. | Add provider capability readback, per-destination deadlines, residual-retention status, and non-expiring tombstones through the maximum replay/backup window. |
| Critical | Duplicate IDs could accept a changed payload; leases could be overwritten after expiry. | Add canonical payload hashes, mismatch quarantine, and fenced lease owner/token checks to every completion path. |
| Important | Source outbox recovery, destination retry ceilings, and cross-repository SHA compatibility were underspecified. | Define source/destination state machines, bounded backoff/age, source DLQ/runbook, and deploy-time repo/SHA/contract/CI assertions. |
| Important | The four implementation canaries did not explicitly prove all five funnel rows. | Require a machine-readable funnel × product × stage evidence matrix, with equivalence evidence where an implementation is shared. |
| Minor | Token transport, click-ID retention, normalization vectors, edge rate limiting, and browser deletion were not explicit enough. | Add query-string prohibition, field TTL/source rules, normalization fixtures, edge-enforced ceilings, and exact cookie deletion before DSAR completion. |

## Deliberate simplifications retained

- No arbitrary DOM/keystroke capture, fingerprinting, anonymous CRM fabrication,
  generic destination framework, or resolver integration in v1.
- Tinybird remains an analytics projection; D1 remains the delivery authority.
- The practical browser lifetime remains 400 days; durable continuity requires
  a verified identity claim.

## Launch blockers

No provider, DNS, ad, or live-payment mutation is authorized until the new
evidence artifacts and exact-SHA gates are green. A funnel can launch
independently, but an absent source-runtime contract, privacy approval,
provider-deletion readback, or canary row blocks that funnel.

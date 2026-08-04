# First-Party Event Pipeline Contract Review

Date: 2026-08-04  
Reviewers: canonical-contract reviewer, browser/source reviewer, Worker/operations reviewer

## Verdict

Reject the current implementation checkpoint. The architecture remains sound,
but the canonical contract and destination projection are not yet safe to
implement as written. The plan is approved only after the blocking contract
changes below are made and their focused tests pass.

## Findings

| Priority | Finding | Required change |
| --- | --- | --- |
| Critical | The shared `safeString` path accepts phone-like values when `allowPhoneLike` is enabled for identifiers. A raw phone number can therefore become an `event_id`, visitor ID, or commerce identifier and persist into event/destination data. | Use field-specific validators. IDs accept only the opaque UUID/ULID-like grammar; phone is accepted only in the explicit identity-phone field after country-aware E.164 validation. Add raw-phone rejection tests for event IDs, visitor IDs, session IDs, content IDs, and payment/order IDs. |
| Important | Meta projection is not discriminated by `event_name`; a `PageView` can carry purchase-only custom data. | Define an event-name union with separate `custom_data` schemas. PageView permits no commerce fields; Lead permits only lead fields; InitiateCheckout permits checkout/value fields; Purchase requires the allowed payment/order/value/content fields. Unknown and cross-event fields fail closed. |
| Important | The projection contract uses/has used `event_source_path` while the design requires verified `event_source_url`. | Make `event_source_url` the sole canonical and Meta field, validate it against the trusted-host/path allowlist, and reject the old name. |
| Important | Purchase projection omits required commerce identifiers and quantity fields. | Include `order_id`, `payment_id`, `value`, `currency`, `content_ids`, `contents`, `content_type`, `quantity`, and `num_items` where present and policy-permitted; validate non-negative integer quantities and positive major-unit value. |
| Minor | Numeric and timestamp validation is lax. Fractional `event_time`, negative quantities, arbitrary currency strings, and envelope/provider time drift can pass. | Require integer Unix-second `event_time`, ISO-8601 `occurred_at`, a bounded event-time skew, three-letter ISO currency, non-negative integer quantities, and a positive finite value. |
| Minor | The plan's Task 2 SQL examples still show global keys and no `payload_hash`, while later text requires scoped keys, hash conflict quarantine, and fenced leases. | Replace the examples with the hardened schema contract; require migration tests to prove row-preserving rebuild, scoped uniqueness, hash mismatch quarantine, and lease fencing before Worker traffic. |
| Important | The Blueprint browser proxy can be wired before its deployed token verifier/issuer contract exists. | Pin `BLUEPRINT_CONTEXT_TOKEN_VERIFY`, issuer/audience/nonce/expiry/signature rules, and the exact Convex contract in the source manifest; keep the proxy shadow-only until present. |
| Minor | The repository currently has no confirmed Playwright preview harness. | Do not claim end-to-end preview browser evidence; use committed browser contract tests and record the missing harness as a launch gap until a host fixture exists. |
| Minor | Consent-gated browser Purchase claims and source-outbox CAPI are intentionally separate, but the distinction can be mistaken for missing Purchase tracking. | Document that denied advertising consent suppresses the browser Pixel while the source-authoritative CAPI path still follows the privacy policy and canonical outbox decision. |
| Important | The Worker migration, kill switch, and abuse controls are safe only if their deployment authority is explicit; isolate-local state or a running Worker against `0001` is not enough. | Gate public traffic until the scoped migration set is complete, move kill-switch state to the durable Task 9 configuration/secret path, and require managed WAF/rate-limit readback before relying on fallback counters. |
| Important | Browser Purchase claims initially return only payment IDs until the canonical bridge is populated. | Keep the completion path disabled/shadow-only until Task 7 provides the safe `{event_name,event_id,custom_data}` claim payload; never let the browser synthesize commerce data. |
| Minor | Server-to-server source bridges do not have a browser `Origin` header. | Document that the bridge uses per-source HMAC, timestamp, nonce, audience, and tenant/site scope; Origin checks remain for browser endpoints only. |

## Deliberate simplifications retained

- No fingerprinting, arbitrary DOM/keystroke capture, anonymous CRM creation,
  resolver enrichment, generic destination framework, or provider mutations in
  the implementation phase.
- Tinybird remains an analytics projection; tracking D1 remains the delivery
  authority.
- A 400-day practical browser cookie is used; durable continuity requires a
  verified identity claim.

## Exit criteria

1. Contract tests fail for every finding above before the implementation fix.
2. Focused contract, migration, and destination tests pass through
   `host-test-slot --class focused` using the repository Node version.
3. `git diff --check` is clean and the fixes are committed separately from
   browser and Worker task work.
4. No provider, DNS, payment, deployment, Meta, Tinybird, or ad action occurs
   as part of this review.

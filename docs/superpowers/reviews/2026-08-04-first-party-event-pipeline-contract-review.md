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

## Follow-up disposition

The contract blockers were remediated in `a445e70`. The focused contract suite
passes 7/7 through `host-test-slot --class focused`; Task 5 is reviewed at
`a57c272` with 71/71 focused checks. Task 6 passed 17/17 Worker checks plus
migrations 2/2 at `6a39d91`; the nonce-cleanup follow-up `fea5922` is formatted
and diff-clean but has no fresh focused run because the host gate was occupied.
Preview browser evidence remains deferred because this repository has no
Playwright harness. Provider, DNS, payment, deployment, Meta, Tinybird, and ad
mutations remain outside this review.

## Remaining implementation blockers

The spec/plan is improved, but the current Task 5/6 code is still rejected
until these are fixed and retested:

| Priority | Finding | Required change |
| --- | --- | --- |
| Critical | Browser PageView source labels (`pages`/`blueprint`) are rejected by the collector, which currently allows only `event_worker`. | Align the browser-to-collector source contract without allowing browser conversion events; add a 200/403 PageView regression test. |
| Critical | Bootstrap can expose a visitor ID and issue `ma_vid`/`ma_sid` before prior consent; the default privacy resolver also treats unresolved known-US state as allowed. | Fail closed while consent is unresolved, return no raw visitor ID, and issue only the privacy-choice cookie until a permitted purpose is granted. |
| Critical | Queue delivery does not re-check current privacy/tombstone state before sending. | Re-resolve the purpose map and suppression tombstone immediately before every Meta/Tinybird attempt; add opt-out/deletion race tests. |
| Critical | Canonical event persistence lacks `payload_hash` comparison and can silently reuse a same-key, changed body. | Store deterministic hashes, quarantine mismatches, and test same-key/different-body rejection. |
| Important | Delivery leases lack owner/token fencing, so an expired worker can overwrite a reclaimed attempt. | Add lease owner/token to every completion/retry update and test the expiry race. |
| Important | `outcome_unknown` is retried automatically even though the plan requires audited replay only. | Make ambiguous outcomes terminal until an idempotent operator replay; add the provider-accepted/crash-window test. |
| Important | Browser page paths include URL fragments and withdrawal does not fully disable Pixel/clear browser-cleareable attribution state or abort queued beacons. | Strip hash/query from event source paths, disable Pixel and clear `_fbp`/`_fbc` where possible on withdrawal, and test queued-beacon suppression. |
| Important | Privacy mutation nonce is format-only and privacy requests can create global choices without a signed visitor binding. | Bind mutation/request nonces to the signed bootstrap state and reject unbound global choices; add CSRF/replay tests. |
| Critical | Pages source-outbox rows contain a reduced bridge payload, while the Worker source route currently validates the body as a full canonical event. Lead/InitiateCheckout rows are therefore rejected at the bridge. | Choose one contract: have the bridge validate `SourceEventEnvelope` and construct the canonical event from its scoped context, or make Pages emit the complete canonical envelope. Add an end-to-end Pages outbox → Worker acceptance test. |
| Critical | Browser tracking never calls `/v1/bootstrap`, so signed visitor/session cookies and destination-safe external ID are never issued; browser events remain empty-visitor events. | Bootstrap must be the consent-gated first call and its returned signed context must bind subsequent PageViews/claims; add a browser bootstrap → event parity test. |
| Critical | Consent choices are stored only in browser localStorage and are not persisted to the Worker privacy ledger. | POST versioned consent/withdrawal choices to the first-party privacy route with CSRF/replay protection; prove server-side opt-out suppresses source-authoritative delivery. |
| Critical | Blueprint saved-asset checkout initializes an empty tracking context token while the proxy requires a high-entropy token. | Issue/bind the short-lived token before the saved-asset path or keep that path shadow-only; add the exact client-to-proxy fixture. |
| Important | The operator kill switch currently mutates request-local Worker state, so it disappears across isolates. | Persist kill-switch state in durable D1/configuration with audited readback and make every sender consult it atomically. |

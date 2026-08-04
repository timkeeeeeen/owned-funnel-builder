# First-party events Worker runbook

This runbook covers the standalone `workers/events` Worker. It is the only
runtime that can read tracking D1. Pages and the public funnel applications
must never receive a tracking-D1 binding.

## SLO and alerts

- Collector availability: 99.9% monthly (`GET /healthz` is an external probe
  and returns counts-free `{status, version}` only).
- 99% of permitted advertising events are resolved (delivered, suppressed, or
  permanently alerted) within five minutes.
- Every verified Purchase is delivered, suppressed, or alerted within five
  minutes.
- Alert on oldest unresolved delivery age, queue/DLQ growth, permanent or
  `outcome_unknown` failures, missed cron, tracking-D1 errors, and a mismatch
  between verified payments and Meta Purchase events. Alert payloads contain
  counts and event keys only; never log raw envelopes, cookies, credentials,
  emails, or phone numbers.

The scheduled handler runs every minute, reclaims expired delivery leases,
enqueues at most 100 due rows, and performs bounded retention cleanup. A
missed run is an alert, not permission to run an unbounded catch-up. Operators
replay a bounded set through the authenticated operator route and retain the
same event/destination key.

The launch volume model is a 10-event/second peak. The main consumer is pinned
to 50-message batches, four concurrent consumers, a 15-second retry delay, and
five automatic retries before the DLQ. At four batches/minute per consumer the
conservative capacity is 800 events/minute, so a one-minute 600-event peak
clears within the five-minute SLO. Revisit concurrency only when measured
provider latency invalidates that model; never hide backlog by raising retries.

## Route and trust boundaries

`TRACKING_HOST` and `TRACKING_ALLOWED_ORIGINS` are exact allowlists. Public
routes return credentialed CORS only for an exact origin and host; `OPTIONS`
allows only the documented POST headers. The source bridge is server-to-server:
it pins Host but intentionally does not require an Origin header.

- `GET /v1/bootstrap` issues signed `ma_vid`, `ma_sid`, and `ma_privacy` cookies
  with preview/live context, a CSRF nonce, and destination-safe privacy state.
- `POST /v1/events` accepts only browser `PageView`; Lead,
  InitiateCheckout, and Purchase must arrive through an authenticated source
  bridge. Body size, nesting, array, rate, and destination-spend limits are
  enforced before D1/Queue work.
- `POST /v1/privacy` requires same-origin POST plus the bootstrap CSRF nonce.
  `Sec-GPC: 1` always wins for sale/share and advertising purposes. GPC is an
  observed, TTL-bound audit signal, not a user opt-out choice.
- `POST /v1/privacy/requests` accepts access, correction, and deletion only
  when the subject key matches the signed visitor cookie. It returns only a
  request ID and state.
- `POST /v1/source-events` requires a per-source HMAC key, timestamp, nonce,
  exact UTF-8 body signature, source/tenant/site checks, privacy re-resolution,
  and composite source-scoped nonce idempotency. Raw buyer identity is not
  accepted.
- `POST /internal/browser-claims` is Worker-only and requires a context HMAC;
  it cannot create canonical events. Keep it shadow-only until the Task 8
  committed-source contract and safe claim payload tests are reviewed.
- `POST /internal/operator/replay` and `/internal/operator/kill-switch` require
  the operator bearer credential plus actor, reason, request ID, and
  idempotency key; high-risk runs may require a distinct second approver. Every
  operation is bounded, auditable, and rejects browser/source credentials.

## Queue and D1 recovery

Queue messages contain `{event_key, destination, schema_version}` only. The
consumer claims a destination row with a compare-and-set lease, reads the
canonical event, and keeps the same key through retries. Provider ambiguity is
recorded as `outcome_unknown`; retryable and permanent outcomes retain a
redacted error. Invalid schema, missing events, and exhausted retries are
written to `tracking_dlq_records` before acknowledgement. The DLQ consumer
does not automatically resend; replay is an explicit operator action.

The canonical event, outbox row, and destination rows are inserted through one
D1 batch, including canonical and destination payload hashes. Duplicate event
IDs reuse the event key only when the canonical hash also matches. Migration
`0004_delivery_safety.sql` adds the hash, transform, lease-owner, fencing-token,
durable kill-switch, and operator-audit contract. Public traffic is forbidden
until the migration runner has applied `0001` through `0004` in lexical order
under the forward-only lock and recorded the exact reviewed release SHA.

## Secret binding contract

Wrangler commits binding names and key IDs only. Provision secret values out of
band for `TRACKING_CONTEXT_SIGNING_KEY_CURRENT`, optional
`TRACKING_CONTEXT_SIGNING_KEY_PREVIOUS`, cookie-signing keys, identity HMAC
keys, per-source bridge keys, the operator token, and destination credentials.
Never place those values in Wrangler vars, logs, the runbook, or D1. Context
signing must fail closed when the current secret is absent.

## Change and rollback procedure

1. Run the focused Worker tests, migration test, formatter, diff check, and
   Wrangler dry run from the exact reviewed SHA.
2. Apply tracking migrations under the environment lock. Read back that
   `TRACKING_DB`, queues, DLQ, host, origins, and source key IDs belong to the
   same preview/live environment and that no business-D1 binding exists.
3. Deploy the Worker and probe `/healthz`; send one signed PageView and one
   source-bridge canary. Keep canary events out of campaign KPI reports.
4. On queue growth, provider mismatch, or privacy incident, enable the
   destination kill switch, preserve the ledger, and page the owner. Do not
   delete rows or replay without an operator reason, request ID, and bounded
   event-key list.
5. Roll forward to a reviewed SHA. Additive migrations are never destructively
   rolled back while older code may still run; a failed migration leaves the
   Worker disabled until the hardening step is repaired.

No live provider, DNS, payment, Meta, Tinybird, or ad mutation is part of this
runtime task. Those actions require the separately approved validation stage.

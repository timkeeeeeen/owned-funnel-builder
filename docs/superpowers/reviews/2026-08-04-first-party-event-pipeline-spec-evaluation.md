# First-Party Event Pipeline Spec Evaluation

Date: 2026-08-04  
Reviewed worktree: `codex/first-party-event-pipeline`  
Reviewed implementation head: `166a94d` plus uncommitted blocker fixes

## Verdict

The Cloudflare Worker + tracking D1 + Queue + Tinybird shape is a reasonable
first-party delivery architecture. The spec is not implementation-ready or
launch-ready yet. It mixes a useful four-event contract with too much future
platform scope, and several invariants are stated in prose but are not true in
the current browser/Worker code.

The recommended change is to keep the architecture, narrow the first release
to an allowlisted event-and-field contract, and make the unresolved safety
properties executable gates. The five funnels remain the business objective,
but each funnel gets an independent evidence row and activation state.

## Independent review results

Three focused reviews reached the same conclusion from different angles:

| Review | Blocking findings |
| --- | --- |
| Privacy/security | Advertising identifiers are retained without purpose-level stripping; privacy snapshots are incomplete; visitor continuity is not server-bound; policy version is hardcoded in the banner; nonces are replayable; policy artifacts are missing. |
| Browser/source bridge | Bootstrap response/context is not bound into events; consent persistence can partially fail and localStorage can become the authority; beacon credential semantics are unproven; Blueprint token storage contradicts request-only handling; bootstrap ordering is ambiguous before consent. |
| Worker/delivery | Queue sends do not re-check privacy/tombstones; sender outcomes are collapsed to delivered; leases are unfenced; kill switch is isolate-local and drops rows; payload hashes are not verified; migration and backlog/health evidence are incomplete. |

These are contract failures, not polish. They can cause unauthorized delivery,
duplicate or lost conversions, stale workers overwriting newer state, or an
operator believing a funnel is protected when it is not.

## Required spec improvements

### 1. Replace “all possible data” with an allowlist contract

The spec should state that collection is limited to fields in
`config/tracking-field-policy.json`. Each row must specify:

- event and source;
- purpose (`necessary`, `analytics`, `advertising`, or `identity`);
- consent/GPC requirement;
- provenance and trust level;
- exact canonical and destination mapping;
- source, D1, Queue, Tinybird, provider, and log TTL;
- redaction/deletion operation; and
- whether the value is raw, normalized, hashed, bucketed, or prohibited.

For the current release, `fbclid`, `_fbp`, `_fbc`, IP, and user agent are
short-lived operational context. If advertising consent is absent, they must
be removed before canonical persistence and Tinybird projection. Long-lived
analytics may retain only an approved keyed or bucketed projection. Arbitrary
DOM, keystrokes, credentials, payment-card data, fingerprinting, and resolver
enrichment remain prohibited.

### 2. Make privacy evidence part of every event

Add `config/privacy-policy.json` and require the Worker and source runtimes to
read it. A signed `privacy_snapshot` is mandatory in browser and source
envelopes and contains:

`policy_version`, per-purpose decisions, `choice_id`, decision source,
resolved region, GPC state, observed timestamp, and a server-bound subject
reference.

The source snapshot is preserved for audit, while current consent and
suppression tombstones are re-evaluated immediately before each destination
attempt. A bridge must never infer legal basis from missing browser cookies.
LocalStorage is only a UI cache; the server ledger is authoritative.

### 3. Resolve the bootstrap/consent boundary explicitly

An unresolved prior-consent visitor may make one control-plane bootstrap call.
That call may return a signed privacy-choice cookie and one-time CSRF nonce,
but may not create a visitor/session ID, external ID, attribution row, event,
Queue message, Pixel call, or destination job. After an allowed purpose,
bootstrap may issue the signed visitor/session cookies and opaque external IDs.

The banner must consume the server-returned policy version. Stale local state
is reset, purpose writes are atomic, and each cookie-authenticated mutation
(choice, withdrawal, deletion) consumes its bootstrap-bound nonce exactly once.
If the product cannot guarantee this control-plane exception, defer bootstrap
until the banner action instead of silently violating the unresolved-state
rule.

### 4. Bind identity on the server

The browser may echo an opaque correlation hint, but the Worker must inject the
visitor/session subject from the signed cookie into the canonical event. Raw
visitor IDs are never returned or trusted from the browser. The same server
subject must drive deletion scope, suppression tombstones, and external-ID
continuity across sessions.

### 5. Specify a real delivery state machine

The queue contract must include these invariants:

- every delivery row stores canonical/destination payload hashes and transform
  version before send;
- same event/destination key with a different hash is quarantined, never
  overwritten;
- leases return an owner plus fencing token, and every completion/retry update
  requires that token;
- the consumer re-checks purpose, current consent, GPC, and tombstones after
  leasing and immediately before the provider call;
- `accepted`, `retryable`, `permanent`, and `outcome_unknown` are handled
  distinctly; `outcome_unknown` is terminal until an audited replay; and
- a durable kill switch pauses new sends without deleting pending rows and is
  consulted atomically by every sender.

The migration set must contain the required columns and be applied under a
recorded migration lock before public traffic. Health must report persisted
oldest-age, cleanup watermark, backlog, and missed-schedule state using
allowlisted diagnostics only.

### 6. Make browser/source compatibility executable

Add fixtures for:

1. control-plane bootstrap;
2. consent POST and policy-version refresh;
3. bootstrap response binding into PageView;
4. credentialed collector fallback when beacon cannot carry headers;
5. reduced Pages/Convex source envelope → canonical event;
6. partial consent-write failure and retry;
7. multi-tab withdrawal; and
8. Blueprint issuer/verifier/audience/nonce/expiry/flow binding.

Blueprint and App-Idea remain shadow-only until their deployed contracts and
exact source SHAs are pinned in the source manifest. A missing Convex contract
blocks that funnel, not the Pages funnels.

## Scope corrections

Keep in the first release:

- four events and one Meta dataset/pixel;
- one Maestro deployment, one tracking D1, Queue/DLQ, and Tinybird datasource;
- deterministic server-bound visitor identity;
- source outboxes for authoritative Lead, InitiateCheckout, and Purchase;
- privacy, deletion, retention, deduplication, and delivery observability; and
- independent per-funnel launch gates.

Defer until a concrete second tenant or destination requires it:

- a generic destination framework;
- a shared multi-tenant control plane;
- CRM creation/sync;
- RB2B/vector or other resolver enrichment;
- probabilistic identity or fingerprinting;
- automated hostname provisioning; and
- arbitrary interaction capture.

The spec already says most of this, but the plan should stop creating files or
interfaces for deferred capabilities. This removes design surface without
weakening launch safety.

## Revised rollout sequence

1. **Contract gate:** privacy/field artifacts, canonical event schemas,
   payload hashes, privacy snapshot, identity binding, migration tests.
2. **One Pages funnel:** preview-only collector, PageView/Lead/
   InitiateCheckout, queue reliability, and one approved live `$1` Purchase
   canary. No campaign activation.
3. **Pages replication:** repeat the same evidence row independently for the
   other two Pages funnels; do not share a green state implicitly.
4. **Convex admission:** pin App-Idea and Blueprint runtime contracts, source
   outboxes, ownership manifests, signed context tokens, and reconciliation.
5. **Campaign activation:** create campaigns paused, then enable one funnel at
   a time only after its own software, privacy, delivery, canary/refund, and
   owner-evidence gates are green.

## Revised launch gate

A funnel may enter `campaign_enabled` only when its evidence row contains:

- exact application and source-runtime SHAs;
- green focused/required CI at those exact SHAs;
- applied migration filenames/checksums and isolated resource readback;
- bootstrap/consent/identity and browser/server event-ID evidence;
- privacy snapshot, field-purpose, GPC, withdrawal, and deletion evidence;
- queue oldest age, destination latency, duplicate rate, and field-presence
  samples with a measurement window;
- approved live `$1` canary, refund/revocation, webhook, fulfillment, and
  reconciliation evidence for each distinct payment implementation; and
- named owner, rollback action, and campaign state.

`UNVERIFIED`, missing, stale, or evidence-only values fail closed. A green
Pages row does not imply a green Convex row.

## Review disposition

The design addendum in the main spec incorporates these changes. The current
dirty implementation should not be marked complete or deployed until the
blocking contract tests and focused host-gated checks pass. No provider, DNS,
deployment, payment, Meta, Tinybird, or ad mutation is authorized by this
review.

## Follow-up scope audit

The second review pass found three documentation ambiguities and no reason to
expand the architecture:

- Bootstrap now has an explicit phase-dependent response. Before consent it
  returns only privacy/CSRF control state; identity-bearing context is available
  only after a permitted purpose is recorded.
- Provider capability evidence is split into a machine gate
  (`config/provider-capabilities.json`) and a matching human readback. Markdown
  alone cannot authorize a launch.
- The first release still has one deployment, one collector, one tracking D1,
  one Queue/DLQ, and four events. Generic destination adapters, resolver
  enrichment, probabilistic identity, and a control-plane dashboard remain
  deferred. These are deliberate scope cuts, not missing requirements.

The implementation must still prove that control artifacts are fail-closed and
actually imported at trust boundaries; a valid-looking artifact file without a
runtime call site is not evidence of enforcement.

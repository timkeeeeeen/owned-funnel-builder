# First-Party Event Pipeline Spec Review

Date: 2026-08-04
Reviewers: independent privacy/security and operations passes
Disposition: conditionally approved for implementation after the controls below

## What held up

- Business, source-runtime, and tracking-D1 authority boundaries are explicit.
- Browser/ CAPI deduplication, transactional source outboxes, at-least-once
  delivery, Dodo ownership, and live `$1` validation are coherent.
- The spec correctly rejects fingerprinting, anonymous CRM fabrication, raw
  PII in the tracking plane, and the idea of a thirty-year browser cookie.

## Changes made

- Added an executable consent-banner contract, GPC precedence, CSRF/fetch-
  metadata checks, no-store/cache/log-redaction rules, and cost ceilings.
- Removed the Blueprint GET/token contradiction and made the Pages claim path
  Worker-only; source outboxes persist only an opaque context reference.
- Isolated bridge keys per source/runtime and added exact-SHA/CI-authority,
  production migration/readback, preview-resource, and crash-safe canary gates.
- Added field-level retention across source authorities, queues, logs, provider
  copies, and Tinybird, plus source-runtime erasure receipts and Tinybird read
  isolation.
- Made the tracking domain/cookie relationship an explicit launch gate for
  App-Idea and Blueprint rather than assuming cross-domain cookies work.
- Marked the older Admaxxer-oriented plans as superseded and kept the existing
  five-funnel launch ledger as the single activation authority.

## Remaining implementation blockers

1. Record the exact hostname/cookie/collector mapping for every funnel; keep a
   funnel shadow-only if it cannot satisfy the first-party host contract.
2. Implement and test the per-source bridge keys, token-free source rows,
   source-runtime deletion contracts, and field-policy-driven serializers.
3. Obtain redacted provider/DNS/secret-scope readbacks and exact source SHA CI
   evidence before any preview or live provider mutation.

No provider, DNS, deployment, payment, Meta, Tinybird, or ad action is
authorized by this review.

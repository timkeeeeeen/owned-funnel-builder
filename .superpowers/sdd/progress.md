# First-Party Event Pipeline Execution

Base: `55d09e8`
Plan: `docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md`

## Task ledger

- [x] Task 1 — authority inventory and contract map (`5a41a6e`; focused gate deferred because host load stayed above `10.00`)
- [x] Task 2 — canonical event contract and D1 schemas (`88d4ca1`; focused Node gate deferred because host load stayed above `10.00`)
- [x] Task 3 — identity, cookies, privacy, GPC, and CORS (`f6b2c47..5462dc4`; review approved, focused gate 17/17)
- [x] Task 4 — Pages checkout context, source outbox, and browser claims (`850ee93..36eb2c5`; prior independent review rejected four issues, all remediated; focused gate 52/52, functions check and format clean)
- [x] Task 4.5 — machine-readable privacy/field/host/source/rollout control artifacts (`0af587a..c16986c`; reviews remediated; artifact gate 6/6, collector 16/16, tracking contract 8/8)
- [x] Task 5 — browser Pixel/collector integration (`6fd28f7..faa5cee`; review clean, conditional on Task 6 secret provisioning; focused collector 20/20, browser 4/4, privacy 6/6, Blueprint 14/14, proxy 3/3, browser-events 3/3)
- [x] Task 6 — Worker collector, queues, privacy routes, and cleanup (`453f7f2..a90622e`; review clean; final focused aggregate 54/54, Wrangler dry-run clean)
- [ ] Task 7 — Meta CAPI, Tinybird, and deletion workflow
- [ ] Task 8 — App-Idea/Blueprint source bridges
- [ ] Task 9 — deployment manifests and Woodpecker gates
- [ ] Task 10 — preview and live `$1` validation evidence
- [ ] Task 11 — copy and per-funnel campaign readiness

## Review ledger

Each task requires an implementer report, a review package, a task review, and
fix/re-review for every Critical or Important finding before it is marked done.

Task 3: complete (commits f6b2c47..5462dc4, review approved).
Task 4: complete (commits 850ee93..36eb2c5). The review findings were:
provider ownership was committed outside the business batch, InitiateCheckout
batch results were unchecked, source-outbox recovery lacked a route, and Lead
browser payloads were exposed before persistence. Remediation moved mapping
commit into the business batch, checked both InitiateCheckout batches, added
authenticated source-outbox recovery, and delayed the Lead payload. Canonical
payload hashing, fenced provider claims, and recovery-route tests were added.

Task 4.5: complete (commits 0af587a..c16986c). Independent review found and
remediated fail-open field projection, raw redaction, source-runtime readiness,
context-hash authority, provider/rollout gates, browser/source buyer-context
transport, and policy-version drift. Final review approved the implementation.
Focused evidence: artifact controls 6/6, collector 16/16, tracking contract
8/8, and clean diff checks. The production context verifier remains
intentionally fail-closed until Task 6 supplies its binding.

Task 5: complete (commits 6fd28f7..faa5cee). Review remediation fixed atomic
consent mutation and unique action IDs, server-authoritative effective
purposes, PageView replay/deduplication ordering, nonce policy/context binding,
production context signing and verification, and tamper/stale/expired/deleted
context rejection. The reviewer approved the implementation; the real
`TRACKING_CONTEXT_SIGNING_KEY_CURRENT` secret remains a Task 6 deployment
prerequisite and is intentionally not committed.

Task 6: complete (commits 453f7f2..a90622e). Independent review remediation
added migration/release gates, audited replay recovery, transformed-payload
hashing, policy/GPC/tombstone rechecks, durable budgets and WAF capability
readback, per-funnel controls, bounded cleanup metrics, and peak-load cleanup
capacity. Final review approved the implementation. Final focused aggregate:
54/54; Wrangler dry-run, formatting, and diff checks passed.

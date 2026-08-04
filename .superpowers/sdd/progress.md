# First-Party Event Pipeline Execution

Base: `55d09e8`
Plan: `docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md`

## Task ledger

- [x] Task 1 — authority inventory and contract map (`5a41a6e`; focused gate deferred because host load stayed above `10.00`)
- [x] Task 2 — canonical event contract and D1 schemas (`88d4ca1`; focused Node gate deferred because host load stayed above `10.00`)
- [x] Task 3 — identity, cookies, privacy, GPC, and CORS (`f6b2c47..5462dc4`; review approved, focused gate 17/17)
- [x] Task 4 — Pages checkout context, source outbox, and browser claims (`850ee93..36eb2c5`; prior independent review rejected four issues, all remediated; focused gate 52/52, functions check and format clean)
- [ ] Task 5 — browser Pixel/collector integration
- [ ] Task 6 — Worker collector, queues, privacy routes, and cleanup
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

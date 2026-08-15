# Preview First-Party Tracking Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate an isolated Cloudflare preview of the merged first-party tracking pipeline and prove non-payment browser and signed source events without enabling Meta, Tinybird, Dodo, campaigns, canaries, cards, production deployment, or live traffic.

**Architecture:** A manual GitHub Actions workflow scoped to the `tracking-preview` environment verifies and deploys one preview Worker from this branch. Separate preview D1 databases isolate the Worker ledger and Pages source outbox; a preview Queue/DLQ and `events-preview.shop.maestrogtm.com` custom domain complete the path. Source senders remain shadowed, while one explicit preview-only gate permits signed `Lead` and `InitiateCheckout` proofs and always rejects `Purchase`.

**Tech Stack:** Node.js 22, Astro 7, Cloudflare Pages/Workers/D1/Queues, Wrangler 4, GitHub Actions, Node test runner.

## Global Constraints

- Preview resources only: `maestro-first-party-events`, `maestro-tracking-preview`, `owned-funnel-builder-preview`, `maestro-events-preview`, `maestro-events-preview-dlq`, and `events-preview.shop.maestrogtm.com`.
- Meta and Tinybird sender flags remain `false`; their credentials are not bound.
- Never call Dodo, create campaigns/canaries, charge a card, or touch production Pages, production D1, live Workers, live Queues, or `events.shop.maestrogtm.com`.
- Every mutating command requires `--execute`, the owner approval ID `owner-preview-tracking-2026-08-15`, and exact 40-character SHAs.
- Secrets travel only through process environment or stdin and are stored only in the GitHub `tracking-preview` environment and Cloudflare secret bindings.
- Keep the existing dirty main checkout and preserved `.worktrees/first-party-event-pipeline` worktree untouched.

## Delivery Batches

One batch contains Tasks 1-4 on branch `codex/first-party-tracking-activation-audit`, based on `origin/main` `17d0b3d266ab0366be30d1612d2e41d03e35e5ee`, targeting `main` only after a separate future production approval. Focused checks are the named Node tests, `check:events`, format, and diff checks. The batch verification is the manual `tracking-preview` workflow plus Cloudflare and D1 readbacks on its frozen head.

---

### Task 1: Make the preview runtime deployable without weakening production

**Files:**
- Modify: `workers/events/src/collector.ts`
- Modify: `workers/events/wrangler.jsonc`
- Modify: `config/trusted-hosts.json`
- Test: `workers/events/tests/collector.test.mts`
- Test: `tests/quality/environment-resource-isolation.test.mts`

**Interfaces:**
- Consumes: Cloudflare string secret bindings, `TRACKING_INTERNAL_HOST`, `TRACKING_PREVIEW_NON_PAYMENT_PROOF`, and `TRACKING_PAGES_SOURCE_SHA`.
- Produces: working signed cookies from string secrets, exact internal service-host acceptance, and preview-only `Lead`/`InitiateCheckout` source acceptance while `Purchase` stays blocked.

- [ ] Add failing tests proving string cookie secrets work, `tracking.internal` is accepted only for internal/source routes, preview proof accepts signed `Lead` and `InitiateCheckout`, and preview proof rejects `Purchase`.
- [ ] Run `rtk test node --import tsx --test workers/events/tests/collector.test.mts tests/quality/environment-resource-isolation.test.mts`; require failures at the new assertions.
- [ ] Import raw cookie secrets with Web Crypto, add exact public/internal host selection, and add the narrow preview non-payment gate after the source envelope is parsed and signature-verified.
- [ ] Add only preview host/origin/tenant/site/proof variables to Wrangler; retain all live placeholders and both destination flags as `false`.
- [ ] Rerun the focused command and require zero failures.

### Task 2: Add approval-gated preview automation and manual CI

**Files:**
- Create: `.github/workflows/tracking-preview.yml`
- Create: `scripts/tracking-preview-contract.mjs`
- Modify: `scripts/provision-preview-events.mjs`
- Modify: `scripts/apply-tracking-migrations.mjs`
- Modify: `scripts/publish-events-worker.mjs`
- Test: `tests/quality/deployment-scripts.test.mts`
- Test: `tests/quality/tracking-preview-ci.test.mts`

**Interfaces:**
- Consumes: exact Worker/source SHAs, approval ID, Cloudflare account/token, preview resource IDs, and GitHub environment secrets.
- Produces: dry-run-default scripts that reject live execution and a workflow that can mutate only named preview resources.

- [ ] Add failing tests for preview-only names, exact approval/SHA validation, manual workflow dispatch, `tracking-preview` environment scope, disabled destination secrets, and an unconditional live-execution rejection.
- [ ] Run `rtk test node --import tsx --test tests/quality/deployment-scripts.test.mts tests/quality/tracking-preview-ci.test.mts`; require failures for missing preview execution contracts.
- [ ] Implement the smallest shared contract parser and update the three scripts to call Wrangler only for preview with validated names and IDs.
- [ ] Add a manual workflow that checks out the frozen Worker head, runs focused gates, applies preview migrations, deploys the preview Worker, and runs the proof script using environment-scoped secrets.
- [ ] Rerun the focused tests and require zero failures.

### Task 3: Provision and activate the isolated preview path

**Files:**
- Modify after provider readback: `workers/events/wrangler.jsonc`
- Modify: `wrangler.jsonc` only if a committed preview environment is required by Wrangler
- Create: `scripts/prove-tracking-preview.mjs`
- Test: `tests/quality/tracking-preview-proof.test.mts`

**Interfaces:**
- Consumes: Cloudflare preview resource IDs, environment-scoped deploy token, generated bridge/cookie/context/operator secrets, and exact Worker/source SHAs.
- Produces: a healthy preview Worker, migrated preview databases, Pages preview service binding, and redacted proof IDs.

- [ ] Add a failing proof-contract test requiring `/healthz`, signed bootstrap cookies, accepted `PageView`, signed `Lead`, signed `InitiateCheckout`, rejected `Purchase`, zero Meta/Tinybird deliveries, and D1 event-key readback.
- [ ] Run `rtk test node --import tsx --test tests/quality/tracking-preview-proof.test.mts`; require failure because the proof script is absent.
- [ ] Provision the two preview D1 databases, Queue/DLQ, Worker custom domain, GitHub environment, least-privilege deploy token, Worker secrets, Pages preview secrets, and Pages service binding; read each mutation back immediately.
- [ ] Apply business/source and Worker migrations in lexical order, write the reviewed release-state and fallback-abuse-capability rows, and record Time Travel bookmarks before data writes.
- [ ] Deploy current Worker head and exact `origin/main` Pages source SHA to preview only, then run the proof script.
- [ ] Rerun the proof-contract test and require zero failures.

### Task 4: Freeze and record the preview evidence

**Files:**
- Modify: `docs/launch/first-party-tracking-activation-gap-ledger.md`
- Modify: `docs/launch/provider-capability-readback.md`
- Modify: `config/source-runtime-gates.json` only if exact preview evidence satisfies its existing schema

**Interfaces:**
- Consumes: exact Cloudflare/GitHub deployment IDs, resource IDs, migration rows, proof event keys, and sender-delivery counts.
- Produces: a redacted preview activation receipt and the remaining production approval gate.

- [ ] Read back exact Worker deployment, hostname/TLS, D1 bindings/migrations/release state, Queue/DLQ consumers, Pages preview deployment/binding, workflow result, proof event keys, and zero destination deliveries.
- [ ] Update the two authority documents without secrets or customer data; leave production/source gates shadowed unless their existing contract is fully satisfied.
- [ ] Run `rtk prettier --check` on changed files, the focused Node tests once, `rtk npm run check:events`, `rtk git diff --check`, and a changed-file secret-pattern scan.
- [ ] Commit, push, and verify the remote branch exact SHA. Do not open or merge a PR and do not run any production action.

## Self-Review

- Spec coverage: all approved preview resources, CI/credential scope, migrations, bindings, non-payment proofs, sender shutdown, evidence, and production exclusions are mapped.
- Placeholder scan: no implementation placeholder authorizes an unknown resource; provider-generated IDs are intentionally read back during Task 3 rather than guessed.
- Type consistency: the same `approval-id`, `worker-sha`, `source-sha`, resource names, environment name, and proof event set are used across scripts, workflow, tests, and evidence.

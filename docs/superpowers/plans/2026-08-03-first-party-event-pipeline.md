# First-Party Event Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify one first-party Meta Pixel/CAPI and Tinybird
event pipeline for all five launch funnels—Owned Funnel Builder, Talking Head
Video VBuilder, Vibe Code Anything, App-Idea Evaluator, and Maestro's $5
Blueprint—without duplicating payment, fulfillment, identity, or webhook
authority.

**Architecture:** The existing Pages project remains the business-state
authority for the three Pages-owned funnels. A standalone Cloudflare Worker
owns first-party collection, Queue/DLQ consumption, scheduled outbox recovery,
privacy enforcement, Meta CAPI, Tinybird projection, and cleanup. App-Idea and
Blueprint retain their own commercial runtimes; each writes a source-side
outbox atomically with its own verified checkout/payment mutation and drains
through a signed Worker bridge. The existing production D1 is reused
additively for source-outbox rows only; a dedicated tracking D1 is the compact
tracking and delivery ledger bound to the Worker. Preview resources are
separate.

**Tech Stack:** Astro 7, TypeScript 5.9, Cloudflare Pages Functions, one
standalone Cloudflare Worker, D1, Cloudflare Queues/DLQ, Dodo Payments,
native Meta Pixel plus Meta Conversions API, Tinybird Events API, existing
Convex runtimes, Node test runner with the repository's existing `tsx` loader,
Playwright,
Wrangler, and Woodpecker.

## Global Constraints

- Canonical tracking repository: `/Users/headless/owned-funnel-builder`.
- Candidate source repositories: `/Users/headless/maestro`,
  `/Users/headless/maestro-template-saas-ui`, and any exact deployed
  repository discovered by Task 1; never edit their dirty long-lived
  checkouts.
- Worktree implementation is required. Start each repository from a clean
  current `origin/main` or the exact reviewed base recorded by Task 1.
- Woodpecker is the only active CI/deployment authority. Do not invoke
  Buildkite or Fabro.
- The existing production business D1 remains authoritative and receives only
  additive source-outbox migrations; never bind it to the public Worker and do
  not create a second production business database.
- Begin Pages/business-D1 migrations at `0010_*`; migration tests must apply
  every business migration in lexical filename order, including both existing
  `0007_*` files. Tracking-D1 migrations live under
  `workers/events/migrations/` and are independently applied in lexical order.
- Queue and remote delivery are at-least-once and unordered. Never claim
  exactly-once remote delivery; every retry preserves the same event and
  destination key.
- Events are exactly `PageView`, `Lead`, `InitiateCheckout`, and
  `Purchase`. No open-ended browser `properties` bag is permitted.
- Internal identity aliases use tenant-scoped, domain-separated HMAC-SHA-256.
  Meta hashes are generated only by the versioned, destination-scoped Meta
  transform. Pages/Convex may invoke that exact transform before the
  authenticated bridge; the Worker validates the transform version and never
  hashes an already-hashed value. Hashing is pseudonymization, not
  anonymization.
- No fingerprinting or IP/UA/device-based identity merge is allowed.
- In prior-consent regions, no tracking cookie, Tinybird row, native Pixel,
  resolver call, or advertising job is created before required consent.
  `Sec-GPC: 1`, stored opt-out, or withdrawal suppresses applicable
  advertising/sale-share processing and pending jobs.
- Browser code never receives Meta, Tinybird, Dodo, HMAC, or Worker credentials.
- Raw email, phone, payment payloads, flow tokens, and secrets never enter
  browser responses, generic Queue messages, Tinybird, logs, or diagnostics.
- Production parent cookie scope is explicitly `Domain=shop.maestrogtm.com`;
  preview uses host-only, environment-specific cookie names. All production
  sibling hosts require DNS/TLS/CNAME ownership, HSTS/CSP/referrer policy, no
  user-content host, no alternate `workers.dev` route, and a continuous drift
  probe before cookie issuance.
- Every canonical/source event stores a deterministic body hash. A same-scoped
  ID with a different hash is quarantined, never first-writer-wins. Every lease
  stores an opaque owner/token and all completion/release updates compare it.
- Source bridge envelopes include signed `tenant_id`, `site_id`, `product_id`,
  `funnel_slug`, an opaque TTL-bound `context_ref`/`lead_id`, and an immutable
  `privacy_snapshot`; these fields are validated against the ownership manifest.
- Bridge timestamps use a fixed ±5 minute skew, nonces expire after 10 minutes,
  and retries use a fresh nonce with source-event idempotency. Tokens never
  travel in URLs, query strings, referrers, or access logs; checkout-status is
  POST body or HttpOnly-bound state only.
- Live `$1` canaries carry `validation_session_id` and `is_canary` through every
  projection, are excluded from campaign KPIs/optimization, and require proof
  that refund/revocation did not pollute production metrics.
- Purchase is emitted only after a signature-verified, catalog-validated Dodo
  `payment.succeeded`. One Dodo payment ID produces one canonical Purchase;
  base plus bump items in one payment share one `contents` array.
- Dodo test mode does not validate one-click upsells. Every paid stage that
  needs live transport proof uses a temporary non-public live `$1 USD`
  product, an owner-approved charge, and the owner's live card entered directly
  in hosted Dodo checkout. Card data never enters an agent, tool, log, file, or
  repository. Each canary is refunded/revoked immediately.
- No live provider, DNS, deployment, Meta, Tinybird, Dodo, or ad mutation occurs
  before code review, required CI, and an explicit launch validation step.
- Existing Admaxxer and legacy Meta senders are disabled or proven non-forwarding
  before this pipeline is enabled. No compatibility adapter is added in v1.
- Product-specific copy and economics remain in their existing JSON/source
  records. Do not add a CMS, payment abstraction, generic destination
  framework, shared SaaS control plane, CRM adapter, RB2B adapter, or resolver
  graph in this plan.
- Every task ends with focused tests, `git diff --check`, and a small commit.
  Broad tests run only through `maestro-worker` or `host-test-slot`.
- The plan does not authorize ad activation merely because software gates pass;
  campaigns remain paused until the per-funnel evidence gate is complete.

## Delivery Order And Dependencies

| Order | Deliverable | Depends on |
| --- | --- | --- |
| 1 | Authority inventory and source-contract map | read-only repository/provider inspection |
| 2 | Canonical event contract and additive D1 schema | Task 1 |
| 3 | Shared identity, cookie, privacy, and server bridge primitives | Task 2 |
| 4 | Pages checkout/webhook/outbox integration | Tasks 2–3 |
| 5 | Browser Pixel/collector integration | Tasks 3–4 |
| 6 | Standalone Worker, Queue/DLQ, privacy, and cleanup | Tasks 2–5 |
| 7 | Direct Meta CAPI and Tinybird projection | Tasks 2–6 |
| 8 | App-Idea and Blueprint source outboxes/bridges | Tasks 1, 3, and 7 |
| 9 | Deployment manifests, ownership reconciliation, and CI gates | Tasks 2–8 |
| 10 | Preview, fixture, and live $1 validation evidence | Tasks 1–9 |
| 11 | Copy/campaign readiness and per-funnel activation | Task 10 |

The three Pages funnels can become independently launch-ready while a missing
App-Idea or Blueprint source contract is resolved, but the five-funnel program
is not complete until all five gates are green.

---

## Task 1: Establish The Authority Inventory And Contract Map

**Files:**

- Create: `docs/launch/first-party-event-pipeline-evidence.md`
- Create: `config/trusted-hosts.json`
- Create: `config/privacy-policy.json`
- Create: `config/tracking-field-policy.json`
- Create: `config/source-runtime-manifest.json`
- Create: `tests/quality/first-party-authority-inventory.test.mts`
- Read-only inputs: `docs/superpowers/specs/2026-08-03-first-party-event-pipeline-design.md`,
  `docs/superpowers/plans/2026-08-02-standard-funnels-launch.md`,
  `docs/superpowers/plans/2026-08-02-app-idea-funnel-launch.md`,
  `docs/superpowers/plans/2026-08-02-blueprint-funnel-launch.md`,
  `docs/superpowers/plans/2026-08-02-meta-campaign-activation.md`

**Interfaces:**

- Produces an evidence file with exact repository/base SHA, route, runtime,
  payment provider, Dodo product key, webhook owner, fulfillment owner, and
  source-system value for each of the five funnels.
- Produces a machine-checkable catalog of
  `pages`, `app_idea`, and `blueprint` source systems.
- Consumes only read-only local/provider state; it does not provision or mutate
  anything.

- [ ] **Step 1: Record clean bases without touching dirty checkouts**

Run from each candidate repository worktree:

```bash
rtk git status --short
rtk git rev-parse HEAD
rtk git branch --show-current
rtk git log -1 --oneline
```

Expected: the worktree is clean, the SHA is recorded, and any dirty long-lived
checkout is explicitly excluded. Do not run destructive cleanup.

- [ ] **Step 2: Inventory the five public routes and source contracts**

Read the generated funnel catalog and route files in Owned Funnel Builder:

```bash
# Read existing generated output; do not regenerate in the long-lived checkout.
rtk rg -n 'authority-snapshot|cmo-game-plan|app-idea|talking-head|vibe-code|owned-funnel' src functions tests
```

Record whether App-Idea and Blueprint checkout/status functions are present in
the source repository or only referenced as deployed contracts. A missing
module is an explicit `unverified` finding, not a guessed path.

Also inventory every DNS record and deployed sibling under
`shop.maestrogtm.com`, including dangling CNAME/takeover risk, owner, TLS,
deployment, and cookie trust status. The parent-domain cookie is launch
blocked until every sibling is owned and hardened; record exact DNS/readback
evidence without logging cookie values.

- [ ] **Step 3: Write the redacted authority map**

Use this exact row shape in
`docs/launch/first-party-event-pipeline-evidence.md`:

```md
| Environment | Funnel | Public route | Source system | Checkout owner | Payment/webhook owner | Fulfillment owner | Dodo product ID/key | Base SHA | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| preview/live | Owned Funnel Builder | /owned-funnel-builder/ | pages | Pages | Pages | Pages/Dodo | UNVERIFIED | UNVERIFIED | unverified |
| preview/live | Talking Head Video VBuilder | /talking-head-ad-machine/ | pages | Pages | Pages | Pages/Dodo | UNVERIFIED | UNVERIFIED | unverified |
| preview/live | Vibe Code Anything | /vibe-code-anything/ | pages | Pages | Pages | Pages/Dodo | UNVERIFIED | UNVERIFIED | unverified |
| preview/live | App-Idea Evaluator | ROUTE_UNVERIFIED | app_idea | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | UNVERIFIED | UNVERIFIED | unverified |
| preview/live | Maestro $5 Blueprint | /authority-snapshot/AUDIENCE | blueprint | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | RUNTIME_UNVERIFIED | UNVERIFIED | UNVERIFIED | unverified |
```

Values marked `UNVERIFIED` or `*_UNVERIFIED` are evidence fields in the
document only. They must be replaced by observed values or the row stays
`unverified` and blocks that funnel's activation.

The same task commits the control artifacts required by the spec. The privacy
policy contains per-region/state purpose decisions, GPC/LDU behavior,
unknown-region and minor/sensitive-data handling, and named legal
owner/version approval. The field policy gives every field its source,
purpose, consent, destination, trust provenance, exact TTL, and deletion path.
The source-runtime manifest pins repository, SHA, bridge contract version,
environment, and required CI status. The trusted-hosts file records ownership,
HSTS/CSP/referrer policy, alternate-route checks, and the continuous drift probe.

- [ ] **Step 4: Add static authority assertions**

The test must assert that the four event names, five source-system labels, the
three Pages product keys, the Blueprint client paths
`capabilities/billing/blueprintCheckoutStarts:start` and
`capabilities/billing/blueprintPurchases:getCheckoutStatus`, and the
no-Stripe-for-launch rule are represented in the evidence map. It must fail if
an unknown source system or duplicate payment owner is added.

```ts
assert.deepEqual(
  new Set(rows.map((row) => row.sourceSystem)),
  new Set(['pages', 'app_idea', 'blueprint']),
);
assert.equal(
  new Set(rows.map((row) => `${row.environment}:${row.dodoProductId}`)).size,
  rows.length,
);
assert.ok(rows.every((row) => ['pages', 'app_idea', 'blueprint'].includes(row.paymentOwner)));
```

- [ ] **Step 5: Run the focused inventory test and commit the evidence**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/quality/first-party-authority-inventory.test.mts
rtk git diff --check
rtk git add docs/launch/first-party-event-pipeline-evidence.md tests/quality/first-party-authority-inventory.test.mts
rtk git commit -m "docs: map first-party funnel authorities"
```

Expected: the test passes for the three Pages rows and records any absent
App-Idea/Blueprint source modules without inventing their contract.

## Task 2: Add The Canonical Event Contract And D1 Tracking Schema

**Files:**

- Create: `functions/_lib/tracking-contract.ts`
- Create: `migrations/0010_source_tracking_outbox.sql`
- Create: `workers/events/migrations/0001_tracking_ledger.sql`
- Create: `workers/events/migrations/0002_tracking_scope_hardening.sql`
- Modify: `functions/_lib/runtime.ts`
- Modify: `tests/functions/migrations.test.mts`
- Create: `tests/functions/tracking-contract.test.mts`

**Interfaces:**

- Produces `EventName`, `SourceSystem`, `CanonicalEvent`,
  `DestinationName`, `DeliveryState`, `PrivacyPurpose`, and
  `validateCanonicalEvent(input): CanonicalEvent`.
- Extends `D1Database` with
  `batch(statements): Promise<D1RunResult[]>` and preserves existing fake
  database implementations.
- Produces a Pages/business-D1 `source_tracking_outbox` table and a dedicated
  tracking-D1 schema containing:
  `tracking_visitors`, `tracking_sessions`, `tracking_aliases`,
  `tracking_events`, `tracking_outbox`, `tracking_deliveries`,
  `tracking_provider_event_mappings`,
  `tracking_buyer_context`, `tracking_purchase_browser_claims`,
  `tracking_privacy_choices`, and `tracking_suppression_tombstones`.
  It also includes `tracking_source_mappings` and `tracking_nonces` for bridge
  replay protection. The public Worker binds only the tracking D1.
  Every lookup/update carries `tenant_id` and `site_id`; composite uniqueness
  prevents cross-tenant collisions.
  The business/source runtime also owns
  `source_tracking_provider_mappings`, so duplicate provider deliveries are
  collapsed before the bridge is called.

The migration makes that scope real, not just a lookup convention:
`tracking_provider_event_mappings` includes `site_id`; source mappings include
`source_system` and `funnel_slug`; visitor/session/redirect/person/nonces use
tenant/site/issuer-scoped composite keys; and every foreign key uses the same
scope. Existing globally keyed tables are rebuilt transactionally with old-row
copy, indexes, and foreign keys preserved. The upgrade fixture applies the
previous schema with representative rows, proves the rebuild preserves them,
and proves cross-tenant/site collisions and concurrent replays are rejected.
Every canonical and source row stores `payload_hash`; a same-scoped ID with a
different hash is quarantined rather than ignored.

- [ ] **Step 1: Write failing contract tests**

```ts
test('accepts only the four version-one canonical events', () => {
  assert.equal(validateCanonicalEvent({
    schema_version: '1',
    tenant_id: 'maestro',
    site_id: 'shop',
    event_id: crypto.randomUUID(),
    event_name: 'PageView',
    source: 'browser',
    source_system: 'pages',
    occurred_at: new Date().toISOString(),
    visitor: {},
    session: {},
    page: {},
    attribution: {},
    identity: {},
    commerce: {},
    privacy: {},
  }).event_name, 'PageView');
  assert.throws(() => validateCanonicalEvent({ event_name: 'ViewContent' }));
});

test('rejects arbitrary properties and oversized attribution', () => {
  assert.throws(() => validateCanonicalEvent({ properties: { email: 'x' } }));
  assert.throws(() => validateCanonicalEvent({ attribution: { fbclid: 'x'.repeat(257) } }));
});
```

Define discriminated schemas for each event and destination projection before
serialization. Recursively reject unknown keys, raw email/phone, flow tokens,
full URLs, and nested `properties`; `envelope_json` and `payload_json` may only
contain the validated schema output.

- [ ] **Step 2: Run the migration test and observe the duplicate-0007 failure**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/migrations.test.mts tests/functions/tracking-contract.test.mts
```

Expected: the new contract is absent and migration discovery fails if it
hardcodes only one of the two existing `0007_*` files.

- [ ] **Step 3: Add the additive migrations**

The Pages/business-D1 migration begins at `0010` and adds only the bounded
source outbox:

```sql
CREATE TABLE IF NOT EXISTS source_tracking_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  funnel_slug TEXT NOT NULL,
  product_id TEXT,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS source_tracking_outbox_identity_idx
  ON source_tracking_outbox (tenant_id, site_id, source_system, source_event_id);
CREATE TABLE IF NOT EXISTS source_tracking_provider_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  source_system TEXT NOT NULL,
  funnel_slug TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, provider, provider_object_id, event_name),
  FOREIGN KEY (tenant_id, site_id, source_system, source_event_id)
    REFERENCES source_tracking_outbox(tenant_id, site_id, source_system, source_event_id)
);
CREATE INDEX IF NOT EXISTS source_tracking_outbox_due_idx
  ON source_tracking_outbox (state, next_attempt_at);
```

The dedicated tracking-D1 migration is `workers/events/migrations/0001_tracking_ledger.sql` and contains the following tables; it is never bound to the business D1:

```sql
-- workers/events/migrations/0001_tracking_ledger.sql
CREATE TABLE IF NOT EXISTS tracking_visitors (
  visitor_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  person_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_people (
  person_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_person_redirects (
  from_person_id TEXT PRIMARY KEY,
  to_person_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_identity_conflicts (
  conflict_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  left_person_id TEXT,
  right_person_id TEXT,
  state TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS tracking_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_touch_json TEXT NOT NULL,
  latest_touch_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_aliases (
  alias_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  keyed_digest TEXT NOT NULL,
  hmac_key_id TEXT NOT NULL,
  person_id TEXT,
  visitor_id TEXT,
  verification_class TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, identifier_type, issuer_namespace, normalization_version, keyed_digest)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  event_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  privacy_state_json TEXT NOT NULL,
  bot_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, event_name, event_id)
);

CREATE TABLE IF NOT EXISTS tracking_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE REFERENCES tracking_events(event_key),
  state TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_key)
);

CREATE TABLE IF NOT EXISTS tracking_provider_event_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_key TEXT NOT NULL REFERENCES tracking_events(event_key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, provider, provider_object_id, event_name)
);

CREATE TABLE IF NOT EXISTS tracking_source_mappings (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_key TEXT NOT NULL REFERENCES tracking_events(event_key),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, source_system, source_event_id)
);

CREATE TABLE IF NOT EXISTS tracking_nonces (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  source_system TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, source_system, nonce)
);

CREATE TABLE IF NOT EXISTS tracking_deliveries (
  delivery_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  destination TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_request_id TEXT,
  payload_hash TEXT,
  outcome TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_key, destination)
);

CREATE TABLE IF NOT EXISTS tracking_buyer_context (
  context_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  funnel_id TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  fbp TEXT,
  fbc TEXT,
  external_id TEXT,
  browser_ip TEXT,
  browser_user_agent TEXT,
  event_source_url TEXT,
  attribution_json TEXT NOT NULL,
  identity_hmac_json TEXT NOT NULL,
  meta_identity_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, lead_id, funnel_id)
);

CREATE TABLE IF NOT EXISTS tracking_purchase_browser_claims (
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  funnel_token_hash TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, site_id, payment_id)
);

CREATE TABLE IF NOT EXISTS tracking_privacy_choices (
  choice_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT,
  purpose TEXT NOT NULL,
  choice TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  region_source TEXT NOT NULL,
  source TEXT NOT NULL,
  supersedes_choice_key TEXT,
  effective_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_suppression_tombstones (
  suppression_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  alias_key TEXT,
  visitor_id TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retain_until TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_deletion_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  request_type TEXT NOT NULL,
  state TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  audit_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tracking_outbox_due_idx
  ON tracking_outbox (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS tracking_events_occurred_idx
  ON tracking_events (occurred_at);
```

`tracking_outbox` is one authoritative row per canonical event. The Worker
creates idempotent `tracking_deliveries` rows for `meta` and `tinybird` when it
fans the event out. Pages and Convex payment mutations insert or read the
provider mapping in the same transaction as the payment and source-outbox row;
the Worker inserts the corresponding tracking-D1 mapping, canonical event, and
outbox in one transaction. Duplicate or concurrent webhook deliveries therefore
reuse the same event key instead of minting a second Purchase.

- [ ] **Step 4: Make both migration discoverers lexical and complete**

Add `0002_tracking_scope_hardening.sql` as an executable SQLite/D1 table
rebuild (create scoped replacement, copy validated old rows, recreate indexes
and foreign keys, verify counts, then swap). It must replace the globally
scoped visitor/session/redirect/nonce/provider keys from `0001` and add
`payload_hash`, lease fencing fields, tombstone subject/retention fields, and
the scoped source uniqueness index. The migration aborts before swap on any
row-copy or scope collision; a representative backup/restore fixture proves
old rows and rollback quarantine behavior.

Replace any hardcoded migration list with:

```ts
const migrations = (await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort();
for (const migration of migrations) await applyMigration(database, migration);
```

Run this independently for the Pages/business-D1 directory and the Worker
tracking-D1 directory. The business test must assert that both
`0007_provider_neutral_email.sql` and `0007_webhook_retry_and_revocations.sql`
are applied and representative lead, funnel, payment, fulfillment, and
product rows survive. The Worker test must assert `0001_tracking_ledger.sql`
creates only tracking tables and cannot query a business table.

- [ ] **Step 5: Pass focused contract/migration checks and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/migrations.test.mts tests/functions/tracking-contract.test.mts
rtk git diff --check
rtk git add functions/_lib/tracking-contract.ts functions/_lib/runtime.ts migrations/0010_source_tracking_outbox.sql workers/events/migrations/0001_tracking_ledger.sql workers/events/migrations/0002_tracking_scope_hardening.sql tests/functions/migrations.test.mts tests/functions/tracking-contract.test.mts
rtk git commit -m "feat: add canonical tracking ledger schema"
```

## Task 3: Implement Identity, Cookie, Consent, GPC, And CORS Primitives

**Files:**

- Create: `functions/_lib/tracking-identity.ts`
- Create: `functions/_lib/tracking-privacy.ts`
- Create: `functions/_lib/tracking-cookie.ts`
- Create: `functions/_lib/tracking-cors.ts`
- Create: `tests/functions/tracking-identity.test.mts`
- Create: `tests/functions/tracking-privacy.test.mts`
- Create: `tests/functions/tracking-cookie.test.mts`

**Interfaces:**

```ts
type PrivacyPurpose = 'necessary' | 'analytics' | 'advertising' | 'identity_enrichment' | 'sale_share';
type PrivacyDecision = { purpose: PrivacyPurpose; allowed: boolean; policyVersion: string };
function issueSignedCookie(name: string, value: string, keyId: string, maxAge: number, environment: 'preview' | 'live'): string;
function verifySignedCookie(header: string | null, name: string, keys: Record<string, string>): string | null;
type StoredPrivacyChoice = { purpose: PrivacyPurpose; allowed: boolean; policyVersion: string; effectiveAt: string; source: 'ui' | 'gpc' | 'operator'; region: string };
function resolvePrivacy(request: Request, stored: StoredPrivacyChoice[], policy: { region: string; failClosed: boolean; policyVersion: string }): PrivacyDecision[];
function deriveAliasKey(input: { tenantId: string; identifierType: string; issuerNamespace: string; normalizationVersion: string; canonicalValue: string }, key: CryptoKey): Promise<string>;
function resolveIdentityClaim(input: { tenantId: string; aliasKey: string; verificationClass: 'asserted' | 'verified' | 'authoritative'; personId?: string }): Promise<{ personId: string | null; state: 'linked' | 'created' | 'conflict' }>;
function corsHeaders(origin: string | null, allowedOrigin: string): Headers;
```

- [ ] **Step 1: Write failing security/privacy tests**

Cover:

1. parent-domain `Domain=shop.maestrogtm.com`, `Secure`, `HttpOnly`,
   `SameSite=Lax`, `Path=/`, and 400-day `Max-Age`;
2. current/previous signing-key rotation and duplicate-cookie rejection;
3. no `ma_vid`/`ma_sid` before prior consent;
4. `Sec-GPC: 1`, stored opt-out, stale opt-in, withdrawal, unknown region,
   and privacy-state precedence;
5. exact credentialed CORS for `https://shop.maestrogtm.com`, rejection of
   `null`, suffix origins, wrong ports, and wrong schemes; and
6. preview cookies cannot be read or overwrite live cookies, and live parent
   cookies are issued only after the trusted-host artifact is green;
7. privacy choices use monotonic compare-and-set so stale opt-in cannot replace
   newer opt-out/GPC;
8. alias HMAC domain separation, normalization version, revocation, and
   conflict quarantine; concurrent verified claims choose one stable canonical
   person, record a redirect, and never silently merge an asserted claim.

- [ ] **Step 2: Run focused tests and confirm the primitives are absent**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/tracking-identity.test.mts tests/functions/tracking-privacy.test.mts tests/functions/tracking-cookie.test.mts
```

Expected: imports/functions are missing or the existing loose origin behavior
fails the new cases.

- [ ] **Step 3: Implement server-issued identity and fail-closed privacy**

Use `crypto.subtle` and Web Platform APIs already available in Workers. Do not
use unsalted hashes for internal aliases. Resolve verified claims in one
tracking-D1 transaction with a stable winner rule, redirect loser person IDs,
and quarantine shared/revoked/conflicting identifiers. Store the HMAC key ID
with every alias and support current/previous lookup during rotation. In
rotation, dual-read and new-key-write aliases and suppression tombstones,
backfill until zero old-key rows remain, then retire the previous key; test
lookup and deletion after retirement. In
prior-consent regions, only the
versioned privacy-choice cookie and purpose-limited checkout/security handling
are allowed. In US policy mode, configured analytics/advertising begin only
when no opt-out/GPC decision suppresses them.

```ts
const VISITOR_MAX_AGE = 34_560_000;
const SESSION_INACTIVITY_SECONDS = 1_800;
const COOKIE_DOMAIN = env.environment === 'live' ? 'shop.maestrogtm.com' : undefined;
const COOKIE_PREFIX = env.environment === 'live' ? 'ma_' : 'ma_preview_';
const GPC_HEADER = 'sec-gpc';
```

Never infer country from a browser-controlled field, and never use IP, UA,
screen size, or click IDs to merge people.

- [ ] **Step 4: Implement exact CORS and cookie deletion**

Return `Access-Control-Allow-Credentials: true`,
`Vary: Origin`, and only the exact allowlisted origin/method/header set for
the collector. The same-origin Pages browser-claim endpoint enables no CORS;
it rejects cross-origin/preflight requests and checks
`Sec-Fetch-Site: same-origin` when present.

- [ ] **Step 5: Pass focused security tests and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/tracking-identity.test.mts tests/functions/tracking-privacy.test.mts tests/functions/tracking-cookie.test.mts
rtk git diff --check
rtk git add functions/_lib/tracking-identity.ts functions/_lib/tracking-privacy.ts functions/_lib/tracking-cookie.ts functions/_lib/tracking-cors.ts tests/functions/tracking-identity.test.mts tests/functions/tracking-privacy.test.mts tests/functions/tracking-cookie.test.mts
rtk git commit -m "feat: add first-party identity and privacy primitives"
```

## Task 4: Add Pages Checkout Context, Transactional Outbox, And Browser Claims

**Files:**

- Modify: `functions/api/checkout.ts`
- Modify: `functions/api/webhooks/dodo.ts`
- Modify: `functions/api/funnel/status.ts`
- Create: `functions/api/funnel/browser-events.ts`
- Modify: `functions/_lib/funnel.ts`
- Create: `functions/_lib/source-outbox.ts`
- Modify: `tests/functions/payment.test.mts`
- Create: `tests/functions/browser-events.test.mts`
- Create: `tests/functions/source-outbox.test.mts`

**Interfaces:**

- `checkout.ts` accepts only bounded attribution and sanitized optional
  `admaxxerVisitorId`; it stores buyer context and a Lead outbox row in the
  same business-D1 batch as the accepted lead/funnel state. The row is drained
  through the authenticated source bridge; Pages never gives the public Worker
  a business-D1 binding.
- Dodo webhook processing claims ownership and stores the verified payment and
  Purchase source-outbox row in one Pages business-D1 transaction, keyed by the
  provider mapping for `payment_id`. A pending owner claim is recoverable; a
  crash after claim but before the batch cannot strand the payment or cause a
  later valid delivery to be treated as `ignored_not_owner`.
- `POST /api/funnel/browser-events` accepts the bound high-entropy flow token
  and returns a single safe Purchase browser claim; it never returns PII and
  never enables CORS.

```ts
type PurchaseCustomData = { content_ids: string[]; content_type: 'product'; value: number; currency: string; num_items: number };
type PurchaseContent = { id: string; quantity: number; item_price?: number };
type BrowserPurchaseClaim = { payment_id: string; event_id: string; custom_data: PurchaseCustomData };
type VerifiedPurchase = { payment_id: string; event_id: string; value: number; currency: string; contents: PurchaseContent[] };
function claimUnseenPurchases(trackingDb: D1Database, flowToken: string): Promise<BrowserPurchaseClaim[]>;
function toSafeBrowserPurchase(row: VerifiedPurchase): BrowserPurchaseClaim;
```

`source-outbox.ts` immediately drains committed Pages rows to the authenticated
Worker bridge and exposes a scheduled recovery scan. It uses the same
source-event ID with a fresh nonce on retries, records provider mapping reuse,
fences leases with an owner/token, and never reads tracking-D1 from the
business-D1 transaction. The source state machine is bounded and recoverable:
`pending -> sending -> accepted | retryable | permanent | expired`, with
quarantine/DLQ, backoff, maximum age, and reconciliation alert.

- [ ] **Step 1: Extend fakes and write failing checkout/webhook tests**

Add `batch()` to the fake D1 database and assert:

```ts
assert.equal(database.batches.at(-1)?.includes('source_tracking_outbox'), true);
assert.equal(database.eventsByPayment.get('pay_1')?.eventName, 'Purchase');
assert.equal(await claimBrowserEvents(requestWithFlowToken), 1);
assert.equal(await claimBrowserEvents(requestWithSameFlowToken), 0);
```

Cover checkout-provider failure after durable Lead, duplicate Dodo webhook,
duplicate and concurrent webhook deliveries with different webhook IDs mapped
to one Dodo payment, and provider-mapping reuse,
refund-before-success, base+bump aggregation, Dodo request headers excluded
from buyer context, missing/wrong flow token, cross-flow token, replay, and
cross-origin/preflight browser-claim requests.
Test immediate-drain failure, scheduled recovery, crash-before-ack, and
duplicate delivery of the same Pages source row.

- [ ] **Step 2: Run focused tests and confirm current sequential behavior fails**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/payment.test.mts tests/functions/browser-events.test.mts
```

Expected: the current checkout/webhook code has no batch/outbox and no
single-use browser claim.

- [ ] **Step 3: Implement Lead and InitiateCheckout outbox writes**

Use one business-D1 `batch()` for business-state and source-outbox rows.
Preserve existing lead/funnel IDs and provider idempotency. Lead is accepted
only if the business row and source-outbox row commit together. InitiateCheckout
is written only after Dodo returns and the session row stores a validated
checkout-session ID; the Worker bridge later creates the canonical tracking-D1
event.
If provider creation fails after Lead commit, return a named Lead payload so the
browser can emit it once; never guess an InitiateCheckout.

- [ ] **Step 4: Persist the bounded buyer context**

Include only validated latest `fbp`/`fbc`, signed external ID, browser request
IP/UA, sanitized verified source URL, attribution, capture time, approved
identity HMACs, and destination-scoped Meta hashes in `tracking_buyer_context`.
Pages invokes the pinned `meta_identity` transform version before sending the
bounded bridge envelope; the Worker validates that version and never hashes an
already-hashed value, then persists the bounded context in tracking D1. The
Worker never reads raw checkout PII. Dodo webhook request headers and Cloudflare
geo are never buyer context. Set an expiry at seven days from event occurrence.

- [ ] **Step 5: Implement one verified Purchase and one browser claim**

For each verified Dodo payment, insert or reuse the
`source_tracking_provider_mappings` row, business payment row, and
source-outbox row idempotently in one batch. The
Worker bridge inserts the canonical tracking-D1 event and one-row outbox.
Add
`POST /api/funnel/browser-events` with:

```ts
if (request.method !== 'POST' || request.headers.get('origin') !== STOREFRONT_ORIGIN) return json({ error: 'not_allowed' }, 403);
if (request.headers.get('access-control-request-method')) return json({ error: 'preflight_not_allowed' }, 403);
const flow = readBoundFlowToken(request);
const newlyClaimed = await claimUnseenPurchases(trackingDb, flow);
return json({ purchases: newlyClaimed.map(toSafeBrowserPurchase) });
```

The database claim is the correctness boundary. Reloads return no already
claimed payment. `Referrer-Policy: strict-origin` is set on every flow page.

- [ ] **Step 6: Pass payment/browser tests and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/functions/payment.test.mts tests/functions/browser-events.test.mts
rtk pnpm check:functions
rtk git diff --check
rtk git add functions/api/checkout.ts functions/api/webhooks/dodo.ts functions/api/funnel/status.ts functions/api/funnel/browser-events.ts functions/_lib/funnel.ts tests/functions/payment.test.mts tests/functions/browser-events.test.mts
rtk git commit -m "feat: make Pages conversion events transactional"
```

## Task 5: Integrate Browser Pixel, Attribution, And Collector Events

**Files:**

- Create: `src/components/FirstPartyTracking.astro`
- Modify: `src/layouts/OfferLayout.astro`
- Modify: `src/components/offers/OfferAnalytics.astro`
- Modify: `src/components/offers/OfferCheckoutDialog.astro`
- Modify: `src/components/blueprint/BlueprintFunnelRuntime.astro`
- Modify: `src/scripts/blueprint-funnel-client.ts`
- Create: `functions/api/blueprint/checkout-start.ts`
- Create: `functions/api/blueprint/checkout-status.ts`
- Create: `tests/functions/blueprint-proxy.test.mts`
- Modify: `tests/blueprint/contract.test.mts`
- Create: `tests/tracking/browser-contract.test.mts`

**Interfaces:**

```ts
type BrowserEventName = 'PageView' | 'Lead' | 'InitiateCheckout' | 'Purchase';
type BrowserCustomData = {
  content_name?: string; content_ids?: string[]; content_type?: string;
  value?: number; currency?: string; num_items?: number;
  funnel_slug?: string; offer_key?: string;
};
type BrowserTracker = {
  track(name: BrowserEventName, customData: BrowserCustomData, eventId: string): void;
  collectPageView(customData: BrowserCustomData, eventId: string): void;
};
```

- [ ] **Step 1: Write browser contract tests**

Assert one configured Meta Pixel, no implicit/unkeyed PageView, identical
PageView event ID in Pixel and collector, attribution capture for
`fbclid`/`_fbp`/`_fbc`/UTMs/referrer, no browser PII, no browser Purchase
before a verified claim, and no tracking cookie/Pixel/Tinybird before required
consent. Assert `/v1/events` rejects `Lead`, `InitiateCheckout`, and `Purchase`,
completion-page Purchase makes no collector request, and Admaxxer does not
forward Meta events.

- [ ] **Step 2: Replace the legacy Pixel boundary with one shared tracker**

The new component loads only the configured Pixel and exposes one
`eventID`-keyed PageView call. Only `collectPageView` sends the same event ID to
`https://events.shop.maestrogtm.com/v1/events` with `credentials: 'include'`.
Navigation PageViews use beacon-compatible collection. It never sends Tinybird
or credentials from the browser.

- [ ] **Step 3: Emit named Lead and InitiateCheckout payloads**

Keep the existing checkout boundary: Lead is emitted only after durable lead
acceptance, and InitiateCheckout only after the provider session is created.
The checkout response contains separate non-PII event payloads; do not reuse one
event ID for two event names.

- [ ] **Step 4: Add atomic completion-page Purchase handling**

Call `POST /api/funnel/browser-events` with the existing flow token and a
bounded event-driven retry while the source bridge is pending, then send only
newly returned purchases to Pixel. A failed Pixel call does not trigger another
claim. The canonical outbox alone drives CAPI/Tinybird, and a retry preserves
the same event ID.

All checkout-start/status proxies use POST bodies or HttpOnly-bound state for
their assertion/context token. GET query parameters, URL fragments, referrers,
and access logs must never contain a token; reject legacy GET token transport
and set `Referrer-Policy: no-referrer` on token-bearing responses.

- [ ] **Step 5: Migrate Blueprint browser checkout calls through same-origin proxies**

Replace direct browser calls to
`capabilities/billing/blueprintCheckoutStarts:start` and
`capabilities/billing/blueprintPurchases:getCheckoutStatus` with the exact
Pages proxy routes `POST /api/blueprint/checkout-start` and
`GET /api/blueprint/checkout-status`. The browser passes a short-lived
`tracking_context_token` and candidate event ID; it never sends HttpOnly
cookie values or payment state to Convex. The proxies validate the exact
Convex request/response schema, timeout and return a safe error, and include
the matching Lead/InitiateCheckout browser payload only after the source
outbox commits. Add contract assertions for direct Convex-call rejection,
token replay/alteration, and cross-origin/preflight rejection.

The App-Idea and Blueprint completion paths call the same-origin source-browser
claim endpoint added in Task 8; they never send authoritative conversion
events to `/v1/events`.

- [ ] **Step 6: Pass focused browser contracts and commit**

```bash
rtk host-test-slot --class focused pnpm test:blueprint
rtk host-test-slot --class focused node --import tsx --test tests/tracking/browser-contract.test.mts
rtk host-test-slot --class focused node --import tsx --test tests/functions/blueprint-proxy.test.mts
rtk pnpm check:functions
rtk git diff --check
rtk git add src/components/FirstPartyTracking.astro src/layouts/OfferLayout.astro src/components/offers/OfferAnalytics.astro src/components/offers/OfferCheckoutDialog.astro src/components/blueprint/BlueprintFunnelRuntime.astro src/scripts/blueprint-funnel-client.ts functions/api/blueprint/checkout-start.ts functions/api/blueprint/checkout-status.ts tests/blueprint/contract.test.mts tests/tracking/browser-contract.test.mts tests/functions/blueprint-proxy.test.mts
rtk git commit -m "feat: wire first-party browser event parity"
```

## Task 6: Build The Standalone Collector, Queue Consumer, And Privacy Routes

**Files:**

- Create: `workers/events/wrangler.jsonc`
- Create: `workers/events/src/index.ts`
- Create: `workers/events/src/collector.ts`
- Create: `workers/events/src/queue.ts`
- Create: `workers/events/src/outbox.ts`
- Create: `workers/events/src/privacy.ts`
- Create: `workers/events/src/cleanup.ts`
- Create: `workers/events/src/observability.ts`
- Create: `workers/events/tests/collector.test.mts`
- Create: `workers/events/tests/queue.test.mts`
- Create: `workers/events/tests/observability.test.mts`
- Create: `docs/launch/first-party-event-pipeline-runbook.md`
- Modify: `package.json`

**Interfaces:**

```ts
type EventsEnv = { TRACKING_DB: D1Database; EVENTS_QUEUE: Queue; EVENTS_DLQ: Queue; [key: string]: unknown };
type TrackingQueueMessage = { event_key: string; destination: 'meta' | 'tinybird'; schema_version: '1' };
export default {
  fetch(request: Request, env: EventsEnv, ctx: ExecutionContext): Promise<Response>,
  queue(batch: MessageBatch<TrackingQueueMessage>, env: EventsEnv): Promise<void>,
  scheduled(event: ScheduledEvent, env: EventsEnv, ctx: ExecutionContext): Promise<void>,
};
```

The Worker is configured as a consumer for both the main queue and the DLQ.
The handler branches on the queue name, persists a redacted DLQ record in
`TRACKING_DB`, and acknowledges only after that write succeeds; provider
automatic max-retry delivery is not treated as a durable audit by itself.

Routes:

- `GET /v1/bootstrap`: validates exact Host/Origin, resolves privacy, issues
  permitted cookies, and returns public destination-safe context.
- `POST /v1/events`: validates versioned browser events, enriches with server
  receipt/IP/UA/geo/bot state, and persists only permitted events.
- `POST /v1/privacy`: exact-origin privacy mutation with CSRF protection,
  versioned choice audit, pending-job suppression, and no account requirement.
- `POST /v1/privacy/requests`: verified access/correction/deletion request
  intake; returns only a request ID and state, never subject data.
- `POST /v1/source-events`: HMAC-authenticated source outbox bridge; it
  accepts bounded event keys/context only and rechecks tenant, audience,
  privacy, nonce, expiry, and idempotency.
- Worker-only signed `POST /internal/browser-claims`: accepts a Pages-signed
  claim request and returns newly claimed non-PII browser payloads; it is not
  exposed as a public route and cannot create canonical events.
- `GET /healthz`: no secrets, no PII, and an external-probe-safe response.

The runbook defines the initial SLOs (99.9% collector availability; 99% of
permitted advertising events resolved within five minutes; every verified
Purchase delivered, suppressed, or alerted within five minutes), alert owners,
oldest-unresolved age, Queue/DLQ growth, permanent failures, Tinybird
quarantine, verified-payment/Meta mismatch, kill-switch actions, and bounded
operator replay.

The runbook also fixes destination request timeouts, `Retry-After` handling,
jittered backoff, maximum attempts, maximum event age, and the Meta seven-day
expiry. `outcome_unknown` is terminal for automatic retry until an audited
operator replay is approved. Fan-out creates independent `meta` and `tinybird`
delivery claims atomically; one destination can never mark the canonical event
complete or suppress the other.

- [ ] **Step 1: Write failing collector and Queue tests**

Cover bootstrap cookie policy, exact CORS, body/nesting/item limits, duplicate
events, unordered Queue delivery, lease expiry, retryable/permanent outcomes,
max-retry-to-DLQ persistence, privacy tombstone replay suppression, unknown schema quarantine,
source-token forgery, verified privacy-request lookup, bounded abuse budgets, and alert payloads that contain
counts/IDs but no secrets or raw PII. Assert the health response is probe-safe.

- [ ] **Step 2: Implement fetch/queue/scheduled handlers**

Queue messages contain event keys and bounded pseudonymous context only. The
consumer creates canonical/destination rows idempotently, leases with CAS,
records `outcome_unknown` after ambiguous provider calls, and preserves the
same event/destination key on retries. The scheduled handler scans pending
outbox rows, reclaims expired leases, runs retention cleanup, and writes DLQ
failures to D1 before acknowledgement.

Enforce explicit edge/WAF rate limits before D1 access, plus bounded per-IP,
per-cookie, per-tenant, per-event, and global Queue/Meta budgets with a
documented managed-bot-score fallback. Add a
destination-spend circuit breaker and kill switch; authoritative Lead,
InitiateCheckout, and Purchase events can only enter through Pages/source
outboxes, never through the public browser collector. Tests sustain valid-cookie
abuse and prove bounded D1, Queue, and destination cost.

Persist `Sec-GPC: 1` as a versioned `gpc` privacy choice immediately, suppress
pending jobs, and have every queue consumer re-resolve the full current purpose
map (including region, source, superseded choice, and policy version) before a
destination send.

- [ ] **Step 3: Configure preview/production bindings without secrets**

`workers/events/wrangler.jsonc` binds only `TRACKING_DB`, the main Queue, and
DLQ. It contains environment-specific resource names but no business-D1
binding or tokens. Meta, Tinybird,
cookie-signing, identity-HMAC, and source-bridge keys are Worker secrets.

- [ ] **Step 4: Pass Worker focused tests and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test workers/events/tests/collector.test.mts workers/events/tests/queue.test.mts workers/events/tests/observability.test.mts
rtk pnpm exec wrangler deploy --config workers/events/wrangler.jsonc --dry-run
rtk git diff --check
rtk git add workers/events package.json
rtk git add docs/launch/first-party-event-pipeline-runbook.md
rtk git commit -m "feat: add first-party collector and queue worker"
```

The dry run is local and does not deploy; no provider mutation is authorized in
this task.

## Task 7: Add Direct Meta CAPI, Tinybird Projection, And Cleanup

**Files:**

- Create: `workers/events/src/meta.ts`
- Create: `workers/events/src/tinybird.ts`
- Create: `workers/events/src/privacy-requests.ts`
- Create: `config/destination-retry-policy.json`
- Create: `workers/events/tests/destinations.test.mts`
- Create: `workers/events/tests/privacy-requests.test.mts`
- Modify: `workers/events/src/queue.ts`
- Modify: `workers/events/src/cleanup.ts`

**Interfaces:**

```ts
type DeliveryResult = {
  state: 'accepted' | 'retryable' | 'permanent' | 'outcome_unknown';
  providerRequestId?: string;
  retryAfterSeconds?: number;
  redactedDiagnostics?: Record<string, string>;
};
function sendMeta(event: CanonicalEvent, env: EventsEnv): Promise<DeliveryResult>;
function sendTinybird(event: CanonicalEvent, env: EventsEnv): Promise<DeliveryResult>;
```

`config/destination-retry-policy.json` fixes request timeout, `Retry-After`
ceiling, jittered backoff, maximum attempts, and maximum age for each
destination. Meta events expire at seven days; Tinybird failures become
permanent after the bounded policy; ambiguous provider outcomes alert and do
not retry forever. Delivery claim completion always includes the fenced lease
token.

- [ ] **Step 1: Write redacted Meta/Tinybird fixtures first**

For each event type assert:

1. identical browser/server `(event_name,event_id,pixel_id)` pairing;
2. exact Meta email/phone/name/address normalization and one SHA-256 pass;
   source bridges carry `meta_identity_version: 'meta-v1'`, and the Worker
   rejects missing, unknown, or already-rehashed values;
3. `fbp`, `fbc`, IP, and UA are not hashed;
4. no Dodo request IP/UA/geo appears in Purchase;
5. `Customer`, internal lead UUID, raw URLs, flow tokens, and placeholder
   values are omitted; and
6. Tinybird receives only the named allowlist with canonical key.

- [ ] **Step 2: Implement the direct Meta sender**

Use the pinned Graph API version and Worker secret. Build the payload from the
canonical event plus the captured buyer context. Include `test_event_code`
only when an explicit operator validation flag is present. Never store the
access token or raw response. Live `$1` events also carry a bounded
`validation_session_id`/`is_canary` marker through Meta and Tinybird and are
excluded from campaign optimization and production KPI queries.

- [ ] **Step 3: Implement Tinybird append delivery**

Use a datasource-scoped append token, `wait=true`, bounded retries, and
quarantine invalid rows in D1. Dashboards query a deduplicated view keyed by
canonical event key; physical append uniqueness is not claimed.

- [ ] **Step 4: Implement retention and deletion**

Implement a verified access/correction/deletion/opt-out request state machine
for visitor ID, person ID, or normalized deterministic identifier. It writes a
non-identifying suppression tombstone, purges queued/retrying/DLQ tracking rows,
deletes or tombstones the named Tinybird projection according to its supported
TTL/delete mechanism, and sends a bounded source-runtime deletion request.
Verification is by the current signed visitor cookie, an authenticated source
account, or a source-runtime email/phone OTP; possession of an identifier alone
is never sufficient. Access exports are encrypted, short-lived, and delivered
only to the verified channel. Correction creates a new versioned claim and
preserves the audit trail. Select and test Tinybird's documented delete/TTL
operation; if physical deletion is unavailable, query-time tombstoning and
its expiry are recorded explicitly. Each D1, queue/DLQ, Tinybird, and source
store has a completion state and retry/failure path before the request is
complete. Audit rows contain request IDs/status only. Previously accepted Meta data is
not claimed retractable; record the provider limitation and downstream request
procedure. Each destination has a numeric completion deadline, retry/escalation
owner, capability readback, and explicit `residual_retention` outcome when
physical deletion is unsupported. Tests prove replay cannot resurrect a deleted
identity/event and a concurrent late ingestion is blocked by the tombstone
barrier.

Scheduled cleanup deletes raw retry context, Meta hashes, IP/UA, unresolved
delivery context, and existing raw webhook payloads no later than seven days
from event occurrence; diagnostics expire at ninety days, analytics at
twenty-five months, and aliases at their configured policy deadline. Privacy
tombstones override retention and prevent replay resurrection.

- [ ] **Step 5: Pass destination fixtures and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test workers/events/tests/destinations.test.mts workers/events/tests/privacy-requests.test.mts
rtk git diff --check
rtk git add workers/events/src/meta.ts workers/events/src/tinybird.ts workers/events/tests/destinations.test.mts workers/events/tests/privacy-requests.test.mts workers/events/src/queue.ts workers/events/src/cleanup.ts workers/events/src/privacy-requests.ts
rtk git commit -m "feat: deliver Meta and Tinybird events"
```

## Task 8: Wire App-Idea And Blueprint Source Outboxes

**Files in the tracking repository:**

- Create: `workers/events/src/source-bridge.ts`
- Create: `tests/tracking/source-bridge.test.mts`
- Create: `functions/api/tracking/source-browser-events.ts`
- Create: `tests/functions/source-browser-events.test.mts`
- Modify: `docs/launch/first-party-event-pipeline-evidence.md`

**Files in each discovered source repository (exact owners must be recorded by
Task 1 before edits):**

- Blueprint candidate paths:
  `packages/convex/convex/capabilities/billing/blueprintCheckoutStarts.ts`,
  `packages/convex/convex/capabilities/billing/blueprintPurchases.ts`,
  `packages/convex/convex/adapters/blueprintCheckout.ts`,
  `packages/convex/convex/adapters/dodoWebhookRoutes.ts`,
  and their adjacent tests.
- App-Idea candidate paths:
  `packages/app-idea-evaluator/src/funnelEvents.ts`,
  `apps/web/src/features/public-funnel/funnel-analytics.ts`,
  `packages/convex/confect/commerce/checkout.impl.ts`,
  `packages/convex/confect/commerce/webhooks.impl.ts`,
  `packages/integrations/src/admaxxer.ts`,
  and their adjacent tests.

If a candidate path is absent, do not create a parallel fake authority. Task 1
must replace it with the observed owning repository/path or keep that funnel
`unverified` and activation-blocked.

**Interfaces:**

```ts
type SourceEventEnvelope = {
  schema_version: '1';
  tenant_id: string;
  site_id: string;
  source_system: 'pages' | 'app_idea' | 'blueprint';
  source_event_id: string;
  event_name: 'Lead' | 'InitiateCheckout' | 'Purchase';
  occurred_at: string;
  tracking_context_token: string;
  funnel_slug: string;
  product_id?: string;
  context_ref?: string;
  lead_id?: string;
  checkout_session_id?: string;
  payment_id?: string;
  attribution?: {
    utm_source?: string; utm_medium?: string; utm_campaign?: string;
    utm_content?: string; utm_term?: string; fbclid?: string; fbp?: string; fbc?: string;
  };
  meta_identity?: {
    em?: string[]; ph?: string[]; fn?: string[]; ln?: string[];
    ct?: string[]; st?: string[]; zp?: string[]; country?: string[];
  };
  meta_identity_version?: 'meta-v1';
  privacy_snapshot: {
    purposes: Record<'necessary' | 'analytics' | 'advertising' | 'enrichment', 'granted' | 'denied' | 'unknown'>;
    policy_version: string;
    region: string;
    region_source: string;
    gpc: boolean;
    observed_at: string;
  };
  buyer_context?: {
    fbp?: string; fbc?: string; external_id?: string;
    browser_ip?: string; browser_user_agent?: string;
    event_source_url?: string; captured_at?: string;
  };
};
POST /v1/source-events
X-Maestro-Key-Id: current
X-Maestro-Timestamp: 1722643200
X-Maestro-Nonce: 32-byte-base64url
X-Maestro-Signature: base64url(HMAC-SHA256(key, `v1\\n${timestamp}\\n${nonce}\\n${sha256(body)}\\n${body}`))
```

`meta_identity` is destination-scoped, already normalized and SHA-256 hashed
by the source authority, and retained only for the seven-day retry window. It
is never copied to a generic queue, Tinybird, browser response, or log. The
Worker accepts only these named keys and rejects arbitrary identity or
attribution fields. `buyer_context` is bounded and authenticated, is persisted
only in tracking D1 for seven days, and is used to build Purchase CAPI from the
original buyer context—not Dodo request headers. It is never sent to Queue,
Tinybird, logs, or browser responses.

`privacy_snapshot` is signed and immutable for the event; the Worker applies the
more restrictive current state at delivery time but cannot reconstruct a
missing event-time decision. The source dispatcher uses states
`pending -> sending -> accepted | retryable | permanent | expired`, jittered
backoff, a bounded attempt count and maximum age, an opaque lease token, and a
source-owned quarantine/DLQ with an alert owner, reconciliation SLO, and
runbook. Every retry signs a fresh nonce; stable `source_event_id` makes a
response-loss retry idempotent. A missing or expired `context_ref` never uses
Dodo request headers: it either emits a redacted Purchase and alerts, or is
explicitly suppressed by the funnel policy.

`POST /api/tracking/source-browser-events` is same-origin/no-CORS. The Pages
proxy validates the source runtime's bound public-session token and calls a
signed Worker-only claim operation; the Worker resolves only that funnel's
verified canonical events in tracking D1, atomically claims each Purchase once,
and returns non-PII `{event_name,event_id,custom_data}` payloads. The endpoint
rejects cross-origin/preflight requests and cannot create an event without a
committed source outbox row. Pages has no tracking-D1 binding.

- [ ] **Step 1: Write failing bridge and source-outbox tests**

Assert that a source checkout/payment mutation and source outbox commit are
atomic; a crash before bridge send retries; a crash after Worker acceptance
does not duplicate D1; a forged/expired/altered token is rejected; a direct
browser Convex call cannot create an event; and reconciliation alerts when a
verified source payment lacks one D1 canonical Purchase mapping.

- [ ] **Step 2: Implement Worker-side bridge verification**

Verify issuer, audience, fixed ±5 minute timestamp skew, ten-minute nonce
uniqueness, HMAC key version, source-system allowlist (`pages`, `app_idea`,
`blueprint`), signed tenant/site/product/funnel ownership, current
privacy/tombstone state, context linkage, and source-event idempotency. Ignore
browser-provided tenant/site authority. Reject tokens in query strings and
redact token-bearing headers from access logs.

 - [ ] **Step 3: Implement Blueprint source outbox in its owning runtime**

Deploy the Worker bridge receiver first. Each source runtime then deploys a
backward-compatible producer that accepts its old browser path and the signed
path in shadow mode; only after the Pages proxy and browser flag are green may
the old direct browser call be rejected. Record the compatible source/runtime
SHA set in the evidence file.

At the mutation that durably stores the verified Dodo checkout-session ID,
write the source `InitiateCheckout` row. At the verified payment mutation,
write the source `Purchase` row with the original buyer context. Drain
source rows server-to-server with the same source event ID. Reject direct
browser checkout-start/status calls without the signed assertion.

- [ ] **Step 4: Implement App-Idea source outbox in its owning runtime**

At the durable Buildability Report/lead boundary write `Lead`. At the
verified Build Pack Dodo payment boundary write `Purchase`. Preserve the
existing entitlement/credit/fulfillment authority and add no duplicate
commerce ledger. The source row carries only the bounded signed tracking
context and provider identifiers.

- [ ] **Step 5: Add concurrent duplicate-owner and reconciliation tests**

Deliver one Dodo payment to every configured candidate webhook route
concurrently. Assert exactly one Purchase, fulfillment, and source mapping plus
one durable `ignored_not_owner`. Test crashes before bridge send, after bridge
acceptance, and before source acknowledgement.

- [ ] **Step 6: Add source browser claims and proxy contracts**

Implement `POST /api/tracking/source-browser-events` as a same-origin/no-CORS
Pages proxy to a signed Worker-only claim operation. The Worker accepts a bound
public-session token, selects only the funnel's committed source events,
atomically claims each Purchase once in the tracking D1, and returns
`{ event_name, event_id, custom_data }` with no PII.
The Blueprint checkout-start/status proxies return Lead and InitiateCheckout
payloads only after the corresponding source outbox commit. Test replay,
cross-session tokens, preflight/cross-origin requests, and the no-outbox case.

- [ ] **Step 7: Run source-repository focused gates and commit each source repo**

Owned Funnel Builder:

```bash
rtk host-test-slot --class focused pnpm test:blueprint
rtk host-test-slot --class focused pnpm test:functions
rtk pnpm typecheck
rtk host-test-slot --class focused node --import tsx --test tests/tracking/source-bridge.test.mts tests/functions/source-browser-events.test.mts
```

For each source repository, run its existing focused contract, commerce,
Convex typecheck, secret-boundary, and migration gates through its prescribed
remote/semaphore wrapper. Commit source changes separately, record exact SHAs
in the evidence file, and do not merge a tracking branch that points at an
unverified source SHA.

## Task 9: Add Deployment Manifests, Ownership Checks, And CI Gates

**Files:**

- Create: `config/dodo-funnel-ownership.json`
- Create: `tests/quality/dodo-funnel-ownership.test.mts`
- Create: `tests/quality/tracking-d1-binding.test.mts`
- Create: `config/cloudflare-event-abuse-limits.json`
- Create: `config/source-runtime-manifest.json`
- Create: `config/trusted-hosts.json`
- Create: `config/privacy-policy.json`
- Create: `config/tracking-field-policy.json`
- Modify: `wrangler.jsonc`
- Create: `workers/events/wrangler.jsonc`
- Modify: `scripts/publish-cloudflare.mjs`
- Create: `scripts/publish-events-worker.mjs`
- Create: `scripts/provision-preview-events.mjs`
- Create: `.woodpecker.yml`
- Modify: `package.json`
- Modify: `docs/launch/first-party-event-pipeline-evidence.md`

**Interfaces:**

- Ownership manifest keys `environment`, `product_id`, `product_key`,
  `funnel_slug`, `owner_runtime`, and `enabled`. Unknown/non-owned
  products fail closed.
- Pages deploy remains separate from Worker deploy. No deploy script prints
  secrets or silently changes Dodo/Meta/Tinybird configuration.
- Worker environments have separate tracking-D1/Queue/DLQ/Tinybird/destination
  secrets. Pages retains only its business-D1 binding and calls the Worker
  claim operation server-to-server; neither Pages nor the public Worker exposes
  a cross-purpose D1 binding.
- Deployment fails closed unless every source-runtime manifest row pins a
  reachable repository and exact SHA, bridge contract version, environment, and
  required focused CI status. The deploy readback verifies the SHA is reachable
  and compatible before publishing the Worker or producer.

```ts
type ProductOwner = { environment: 'preview' | 'live'; product_id: string; product_key: string; funnel_slug: string; owner_runtime: 'pages' | 'app_idea' | 'blueprint'; enabled: boolean };
function ownerFor(input: { environment: string; product_id: string }): ProductOwner;
```

- [ ] **Step 1: Write manifest and deployment tests**

```ts
assert.equal(ownerFor({ environment: 'live', product_id: 'p_owned' }).owner_runtime, 'pages');
assert.throws(() => ownerFor({ environment: 'live', product_id: 'unknown' }));
assert.equal(new Set(liveRows.map((row) => row.product_id)).size, liveRows.length);
```

Also assert the three Pages launch products, App-Idea product, and Blueprint
product are present exactly once per environment, while temporary canary IDs
are separate and disabled outside the validation window.

The abuse-limits artifact defines exact per-IP (60 requests/minute), per-signed
visitor (120 events/minute), per-tenant (10,000 events/hour), and global Queue
budgets plus the Meta spend circuit-breaker threshold. Validate the configured
Cloudflare edge rate-limit/WAF capability before any D1-backed counter and
record a redacted readback; when the
plan lacks managed bot scoring, use the documented Worker counter fallback.

- [ ] **Step 2: Add separate Worker configuration**

The Worker config binds `TRACKING_DB`, production/preview Queue and DLQ, and
scheduled execution. It references secret names only:
`META_ACCESS_TOKEN`, `TINYBIRD_APPEND_TOKEN`,
`TRACKING_COOKIE_SIGNING_KEY_CURRENT`,
`TRACKING_COOKIE_SIGNING_KEY_PREVIOUS`,
`TRACKING_IDENTITY_HMAC_KEY_CURRENT`,
`TRACKING_IDENTITY_HMAC_KEY_PREVIOUS`, `TRACKING_SOURCE_BRIDGE_KEY_CURRENT`,
`TRACKING_SOURCE_BRIDGE_KEY_PREVIOUS`, `TRACKING_CONTEXT_SIGNING_KEY_CURRENT`,
`TRACKING_CONTEXT_SIGNING_KEY_PREVIOUS`, and the Meta pixel/dataset ID. The
bridge signature covers the exact UTF-8 body bytes plus timestamp and nonce;
current/previous keys are accepted only within the bounded rotation window.
A binding/configuration test proves Pages has no `TRACKING_DB` binding and the
public Worker has no business-D1 binding; only the signed Worker claim operation
can access tracking-D1 rows.

- [ ] **Step 3: Add dry-run deployment commands**

```json
{
  "scripts": {
    "deploy:pages": "node scripts/run-friendly.mjs publish-cloudflare.mjs",
    "deploy:events:dry": "node scripts/publish-events-worker.mjs --dry-run"
  }
}
```

The Worker dry run resolves manifests and bundles but performs no remote
mutation.

Before any preview validation, the approved Woodpecker preview job runs
`node scripts/provision-preview-events.mjs --environment preview`. The script
idempotently creates/read-backs the preview business D1, tracking D1, Queue,
DLQ, Tinybird datasource, secret names, kill switches, and custom domain. The
readback proves preview and live resource IDs are distinct; it never prints
secret values and rejects a live resource ID in preview mode. A separate
`--dry-run` performs no remote mutation.

- [ ] **Step 4: Add the required Woodpecker gate**

Create the repository-local Woodpecker pipeline with one deterministic PR gate:

```yaml
steps:
  verify:
    image: node:22-bookworm
    commands:
      - npm ci
      - npm run test:functions
      - npm run test:blueprint
      - npm run test:quality
      - node --import tsx --test tests/tracking/*.test.mts workers/events/tests/*.test.mts
      - npm run format:check
      - npm run lint
      - npm run typecheck
      - npm run check:functions
      - npm run build
      - node scripts/publish-events-worker.mjs --dry-run
  preview_provision:
    image: node:22-bookworm
    commands:
      - npm ci
      - node scripts/provision-preview-events.mjs --environment preview
    when:
      event: [manual]
```

The required status is the repository's existing Woodpecker verification
status. The preview job is manual and launch-gated; it is not part of the PR
status. If the authority is configured outside this repository, Task 1 records
the exact external config owner and this file is not duplicated; the same
commands and status contract remain mandatory. The gate never receives live
provider secrets and never deploys.

The gate uses the pinned lockfile, an explicit runtime timeout, offline
fixtures, and a no-network/provider-mutation guard. Required source-runtime
focused gates plus exact-SHA and bridge-compatibility readbacks are part of the
protected status or deployment is blocked; an evidence-only green claim is not
sufficient.

- [ ] **Step 5: Pass quality and configuration gates and commit**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/quality/dodo-funnel-ownership.test.mts tests/quality/tracking-d1-binding.test.mts
rtk pnpm validate:config
rtk pnpm check:functions
rtk pnpm exec wrangler deploy --config workers/events/wrangler.jsonc --dry-run
rtk git diff --check
rtk git add config/dodo-funnel-ownership.json config/cloudflare-event-abuse-limits.json tests/quality/dodo-funnel-ownership.test.mts tests/quality/tracking-d1-binding.test.mts wrangler.jsonc workers/events/wrangler.jsonc scripts/publish-cloudflare.mjs scripts/publish-events-worker.mjs scripts/provision-preview-events.mjs package.json .woodpecker.yml docs/launch/first-party-event-pipeline-evidence.md
rtk git commit -m "ci: add first-party deployment contracts"
```

## Task 10: Preview, Fixture, And Live $1 Validation

**Files:**

- Modify: `docs/launch/first-party-event-pipeline-evidence.md`
- Create: `docs/launch/five-funnel-canary-matrix.json`
- Create: `tests/tracking/live-validation-checklist.test.mts`

**Interfaces:** Produces redacted, exact-SHA evidence for preview isolation,
fixture delivery, browser/server parity, privacy/retention, source
reconciliation, and one live $1 canary per paid stage. It consumes operator
approval and owner-entered card data only during the explicitly scheduled live
step.

- [ ] **Step 1: Run repository gates on the exact committed SHA**

```bash
rtk pnpm format:check
rtk pnpm lint
rtk pnpm typecheck
rtk host-test-slot --class focused pnpm test:functions
rtk host-test-slot --class focused pnpm test:blueprint
rtk pnpm build
rtk pnpm check:functions
rtk pnpm validate:config
```

For source repositories, run their prescribed focused and exact-SHA
Woodpecker gates. Do not deploy or configure providers when any required gate
is red.

- [ ] **Step 2: Deploy isolated preview through Woodpecker**

Deploy the exact reviewed SHA to preview with Meta delivery off and separate
D1/Queue/DLQ/Tinybird resources. Prove bootstrap, PageView, Lead,
InitiateCheckout, source bridges, Dodo signature fixtures, Queue retries,
privacy suppression, tombstones, cleanup, and no-secret/raw-PII leakage.

- [ ] **Step 3: Capture Meta/Tinybird validation evidence**

For each event and runtime path, capture a redacted Pixel network payload and
exact pre-send CAPI fixture. Assert identical
`(event_name,event_id,pixel_id)`, field normalization, buyer-context source,
Tinybird canonical key, and request/trace IDs. Meta Test Events proves receipt
only, not normalization or deduplication.

- [ ] **Step 4: Run the approved live $1 canary matrix**

Canary each named funnel and paid stage in a machine-readable
`funnel/product/stage/owner` matrix. The matrix may reference shared evidence
for an identical implementation only after a reviewer records the equivalence;
otherwise each row gets its own canary. The distinct implementations currently
expected are Pages base/bump, Pages one-click upsell, Blueprint Convex checkout,
and App-Idea checkout—using temporary
non-public live `$1` products. Use no-charge catalog checks for sibling SKUs
with the same implementation. Record redacted product ID suffix, exact
price/currency, owner runtime, manifest row, webhook, and refund owner. The
owner enters the live card in hosted Dodo checkout only after approving the
amount and test identity. Verify saved-card/one-click transition, payment
webhook, one Purchase, fulfillment, browser claim, Pixel/CAPI parity, Tinybird
row, tracking-D1 ledger, privacy state, and source reconciliation. Refund and
revoke immediately, then deactivate the canary product. Advance each funnel
independently through `shadow → test_purchase → live_purchase →
campaign_enabled`; canary rows carry `validation_session_id`/`is_canary` and are
excluded from Meta optimization and production KPI queries. An unresolved
funnel does not block an otherwise green funnel.

- [ ] **Step 5: Add no-charge real-product checks**

For each production funnel, open the real live checkout and verify product,
amount, currency, return path, and support/refund copy without submitting
payment. Mark the check `intentionally_uncharged`.

- [ ] **Step 6: Commit redacted validation evidence**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/tracking/live-validation-checklist.test.mts
rtk git diff --check
rtk git add docs/launch/first-party-event-pipeline-evidence.md docs/launch/five-funnel-canary-matrix.json tests/tracking/live-validation-checklist.test.mts
rtk git commit -m "docs: record first-party pipeline validation"
```

## Task 11: Freeze Copy, Prepare Campaigns, And Activate Per Funnel

**Files:**

- Create or update: `docs/launch/five-funnel-copy-deck.md`
- Create: `docs/launch/meta-campaign-ledger.md`
- Modify: `src/content/offers/*.json`,
  `src/content/funnels/*.json`, and source-runtime copy files only after
  owner approval
- Create: `tests/quality/five-funnel-launch-contract.test.mts`

**Interfaces:** Produces one approved copy/source map and one paused-campaign
ledger. It consumes Task 10 evidence and the existing
`docs/superpowers/plans/2026-08-02-meta-campaign-activation.md); it does not
invent a sixth funnel or activate an unverified route.

- [ ] **Step 1: Assert the five launch rows**

Each row includes route, headline, primary text, headline/description,
destination URL, UTM contract, source system, Dodo product owner, event gate,
and rollback/pause rule. The three existing Pages offer JSON files remain the
commercial source of truth; App-Idea and Blueprint copy is keyed to their
observed source-runtime files.

- [ ] **Step 2: Apply only approved copy changes**

Run the existing content/catalog generators and contract tests. Do not add
claims, guarantees, proof, or price changes outside the approved copy deck.

- [ ] **Step 3: Create campaigns paused**

Use the approved Meta Ads authority and exact destination/UTM ledger. Every
campaign remains `PAUSED` until its funnel row has green software, privacy,
delivery, live-canary, refund/revocation, and owner-evidence gates. Record
redacted campaign/ad-set/ad IDs, exact pre/post state readback, pause
acknowledgement, and the gate artifact link; never commit access tokens.

- [ ] **Step 4: Activate and monitor one funnel at a time**

Pause campaign traffic before a funnel rollback and record the provider's
acknowledged paused state. Check collection, Lead,
InitiateCheckout, Purchase, CAPI/Tinybird delivery, duplicate rate, and
payment/revenue reconciliation at 15, 30, 60 minutes, 4 hours, and 24 hours.
The global Meta kill switch is reserved for cross-funnel incidents.
The first activation includes one reversible pause/readback drill tied to that
funnel's ledger row.

- [ ] **Step 5: Commit copy and campaign evidence**

```bash
rtk host-test-slot --class focused node --import tsx --test tests/quality/five-funnel-launch-contract.test.mts
rtk git diff --check
rtk git add docs/launch/five-funnel-copy-deck.md docs/launch/meta-campaign-ledger.md src/content/offers src/content/funnels tests/quality/five-funnel-launch-contract.test.mts
rtk git commit -m "docs: record five-funnel campaign readiness"
```

## Self-Review And Review Gates

Before implementation, run a local plan audit:

```bash
rtk rg -n 'TBD|TODO|implement later|fill in|appropriate error|write tests for the above|similar to Task' docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md
rtk rg -n 'PageView|Lead|InitiateCheckout|Purchase|consent|GPC|tombstone|outbox|Convex|Blueprint|App-Idea|Dodo|Tinybird|Meta|Queue|DLQ' docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md
rtk rg -n 'payload_hash|lease_token|privacy_snapshot|retain_until|validation_session_id|source-runtime-manifest|destination-retry-policy' docs/superpowers/plans/2026-08-03-first-party-event-pipeline.md
rtk git diff --check
```

Review the plan in three independent passes before Task 2 implementation:

1. **Architecture/spec coverage:** verify every design section maps to a task,
   especially source-side Convex outboxes, Dodo ownership, at-least-once
   delivery, privacy/deletion, and browser/CAPI deduplication.
2. **Implementation/test/CI review:** verify every file path exists or is
   explicitly created, each interface matches neighboring tasks, each test
   command uses the repository's approved host/remote wrapper, and no task
   relies on a provider mutation before its gate.
3. **Security/privacy and product-ops review:** verify no raw PII/secret path,
   no unsupported identity claim, no broad global launch gate, no hidden second
   business authority, and no campaign activation without redacted evidence.
4. **Fresh review disposition:** verify trusted-host ownership/drift,
   machine-readable regional policy and field TTLs, scoped schema rebuilds and
   hash conflicts, fenced leases, source state/recovery, provider retry/deletion
   ceilings, exact source SHA compatibility, and a five-funnel canary matrix.

Resolve every Critical/Important plan finding before creating the implementation
worktree. Minor findings become a review ledger entry and are revisited in the
final branch review.

## Implementation Handoff

After plan review, create a clean implementation worktree from the recorded
Owned Funnel Builder base and separate clean worktrees for each source repo.
Use `superpowers:subagent-driven-development`: one fresh implementer per
task, task reviewer after each task, fix/re-review loops for Critical/Important
findings, then one whole-branch review from the merge base. Preserve the plan
and review packages in the progress ledger at
`.superpowers/sdd/progress.md`.

The merge order is:

1. shared contract/schema and tracking-D1 changes;
2. Worker bridge receiver and destination changes;
3. backward-compatible source-runtime producers and Pages proxies;
4. browser flag/proxy cutover, then direct-call rejection;
5. deployment/configuration checks;
6. documentation/evidence and copy ledger.

Only after all task reviews, exact-SHA focused gates, Woodpecker required checks,
and final whole-branch review are green may the normal GitHub pull request be
opened, auto-merge armed, and merge monitored. Provider/live validation remains
an explicit post-merge launch step, not a substitute for code review.

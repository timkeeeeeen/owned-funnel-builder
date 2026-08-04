# First-Party Event Pipeline and Identity Graph Design

Date: 2026-08-03  
Status: architecture approved; specialist-reviewed, owner-reviewed, and
implementation-plan reviewed

## Purpose

Build a first-party collection, identity, transformation, and delivery layer for
the five Maestro funnels. The first release must provide a high-quality Meta
Pixel plus Conversions API implementation for `PageView`, `Lead`,
`InitiateCheckout`, and `Purchase`, while creating a productizable foundation
for additional tenants and destinations.

The design follows the useful core of systems such as EdgeTag:

1. first-party browser and HTTP collection;
2. durable, deterministic identity resolution;
3. canonical event transformation;
4. parallel browser and server delivery;
5. consent and privacy-choice enforcement;
6. delivery observability and bot filtering; and
7. tenant-isolated configuration.

It does not attempt to reproduce a complete customer data platform, fifty
destination integrations, probabilistic browser fingerprinting, or a SaaS
control plane in the first release.

## Review outcome (2026-08-04)

Specialist review found the architecture directionally sound but not yet
implementation-ready. Source-runtime recovery, bounded retention, per-source
authorization, one browser-claim path, stable external IDs, and measurable
per-funnel launch gates are now explicit contract requirements. These clarify
the design; they do not add a generic CDP, probabilistic identity, or second
commercial ledger.

## First-release boundary

Ship one Maestro-owned tracking deployment for all five funnels:

- Owned Funnel Builder;
- Talking Head Video VBuilder;
- Vibe Code Anything;
- the App-Idea Evaluator/"what should I build?" offer; and
- Maestro's $5 Blueprint offer.

The funnel names above are launch scope. Slugs, product IDs, copy, and paid
stage configuration remain deployment data rather than hardcoded tracking
logic.

- the existing Cloudflare Pages project for the three Pages-owned funnels
  (Owned Funnel Builder, Talking Head Video VBuilder, and Vibe Code Anything),
  their storefront pages, checkout, payment webhooks, and authoritative
  business-state writes;
- one standalone Cloudflare Worker for the first-party collector, Queue
  consumer, scheduled outbox dispatcher, retention cleanup, Meta CAPI, and
  Tinybird delivery;
- the existing production business D1 used by Pages and its Functions, plus a
  separate production tracking D1 used by the tracking Worker and its signed
  browser-claim/bridge operations; one main Queue plus dead-letter queue, one
  Tinybird datasource, and one Meta dataset/pixel; and
- separate preview business/tracking D1s, Queue/DLQ/Tinybird/Worker stack.
  Preview never sends
  ordinary live Meta events and never becomes a second production business
  database.

The first release implements direct Meta and Tinybird senders behind one small
delivery-result type. It does not build a generic destination framework,
shared multi-tenant runtime, encrypted credential store, automated hostname
provisioner, CRM sync, or identity-resolution provider integration. Those
boundaries are revisited only when a second tenant or concrete destination
requires them.

## Goals

- Collect events through `events.shop.maestrogtm.com` under Maestro's domain.
- Maintain one consistent visitor identity across sessions for as long as the
  browser retains the server-issued first-party cookie.
- Merge anonymous history into a durable person only when an approved verified
  claim permits it.
- Deliver matching browser Pixel and server CAPI events with stable Meta
  deduplication inputs and controlled browser emission.
- Include every available field that is explicitly allowlisted and permitted by
  purpose, consent, retention, provenance, and minimization rules. Availability
  alone is never a reason to collect or forward a field.
- Preserve first-touch and latest-touch attribution.
- Make event receipt, transformation, delivery, retry, and failure inspectable.
- Keep the event contract, identity rules, cookie configuration, and
  destinations reusable for future tenants.

## Non-goals

- Re-identifying a visitor who deleted their cookie before they identify again.
- Probabilistic browser or device fingerprinting.
- Capturing payment-card data, passwords, credentials, keystrokes, arbitrary
  DOM contents, or unrelated sensitive form fields.
- Creating fake CRM contacts for anonymous traffic.
- Sending every internal interaction to every vendor without an explicit
  destination mapping.
- Building a customer-facing configuration dashboard in the first release.

## Architectural decision

Use a Cloudflare-hosted first-party collector and queue as the ingestion and
fan-out plane, D1 as the compact operational identity and delivery authority,
and Tinybird as the append-only analytics projection.

```text
shop.maestrogtm.com (existing Pages project)
  storefront + browser SDK + native Meta Pixel
  checkout + Dodo webhooks
          | authoritative business-D1 batch: business state + source outbox
          | authenticated source bridge after commit
          v
events.shop.maestrogtm.com (standalone event Worker)
  bootstrap + event collector + privacy choices
  Queue consumer + scheduled dispatcher + cleanup
          |
          v
   dedicated tracking D1 <-------- source bridge from Pages/Convex
          |
          v
Cloudflare Queue ----------------> dead-letter queue
          |
          v
identity + canonical claims + delivery leases
          |                         |
          v                         v
     Meta CAPI                  Tinybird

App-Idea commercial runtime  ---- signed source outbox bridge ----^
Blueprint commercial runtime ---- signed source outbox bridge ----^
```

The browser never receives a Tinybird token, Meta access token, or other
destination credential. It communicates only with the first-party collector.

Cloudflare Pages Functions can produce Queue messages but cannot consume them.
The standalone Worker owns the main Queue and DLQ consumers. The Worker may
expose `fetch`, `queue`, and `scheduled` handlers in the same deployment. The
exact custom domain is manually attached in Maestro's Cloudflare zone for the
first release.

Authoritative Lead, InitiateCheckout, and Purchase events use a transactional
source outbox. For Pages-owned funnels, the business-state mutation and a
bounded authenticated source-outbox row are submitted in one business-D1
`batch()` transaction. After commit, the owning source runtime drains that
row to the Worker bridge. Pages uses a private authenticated drain endpoint
plus a source-owned scheduled dispatcher; it leases rows with compare-and-set
state transitions, retries them, and acknowledges them only after the Worker
accepts the signed envelope. Convex uses an equivalent source-owned
cron/action and reconciliation job. If a source runtime is unavailable, its
rows remain durable and its own monitor alerts; the Worker's scheduled handler
scans only tracking-D1 rows and never scans a business D1. This makes recovery
executable without violating the binding boundary. The Worker writes the
canonical event and delivery outbox in the dedicated tracking D1, so a Queue
or bridge outage cannot separate a successful business mutation from its
conversion record. The public Worker never binds the business D1 or reads
leads, payments, fulfillment rows, or raw webhook payloads.

The App-Idea Evaluator and $5 Blueprint have separate commercial-state
authorities and deployments. The tracking Worker is shared; the dedicated
tracking D1 is the canonical tracking/delivery ledger, not a second source of truth for Convex
sessions, payments, or fulfillment. Each Convex authority must write a
source-side tracking outbox in the same mutation that durably records a
checkout-session or verified-payment transition, then drain that outbox to the
signed Worker bridge. If a source cannot provide that atomic outbox, the
funnel remains shadow-only until provider reconciliation proves that every
source payment maps to one tracking event.

### Source bridge trust boundary

Each source system has an environment-specific issuer and current/previous
bridge key. The signed request binds the issuer, tenant, site, source system,
funnel, owned product, timestamp, nonce, and exact body hash. The Worker checks
that tuple against the ownership manifest before accepting the envelope; a
valid Pages signature cannot authorize an App-Idea or Blueprint row. Source
outbox payloads contain only bounded event data and, for Purchase, the explicit
buyer-context allowlist plus an opaque context hash and expiry. A short-lived
`tracking_context_token` is request-only and is never
persisted in a source outbox, Queue message, log, Tinybird row, or destination
payload.

### Convex-backed funnel bridge

The App-Idea Evaluator and $5 Blueprint flows use separate deployed runtimes and
contracts. The Blueprint flow currently calls deployed Convex functions from
`src/scripts/blueprint-funnel-client.ts`, including the checkout-start and
checkout-status references. The App-Idea flow must have its own pinned client,
checkout, payment, webhook, and fulfillment contract. Their deployed function
names, argument schemas, return schemas, environments, and Dodo product
metadata must be pinned as implementation prerequisites; a missing local source
module is not a reason to guess a contract and blocks only that funnel.

Convex remains the authority for its own session, generated result, claim, and
fulfillment state. It does not become a second tracking ledger. The Worker
issues a short-lived signed opaque `tracking_context_token` with issuer,
audience, tenant/site, funnel, candidate event ID, nonce, expiry, and current
privacy state, but no raw PII or cookie value. The browser passes that token and
the candidate event ID to same-origin Pages proxy routes (for Blueprint,
`POST /api/blueprint/checkout-start` and
`POST /api/blueprint/checkout-status`). Those routes validate cookies, consent,
flow/session binding, and schema, then make the server-to-server Convex call.
Convex verifies the token signature/audience/expiry/nonce and rejects direct
browser checkout calls or altered packets. The bridge is replay-safe and the
Worker rechecks privacy and idempotency when the source outbox is drained. No
raw click ID, token, or provider context is placed in a URL, referrer, or
durable source row; cross-domain handoff uses only the short-lived opaque
context reference and field-policy-approved values. A
Convex `InitiateCheckout` is emitted only when the source mutation durably
stores a verified Dodo checkout-session ID, never when an action merely accepts
or queues a request. A verified Dodo payment emits one `Purchase` through the
single owner assigned to that product.

Every environment has one version-controlled Dodo ownership manifest keyed by
product ID. It assigns each product to exactly one commercial-state/webhook
owner; Pages and each Convex runtime fail closed for unknown or non-owned
products. Signed metadata is an input to validation, not the ownership
authority. If both runtimes receive a provider delivery, one must record an
explicit durable `ignored_not_owner` result; neither may emit a second Purchase,
fulfillment grant, or destination delivery. Reconcile the manifest against live
Dodo webhook configuration before launch. The shared uniqueness key remains
`(tenant, provider, payment_id, Purchase)` across all paths.

## Why Tinybird is not the delivery authority

Tinybird is well suited to high-volume append-only ingestion, low-latency
funnel queries, attribution analysis, and dashboards. It is not the source of
truth for transactional delivery claims or physical row uniqueness.

D1 (the dedicated tracking D1) owns:

- deterministic identity aliases;
- unique event claims;
- unique per-destination delivery claims;
- delivery attempt state and final outcomes; and
- tracking joins/indexes to leads, checkout sessions, and payments, reconciled
  against the commercial authorities.

Tinybird receives normalized, privacy-reviewed projections for analytics. A
Tinybird outage cannot block checkout or Meta. Because a crash after Tinybird
acceptance can cause the same row to be appended again, every row carries a
canonical event key and analytics queries use a deduplicated projection.

## Tenant and environment model

The initial deployment is Maestro-only. Productization initially means a
deployment per customer: separate Worker, D1, Queues, secrets, and preferably a
separate Tinybird workspace or datasource in that customer's infrastructure.
The schema still carries `tenant_id` and `site_id` so event contracts remain
portable, but no shared tenant router or control plane is built now.

Keys are explicit:

- visitor: `(tenant_id, site_id, visitor_id)`;
- person identifier: `(tenant_id, identifier_type, issuer_namespace,
  normalization_version, keyed_digest)` when cross-site identity is intended;
- event: `(tenant_id, site_id, event_name, event_id)`; and
- delivery: event key plus destination.

Schema, transform, and provider API versions are delivery metadata, not parts
of identity. The server derives tenant and site from an exact validated Host
and Origin pair and ignores browser-supplied tenant or site IDs.

Deployment configuration supplies allowed origins, hostnames, cookie policy,
regional privacy policy, public Meta dataset/pixel ID, and sender enablement.
Meta, Tinybird, cookie-signing, and identity-HMAC credentials use Cloudflare
Worker secrets, with current and previous keys where rotation requires them.
Credentials are not stored as encrypted blobs in D1 for a single tenant.

No core collector, identity, or delivery code contains a Maestro hostname,
dataset ID, offer slug, product ID, or credential. Preview and production use
separate D1 databases, Queues/DLQs, Tinybird datasources/tokens, cookie names or
scopes, and Meta delivery configuration.

The first-party domain is a launch-blocking invariant, not a deployment
preference. Every public funnel surface must either resolve under the approved
`*.shop.maestrogtm.com` same-site namespace (so the parent cookie is actually
first-party) or use its own collector hostname and host-only cookie with an
explicit, consented server-side identity handoff. CORS cannot make a cookie
first-party across unrelated registrable domains. The trusted-host artifact
records the exact browser host, collector host, cookie scope, DNS/CNAME/TLS
readback, and rejects `pages.dev`, `workers.dev`, or an unowned sibling in
live configuration.

### Required pre-launch control artifacts

The following versioned, machine-readable artifacts are launch prerequisites;
prose or an operator assertion is insufficient:

| Artifact | Required proof | Launch effect |
| --- | --- | --- |
| `config/trusted-hosts.json` | DNS, TLS, CNAME ownership, HSTS, CSP/referrer policy, no user-content sibling, no alternate `workers.dev` route, and continuous drift probe | Blocks parent-domain cookie issuance until green |
| `config/privacy-policy.json` | Per-region/state purpose decisions, unknown-region behavior, GPC/opt-out precedence, sensitive-data/minor handling, legal owner/version approval, and Meta LDU/data-processing options | Blocks the affected funnel's campaign gate |
| `config/tracking-field-policy.json` | Source, purpose, consent, destination, exact TTL, deletion path, and trust provenance for every field (including `fbclid`, `fbp`, `fbc`, IP, and UA) | Blocks collection or destination mapping for an unlisted field |
| `config/source-runtime-manifest.json` | Source repository, exact SHA, bridge contract version, environment, and required CI status | Blocks deployment when a producer is missing, unreachable, or incompatible |
| `docs/launch/provider-capability-readback.md` | Tinybird/Meta deletion capability, token scopes, log retention, DPA/subprocessor review, and per-destination deletion SLA | Blocks jurisdictions whose deletion contract is unsupported |

The host probe runs continuously after launch. HSTS, CSP, and a strict
`event_source_url` path allowlist are part of the trusted-host contract.

### Consent experience is an enforced product boundary

The privacy policy artifact is not a substitute for a user-facing control. In
prior-consent regions every launch page must present an accessible,
non-preselected consent banner before creating tracking state. It must offer
`Accept all`, `Reject all`, and `Customize` actions, describe purposes and
destinations in plain language, provide a durable way to reopen preferences,
and make the reject path no harder to use than the accept path. No tracking
request may be queued while the banner is unresolved. A recorded choice is
versioned and purpose-specific; changing the policy version or receiving GPC
re-evaluates the gates without treating an old opt-in as current consent.

Browser tests cover banner loading, keyboard/focus access, each action,
custom-purpose toggles, reopen/withdrawal, stale-policy reset, and GPC. The
launch artifact records the approved notice version and legal owner; an
unreviewed banner or missing purpose description blocks the affected funnel.

## First-party identity model

### Identity levels

1. `visitor_id` is an opaque, server-issued identifier for one browser.
2. `session_id` groups activity into a rolling visit.
3. `person_id` is a durable server-side identity created only when an approved
   identity claim exists.

Potential deterministic claims include:

- email;
- phone;
- authenticated account;
- Dodo customer;
- CRM contact; and
- a tenant-approved offline customer identifier.

Each claim records its source, issuer namespace, verification class,
normalization version, first/last seen time, provenance, and revocation state.
A value typed into a form or returned by a future resolver is an assertion, not
proof of identity. Only policy-approved verified or authoritative claims may
automatically join two existing people. A verified payment-provider customer,
authenticated account, or completed first-party verification may upgrade an
asserted claim.

Internal alias keys use tenant-scoped, domain-separated HMAC-SHA-256 rather
than Meta's unsalted SHA-256. Each alias stores the HMAC key ID and supports a
current/previous key ring during rotation so lookup, deletion tombstones, and
unmerge remain stable. Hashing is pseudonymization, not anonymization.
Meta-required hashes are created separately inside the scoped Meta transform
and retained only for its retry window.

Every visitor also receives a separately generated opaque
`visitor_external_id`, persisted with its creation key/version. It is not the
raw visitor ID and is not recomputed from a rotating HMAC key, so key rotation
cannot change Meta identity continuity. A `person_external_id` is generated
once for the canonical person and follows redirects; deleted IDs are
tombstoned and never reused. The browser may echo these values only as a
correlation hint; the server-side cookie/D1 value is authoritative and a
mismatch is ignored and alerted.

The initial implementation is one transactional alias/redirect/conflict path,
not a generic graph engine. When an incoming claim bridges two existing people,
the D1 primary either chooses a canonical winner by a stable rule and records
an auditable redirect, or quarantines the conflict. It never silently merges a
shared, mistyped, recycled, reassigned, or revoked identifier. Merge history is
idempotent and supports correction or unmerge.

IP address, user agent, screen size, geolocation, click IDs, and browser
characteristics are never sufficient to create or merge people.

### Cookie contract

The collector at `events.shop.maestrogtm.com` issues these cookies with the
explicit parent scope `Domain=shop.maestrogtm.com` so the existing Pages
checkout backend can read the same signed identity without trusting a
browser-supplied external ID. The Worker is the only signer. Pages verifies
the Worker signature with a pinned verify-only public key (or calls a private
Worker assertion endpoint if the deployed runtime cannot verify the pinned
algorithm); Pages never receives a cookie-minting secret.

- `ma_vid`: signed opaque visitor ID, `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, rolling maximum practical lifetime;
- `ma_sid`: signed session ID, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
  rolling thirty-minute inactivity window; and
- `ma_privacy`: signed privacy-choice state with the same security attributes.

The parent-domain choice makes every hostname below `shop.maestrogtm.com` part
of the cookie trust boundary. Launch therefore requires an inventory showing
that no untrusted or takeover-prone sibling hostname exists. Cookie values
include a format version, signing-key ID, cookie name, tenant, site, and
environment; the signature covers all of them, preventing a `ma_vid` token
from being replayed as `ma_sid` or across environments. Current and previous
keys are accepted during rotation; invalid or ambiguous duplicate cookie names
are rejected safely rather than selecting an attacker-controlled value.

The visitor cookie uses a rolling `Max-Age` of 34,560,000 seconds (400 days),
subject to an absolute policy-controlled identity horizon and re-consent/renewal
rule. Activity cannot refresh it indefinitely. Although a server can write a
much later calendar expiry, modern browsers may cap or purge it earlier. The
person graph, not a claimed thirty-year browser cookie, provides durable
continuity after identification.

Before required tracking consent exists, the collector may set only the
purpose-limited `ma_privacy` choice cookie. It does not set `ma_vid` or `ma_sid`
in a prior-consent region until the relevant category is granted. Cookie
deletion uses the exact original Domain, Path, and security attributes.

The browser withdrawal handler also clears first-party storage and any
browser-cleareable `_fbp`/`_fbc` state, aborts queued beacons, and disables the
Pixel before acknowledging the change. Vendor-managed cookies that cannot be
cleared remain covered by the server tombstone; no new Pixel/CAPI event may be
sent after withdrawal.

The raw visitor ID is never exposed to browser JavaScript. `GET /v1/bootstrap`
sets the cookies and returns a non-secret, destination-scoped keyed external ID
only after the required purpose is permitted; before that it returns no visitor,
session, or external ID. Browser-provided copies of that value are correlation
inputs only; the server's signed cookie is identity authority.

### Cookie deletion and returning visitors

Cookie clearing creates a new browser identity. The system neither detects the
clearing event nor reconstructs the prior visitor through fingerprinting. A
later verified identifier may link the new visitor to a retained person record,
unless the prior record was deleted, expired, revoked, or conflicts with
another claim.

### Anonymous CRM behavior

The identity store creates an anonymous visitor record on the first
purpose-permitted event. The first release does not sync anonymous visitors to
a CRM and never fabricates email contacts.

RB2B, Vector, and similar page-viewer resolution remain future work. Their
output is a provider-scoped assertion with method, source, region,
consent/legal-basis state, confidence, and expiry. It cannot create or merge a
canonical person or real CRM contact without corroboration by a verified
first-party identifier. Provider opt-out, deletion, and retention hooks are
prerequisites for activation.

## Event envelope

Every canonical event uses a versioned envelope:

```json
{
  "schema_version": "1",
  "tenant_id": "tenant",
  "site_id": "site",
  "event_id": "stable-event-id",
  "event_name": "PageView",
  "occurred_at": "2026-08-03T00:00:00.000Z",
  "source": "browser",
  "source_system": "pages",
  "visitor": {},
  "session": {},
  "page": {},
  "attribution": {},
  "device": {},
  "geo": {},
  "identity": {},
  "commerce": {},
  "privacy": {}
}
```

Each of the four event types has an explicit ingestion schema and explicit
Meta and Tinybird projections. There is no open-ended `properties` bag. A field
is collected only when its source, purpose, privacy category, retention, and
destination allowlist are defined.

Every event carries an explicit privacy snapshot: effective purpose decisions,
policy version, region and region-source, GPC observation, decision source, and
decision time. That snapshot is immutable for the event and is the input to
both source-runtime and Worker destination gating. “All available data” means
all fields on these reviewed allowlists—not arbitrary DOM, keystroke, or
unbounded interaction capture.

`source_system` is a controlled value (`pages`, `app_idea`, `blueprint`, or
the internal-only `event_worker`); it is never accepted as an unvalidated
tenant or authority selector from the browser. `event_worker` cannot submit a
source-authority Lead/InitiateCheckout/Purchase and is covered by a separate
internal-origin test.

The allowlisted context can include:

- event ID, browser time, server receipt time, source, source system, and schema
  version;
- visitor, session, person, lead, funnel, checkout, order, and payment IDs;
- sanitized landing URL, current URL, path, page title/type, referrer, and
  referring domain;
- first-touch and latest-touch `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, and `utm_term`;
- `fbclid`, `_fbp`, `_fbc`, `gclid`, `ttclid`, and `msclkid`;
- purpose-permitted language, timezone, screen dimensions, viewport dimensions,
  and user agent;
- request IP and Cloudflare country, region, city, postal code, and timezone
  when supplied by the platform and allowlisted for that event and purpose;
- offer, placement, product, content, quantity, value, and currency context;
- privacy notice version, opt-out state, GPC signal, and regional policy; and
- bot assessment and collector validation result.

URL fragments are always removed. Query parameters are removed except for an
explicit campaign/click-ID allowlist, and values are length-limited. IP-derived
geo is analytics context only; it is not repackaged as customer-supplied Meta
city, state, postal code, or country. Secrets, raw credentials, forbidden PII,
and unrelated internal fields cannot enter the queue or a destination payload.

The default policy is deny: extra click IDs, screen/viewport fields, precise
geo, and page titles are omitted unless an event-specific purpose and
destination require them. Canonical paths come from the trusted route catalog;
campaign, referrer, title, and attribution values are rejected when they match
email/phone/credential patterns, exceed bounds, or contain an unapproved
query/path. Rejection diagnostics are generic and never echo the input.

At checkout, the server persists a bounded buyer-context snapshot against the
lead/funnel: validated latest `fbp` and `fbc`, destination-safe external ID,
originating browser IP and user agent, sanitized verified-domain source URL,
attribution, capture time, and approved identity hashes. Purchase joins this
snapshot through authoritative lead/funnel metadata. The Dodo webhook's IP,
user agent, URL, and Cloudflare geo describe Dodo, not the buyer, and are
forbidden in Meta `user_data`.

The source mutation and its source-outbox row are the only atomic boundary.
Buyer context needed for a later Purchase is carried in that bounded,
expiry-bearing source row (or a source-owned context table referenced by it),
then copied into tracking D1 only after bridge acceptance. There is no claimed
cross-database transaction between business D1/Convex and tracking D1.

## Attribution

The collector records both:

- immutable first-touch attribution for the visitor; and
- replaceable latest-touch attribution for the current session.

An incoming click identifier or UTM set starts a new attributable session.
First- and latest-touch click IDs remain separate. Because Queue processing is
unordered, first/latest selection compares validated event time and then a
stable event-ID tie-breaker; it never relies on arrival order.

For Meta `user_data`, the transform uses the freshest valid browser `_fbp` and
`_fbc`. When a URL contains a newer `fbclid`, the collector derives `fbc` as
`fb.1.<first-observed-milliseconds>.<fbclid>` and replaces stale click context.
It never sends raw `fbclid` as `fbc`. `fbp`, `fbc`, IP address, and user agent
are sent in their accepted form and are never hashed. A custom external ID
complements these values; it does not replace them.

Attribution values have strict length and character limits. They are treated as
untrusted input and never interpolated into HTML, SQL, logs, or URLs without
encoding.

## Event-time rules

- The server records both `occurred_at` and immutable `received_at`.
- A PageView browser time more than five minutes in the future is replaced with
  receipt time and flagged; the untrusted original survives only in short-lived
  diagnostics.
- Lead time is the successful D1 persistence time, InitiateCheckout time is the
  provider-session creation time, and Purchase time is the verified provider
  payment occurrence time when present or the first verified webhook receipt
  otherwise. Retries never replace those times with retry time.
- Meta `event_time` is integer Unix seconds. Events older than Meta's seven-day
  acceptance window expire instead of retrying indefinitely.
- Browser/server pairs are normally emitted in the same request flow and must
  complete within Meta's 48-hour deduplication window; the operational target is
  five minutes.

## Event semantics and deduplication

### PageView

- Trigger: an actual initial page render or client-side navigation.
- Browser generates a cryptographically random event ID.
- Native Meta Pixel and the collector receive the identical event ID.
- Server CAPI enriches the event with cookie identity, IP, user agent, geo, and
  attribution.
- Pixel bootstrap initializes only the configured pixel. It emits no implicit
  or unkeyed PageView. The sole PageView call targets that pixel with the
  canonical `eventID`; a second unkeyed PageView is a test failure.

### Lead

- Trigger: a lead passes validation and is persisted.
- Browser may supply a random candidate event ID with the lead request, but the
  source runtime is the event-ID authority. It accepts the candidate only when
  it is a valid, one-time, flow-bound UUID; otherwise it mints the event ID
  after the business/outbox commit and returns that authoritative ID. A reused
  candidate with a different payload is quarantined rather than allowing
  first-writer poisoning.
- For Pages-owned funnels, the server writes the lead plus Lead outbox row in
  one D1 batch before accepting the lead.
- The checkout API returns a named, non-PII Lead browser payload. If lead
  persistence succeeds but provider checkout creation fails, the error response
  still identifies that the lead was accepted so the browser may emit the
  matching Lead once.
- Server CAPI uses authoritative email, lead, offer, placement, and identity
  data rather than trusting browser-supplied PII.

### InitiateCheckout

- Trigger: Dodo successfully creates a checkout session.
- A stored random event UUID is mapped by the unique source key
  `(tenant, provider, checkout_session_id, InitiateCheckout)`; retries read the
  existing UUID rather than minting another.
- For Pages-owned funnels, the D1 session update and InitiateCheckout outbox
  row are one batch. For Convex-owned funnels, the source mutation and source
  outbox provide the same atomic boundary. The checkout response returns
  separately named Lead and InitiateCheckout browser payloads with only event
  IDs and normalized non-PII custom data.
- App-Idea and Blueprint use the same-origin/no-CORS
  `POST /api/tracking/source-browser-events` claim route. It accepts a
  source-runtime-bound public-session token; the Pages route proxies a signed
  Worker-only claim operation. The Worker resolves only committed source
  outbox events in the tracking D1, atomically claims each Purchase once, and
  returns `{event_name,event_id,custom_data}` without PII. Pages has no tracking
  D1 binding, and the route cannot create an event when the source outbox
  transaction did not commit.
- CAPI includes authoritative cart, products, quantities, value, currency,
  checkout session, offer, and attribution.

### Purchase

- Trigger: a Dodo `payment.succeeded` webhook passes signature, catalog, cart,
  amount, currency, and revocation checks. The handler also validates the
  provider timestamp/delivery ID within a bounded freshness window (or an
  equivalent receipt-TTL when the provider omits a signed timestamp) and
  records that delivery ID before any side effect.
- A stored random event UUID is mapped by the unique source key
  `(tenant, dodo, payment_id, Purchase)`.
- For Pages-owned funnels, the verified payment state and Purchase outbox row
  commit in one D1 batch before CAPI or any other tracking side effect. For
  Convex-owned funnels, the source payment mutation and source outbox commit
  atomically; the Worker then creates the D1 canonical Purchase/outbox claim
  idempotently before delivery.
- Exactly one Purchase is emitted per Dodo payment ID. Base plus bump items in
  one Dodo payment are aggregated in that Purchase's `contents`; an upsell is a
  separate Purchase only when Dodo assigns a separate payment ID.
- Dodo minor units are converted with the repository's existing
  currency-aware conversion. `value` equals the verified payment total and the
  content quantities; currency is uppercase ISO 4217.
- A dedicated authorized `POST /api/funnel/browser-events` endpoint atomically
  creates a single browser delivery claim before returning `purchases[]`, one
  safe payload per newly verified payment. Authorization uses the existing
  high-entropy flow token, an exact allowlisted storefront `Origin`, and a
  server-side record binding that token to the funnel; `Origin` is a browser
  signal, not authentication. This same-origin Pages endpoint enables no CORS:
  it requires `POST`, rejects cross-origin and preflight requests, checks
  `Sec-Fetch-Site: same-origin` when present, and returns claims only for that
  funnel and no raw PII. Every flow page uses `Referrer-Policy: strict-origin`,
  and flow tokens never enter analytics, logs, referrers, or destination
  payloads. The existing GET status endpoint remains read-only. Reloads return
  no already-claimed Purchase. Client-side persisted guards are defense in
  depth, not the correctness boundary.
- If the one browser claim is issued but the Pixel call fails, CAPI remains the
  reliable conversion record; the server does not issue repeated browser
  Purchases and risk overcounting.

### Idempotency and delivery guarantees

D1 enforces:

- unique canonical event: `(tenant_id, site_id, event_name, event_id)`;
- unique destination delivery:
  `(tenant_id, site_id, event_name, event_id, destination)`;
- unique provider source mapping:
  `(tenant_id, provider, provider_object_id, event_name)`; and
- one active person alias per tenant-scoped claim key, subject to the conflict
  rules above.

Cloudflare Queue delivery is at least once and unordered. The consumer creates
canonical and destination rows idempotently, then uses a compare-and-set lease
state machine: `pending -> sending -> delivered | retryable | permanent |
outcome_unknown`. It skips destinations already marked delivered.

No component claims exactly-once delivery across a remote call. A worker can
crash after Meta or Tinybird accepts a request but before D1 records success.
An ambiguous retry preserves the original event name, event ID, event time, and
destination key. Meta is expected to deduplicate matching Pixel/CAPI events
when event name, event ID, pixel/dataset, and the 48-hour window match; this is
not a guarantee for two browser events. Tinybird raw ingestion may contain a
duplicate row, so its query projection deduplicates by canonical event key.

Replay is an audited operator action that reopens one failed delivery, retains
the same event ID, and refuses events blocked by a privacy tombstone or expired
Meta window. It never mints a replacement advertising conversion.

Replay, kill-switch, and deletion controls are private operator operations,
never browser or source-runtime operations. They require privileged
authentication, an actor, reason, request ID, and idempotency key; high-risk
production replay/enablement requires a second approver. Every decision is
audited, and replay after deletion or expiry is rejected.

## Meta Pixel and CAPI transform

The Meta sender owns both browser and server mappings. All four events use the
same configured pixel/dataset and `action_source: "website"`. The
`event_source_url` is the sanitized, verified Maestro page where the action
occurred, never the collector, Dodo, or webhook URL. Originating browser IP and
user agent come from the captured browser request.

The destination contract is discriminated by `event_name`; a serializer may not
attach commerce fields merely because they are available on the envelope:

| Event | Permitted Meta commerce fields |
| --- | --- |
| `PageView` | none |
| `Lead` | offer/content identifiers, content type, value, currency, quantity, `num_items`, and contents when the lead offer provides them |
| `InitiateCheckout` | checkout content identifiers, content type, value, currency, quantity, `num_items`, and contents |
| `Purchase` | order/payment identifiers, content identifiers, content type, value, currency, quantity, `num_items`, and contents |

Unknown fields, cross-event fields, `event_source_path`, and unverified URLs are
rejected before serialization. Opaque IDs use a field-specific validator that
rejects email-like and phone-like values; phone is accepted only in the
explicit identity-phone field after country-aware E.164 validation. Meta
`event_time` is an integer Unix second correlated to `occurred_at` within the
configured skew. Currency is a three-letter ISO code, paid value is finite and
positive, and quantities are non-negative integers.

The server payload includes every field present on the explicit Meta allowlist
for that event and consent state, including:

- `event_name`, `event_time`, `event_id`, `action_source`, and
  `event_source_url`;
- normalized SHA-256 email, phone, first name, last name, city, state, postal
  code, country, and other supported customer fields when actually supplied;
- destination-safe external visitor and person identifiers;
- `fbp`, `fbc`, `client_ip_address`, and `client_user_agent`;
- value, currency, order/payment ID, `content_ids`, `content_type`, `contents`,
  quantity, and `num_items` where applicable; and
- Meta test-event code only on an explicitly authorized validation event or
  session.

Each customer field follows Meta's published field-specific normalization,
then is UTF-8 SHA-256 hashed exactly once. Empty, inferred, malformed, or
placeholder values are omitted. The current Dodo placeholder name `Customer`
must never become `fn` or `ln`; internal lead UUIDs remain internal and must not
populate Meta's Lead Ads `lead_id`. `fbp`, `fbc`, client IP, and client user
agent are not hashed. Phone requires an explicit country-aware E.164 input; the
system does not guess a country code.

One shared, version-pinned server module owns normalization and exact-output
fixtures. Pages and Convex source authorities may invoke that module before
the authenticated bridge; the Worker validates the transform version and does
not hash an already-hashed field. Native
Pixel receives the corresponding browser inputs through Meta's supported
mechanism; it does not implement an independent normalization algorithm. The
Meta Graph API version and transform version are pinned and upgraded
deliberately.

The destination-safe external ID returned by bootstrap is stable for that
visitor and has an explicit browser/server parity fixture: Pixel receives the
expected browser input and CAPI receives the one-pass Meta hash of the same
canonical value. Person external ID is added only after a policy-approved
identity claim and follows the same parity rule.

`test_event_code` is never enabled for an entire tenant or ordinary production
traffic. Test Events is an inspection path, not a sandbox; validation uses only
an operator-authenticated, short-lived validation session bound to the funnel
and event IDs, and removes the code immediately afterward.

Before our sender is enabled, captured configuration evidence must show that
Admaxxer's Meta forwarding and every legacy Pixel/CAPI sender are disabled. The
first release does not implement an Admaxxer compatibility adapter. Existing
Admaxxer analytics may remain temporarily only if inspection proves that it
does not forward any event to Meta; otherwise it is disabled completely.

## Collection endpoints

### `GET /v1/bootstrap`

- validates the exact Host and allowlisted Origin pair;
- resolves regional and stored privacy state before loading destinations or
  setting tracking cookies;
- sets or refreshes only the cookies allowed for that privacy state;
- returns destination-safe visitor/session context and public destination
  configuration;
- never returns raw visitor IDs or secrets; and
- returns privacy state for browser destination gating.

### `POST /v1/events`

- accepts only versioned, allowlisted browser events such as PageView;
- limits body size, nesting, string lengths, and item counts;
- requires JSON (or the explicitly documented beacon encoding), an exact
  allowlisted Origin, and—when present—Fetch Metadata indicating same-site
  traffic; it never accepts a missing Origin for a browser mutation;
- validates origin and credentialed CORS behavior;
- adds server time, cookie identity, IP, user agent, geo, and bot assessment;
- applies privacy policy before identifiers are created, events are persisted,
  or destination jobs are created;
- durably enqueues the accepted canonical event; and
- returns an event receipt without waiting for destinations.

`POST /v1/events` rejects attempts to create authoritative Lead,
InitiateCheckout, or Purchase events. Those events arise only from the existing
Pages checkout/webhook path and its transactional outbox.

### `POST /v1/privacy`

- works before a visitor ID or account exists;
- uses exact-origin credentialed CORS plus a short-lived bootstrap-issued CSRF
  nonce bound to the signed privacy state. The nonce is required in a dedicated
  header, and Origin/Fetch-Metadata checks remain mandatory;
- records versioned purpose choices, notice/policy version, region source,
  timestamp, and current GPC state;
- returns the new effective privacy state and destination gates; and
- on withdrawal, prevents new jobs and marks undelivered prohibited jobs
  suppressed.

Cross-origin browser calls use `credentials: include`. CORS echoes only an
exact allowlisted origin, sets `Access-Control-Allow-Credentials: true` and
`Vary: Origin`, allows only minimal methods/headers, and rejects `null`, suffix
matches, wrong Host/Origin pairs, unapproved ports, and unapproved schemes.

Every cookie-authenticated mutating route also requires JSON `Content-Type`, a
bootstrap-issued short-lived anti-CSRF token (a signed double-submit token is
sufficient), and Fetch Metadata checks. Missing or invalid tokens,
ambiguous/absent Origin, and `Sec-Fetch-Site: cross-site` requests are
rejected; CORS is defense in depth, not CSRF authentication. Bootstrap,
privacy, event receipt, claim, and proxy responses are `Cache-Control:
no-store`, vary on `Origin`, `Cookie`, and `Sec-GPC`, and are excluded from CDN
caching. Access logs and diagnostics redact cookies, tokens, URLs/query
strings, IP, and provider error bodies.

## Bot and abuse protection

The collector runs behind Cloudflare's WAF and rate limiting. Origin and CORS
protect browsers but do not authenticate arbitrary HTTP clients. The collector
therefore also applies:

- strict allowed-origin checks;
- schema and size validation;
- signed cookie validation;
- per-IP, signed-cookie, event-name, tenant, and global request/cost budgets;
- Cloudflare bot score or equivalent signals when available;
- obvious automation and malformed-client classification;
- tenant-specific event allowlists;
- no-deploy switches for collector intake, Meta delivery, and replay.

Bot-classified activity remains observable in Tinybird with a bot flag when
allowed by retention policy, but is not forwarded to advertising destinations
by default.

When a managed bot score is unavailable, schema limits, signed-cookie state,
rate budgets, honeypots on authoritative forms, and anomaly thresholds remain
active. Bot output is a risk classification, not guaranteed detection. Abuse
tests must show that public collector traffic cannot forge authoritative
events or create unbounded D1, Queue, Tinybird, or Meta cost.

The deployment also has explicit spend and capacity ceilings for D1 writes,
Queue messages, Tinybird rows, and Meta calls. On breach, intake or the
affected destination enters a fail-closed/degraded state, emits an alert, and
preserves bounded outbox state for replay. Preview has zero live-destination
budget and rejects production resource identifiers. These ceilings and the
operator who can raise them are versioned in the launch evidence; a
rate-limit test alone is not evidence of cost control.

## Privacy behavior

Privacy is evaluated by purpose in both browser and server before identifiers
are created, events are persisted, native destinations are loaded, or jobs are
delivered. Initial purpose categories are necessary operations, analytics,
advertising, and identity enrichment.

Only purposes explicitly marked allowed by the approved
`config/privacy-policy.json` for the resolved jurisdiction may begin. Unknown or
low-confidence region, minor, and sensitive-data states fail closed; there is
no universal US default. `Sec-GPC: 1` is evaluated on every applicable
request; current GPC or any stored opt-out wins over stale opt-in. GPC
suppresses advertising, sale/share-classified processing, future resolver
enrichment, and similarly classified CRM sync.

For a region requiring prior consent, only the privacy-preference cookie and
purpose-limited checkout/security processing are allowed before affirmative,
versioned consent. `ma_vid`, tracking `ma_sid`, Tinybird analytics, native
pixels, CRM sync, and identity enrichment remain disabled until their required
category is granted. Failed or unknown region resolution uses the initial
deployment's fail-closed prior-consent policy.

Operational checkout, fraud, security, accounting, fulfillment, refunds, and
support records remain separate from advertising consent. A server-originated
Purchase evaluates the most restrictive of its captured event-time state and
the latest stored choice before an advertising projection is created or
delivered. The Pages checkout path uses the same policy module as the event
Worker, and a current `Sec-GPC: 1` on checkout overrides a stored opt-in. The
design does not claim one US default covers every state, sensitive-data use, or
minor.

The first release provides a documented operator workflow, not a self-service
privacy portal, for verified access, correction, deletion, and opt-out requests.
Requests can be located by visitor ID, person ID, or normalized deterministic
identifier. The runbook defines request verification, response SLA, export
schema, legal exceptions, and backup/Time Travel expiry. Deletion removes or
anonymizes tracking records in D1 and Tinybird, cancels pending deliveries, and
creates a non-identifying keyed suppression tombstone so Queue/DLQ replay or a
later alias cannot recreate the data. Restored data stays quarantined until all
post-snapshot tombstones are reapplied from the current privacy-request record.

Queue payloads contain only event keys and bounded pseudonymous context, never
raw email or phone. Messages that cannot be selectively removed are suppressed
by the tombstone and expire under the Queue retention policy. Previously
accepted destination data is deleted only where that provider exposes a
supported mechanism; the operator record states plainly when accepted Meta
data cannot be retracted and documents the downstream request procedure.

The deletion workflow also invokes authenticated, non-enumerating erasure
contracts in the Pages and Convex source authorities for source outboxes,
buyer-context snapshots, payment-linked tracking metadata, backups, and logs.
Each source returns a signed completion/exception receipt with a deadline and
legal-retention basis; missing source capability blocks that funnel. Requests
use verified operator/subject challenges and generic responses, never a
cookie/person lookup that reveals whether a record exists.

Privacy audit records retain request ID, effective choice, policy versions,
status, and timestamps—not deleted PII. Legally required transaction records
may be retained separately but cannot recreate a deleted tracking identity.

Deletion fans out through a signed, per-source deletion bridge with a subject
scope, request ID, idempotency key, bounded retry, and completion acknowledgement.
The request remains pending while any source runtime, tracking D1, or Tinybird
projection is incomplete; partial-provider deletion is recorded explicitly.
Tombstones cover visitor, person, alias, and redirected-person scope so a later
merge or replay cannot resurrect a deleted subject.

Raw card data, passwords, credentials, keystrokes, sensitive health or precise
location form fields, and arbitrary DOM text are forbidden regardless of
consent state.

## Operational storage

The dedicated tracking D1 contains compact tables for:

- visitors and rolling sessions;
- people, tenant-keyed identifier claims, aliases, redirects, and conflicts;
- authoritative event outbox rows and dispatch leases;
- canonical event claims;
- per-destination delivery claims, leases, attempts, responses, and errors;
- single-use Purchase browser-delivery claims; and
- privacy choices, suppression tombstones, and deletion audit records.

Raw email remains only in the existing purpose-authorized
checkout/fulfillment system. The public tracking Worker has no binding to that
business D1; Pages and source runtimes send bounded authenticated outbox
envelopes instead. Tracking identity tables store tenant-scoped HMAC
claims and approved provider IDs. Meta-normalized SHA-256 values live only in a
bounded retry snapshot. Raw PII never enters browser responses, generic Queue
messages, Tinybird, logs, or error metadata.

D1 retains active identity, outbox, claims, compact delivery state, and short
replay context only. Tinybird owns long-term normalized event analytics. The
tracking D1 is a tracking index/join and delivery authority; it is not
authoritative for lead, checkout, payment, or fulfillment state. Source
reconciliation proves those joins against each commercial authority. Phase 1
uses one Queue consumer concurrency, indexed cleanup queries, and a volume
estimate for the five funnels. Revisit concurrency or storage only if measured
queue latency breaches the SLO or D1 approaches half of its current platform
limit; do not add R2 or another database preemptively.

Source-runtime outbox rows have an explicit `expires_at`, `lease_until`, and
`redacted_at`. Their bounded payload is scrubbed of IP, user agent, Meta hashes,
and buyer context no later than seven days after occurrence (and sooner after
bridge acceptance when no retry is pending). Each source runtime owns that
cleanup; the tracking Worker cannot clean a business D1 it does not bind.
Canonical tracking rows use a redaction operation for expiring sensitive
envelope fields rather than leaving IP/UA or Meta hashes in a monolithic JSON
blob indefinitely. Cleanup records a watermark, oldest-expired age, and last
successful run; a missed deadline alerts.

The initial Maestro retention defaults are:

- raw retry context, including IP, user agent, and Meta-specific identity
  hashes: no later than seven days from event occurrence, whether or not a job
  resolves;
- redacted delivery attempts and diagnostics: ninety days;
- normalized Tinybird analytics events: twenty-five months;
- inactive anonymous visitor aliases: twenty-five months;
- identified customer/person aliases: no later than five years from the last
  verified interaction, unless deleted or a shorter policy applies.

Hard deadlines run from event occurrence or last verified interaction, not
from eventual delivery success. A scheduled Worker cleanup enforces them,
including existing raw webhook payloads. Privacy deletion overrides
marketing/analytics retention. Legally required accounting and transaction
records use a separate purpose and cannot extend tracking retention. Defaults
are deployment configuration, not hidden constants.

The same field-level deadlines apply to Pages/Convex source outboxes,
provider-mapping rows, canonical envelopes, Queue/DLQ copies, retry snapshots,
Worker/Cloudflare logs, Tinybird physical duplicates, exports, and backups.
Source runtimes must redact or purge buyer context, IP/UA, click IDs, and
destination hashes before their deadline and re-check suppression tombstones
before replay. Cleanup deadlines use server receipt or authoritative provider
time, never an untrusted client `occurred_at`; race tests cover cleanup that
overlaps an in-flight retry. Source-runtime deletion and backup/restore
readbacks are part of the same privacy evidence.

## Tinybird projection

Tinybird receives append-only normalized projections for:

- canonical events;
- identity-resolution updates;
- destination delivery outcomes; and
- privacy-safe diagnostic metrics.

Rows use a version-controlled field allowlist and include a deterministic
canonical key, `tenant_id`, `site_id`, event date, event name, funnel/offer,
campaign dimensions, purpose-permitted pseudonymous IDs, bot state, and
delivery state. They exclude raw PII, IP, user agent, full query strings, and
generic event properties.

Every row also carries a versioned, tenant-scoped `privacy_subject_key` (an
HMAC of visitor/person/alias subject scope). Every Tinybird pipe and dashboard
must filter against deletion tombstones or the subject key cannot be retained.
Raw `fbclid`/click IDs are short-lived operational context; long-term analytics
use a bounded or keyed projection rather than retaining raw click IDs for the
full analytics window.

The Worker uses a datasource-scoped append token and requests synchronous
ingestion acknowledgement. Invalid rows enter a D1-recorded quarantine rather
than being silently discarded. Because append can repeat after an ambiguous
failure, dashboards query a deduplicated view keyed by the canonical event key;
raw physical uniqueness is not promised. Tinybird datasource and pipe
definitions are version-controlled and promoted before a producer sends a new
schema.

Append and read/query credentials are separate least-privilege secrets. No
public pipe exposes person-level data; dashboards enforce tenant/site and
purpose filters, restrict small cohorts where required, and audit exports. The
provider capability readback covers physical duplicates, replicas, backups,
logs, deletion/TTL behavior, a numeric completion deadline, and an owner for
any residual retention.

Tinybird ingestion is an independent destination with its own retries. It is
never called directly from the browser and never gates checkout.

## First-release sender contract

The direct Meta and Tinybird senders receive a canonical event snapshot,
resolved identity view, deployment configuration, secret binding, and delivery
attempt metadata. They return one small normalized result:

- accepted, retryable failure, or permanent failure;
- provider request/trace identifier when available;
- redacted response metadata;
- retry-after information; and
- validation diagnostics.

Delivery records store envelope version, transform version, provider API
version, and a payload hash. Credentials remain sender-specific Worker secrets.
Google, TikTok, CRM, warehouse, webhook, and identity-resolution integrations
are deferred. A future CRM gets a contract based on its real OAuth, upsert,
merge, reconciliation, deletion, and backfill lifecycle rather than being
forced into an event-POST abstraction.

## Observability

Initial service targets are:

- first-party collector: 99.9% monthly availability;
- 99% of accepted, permitted advertising events delivered within five minutes,
  with suppressed or failed events resolved and alerted within five minutes;
  and
- every verified Purchase represented by a Pages D1 outbox batch or a Convex
  source outbox tied to the payment, then delivered, explicitly suppressed, or
  alerted within five minutes.

Operators can inspect, without exposing secrets or raw PII:

- events accepted by type, tenant, funnel, offer, and campaign;
- events suppressed for privacy or bot reasons;
- destination success, retry, permanent failure, and backlog counts;
- end-to-end and destination latency;
- Meta accepted-event counts, trace IDs, diagnostics, and test-event results;
- Pixel/CAPI event-ID pairing and deduplication coverage;
- presence rates for email, phone, external ID, `_fbp`, `_fbc`, IP, user agent,
  and attribution fields; and
- missing or anomalous Purchase events relative to verified Dodo payments.

The launch evidence records the five-funnel volume model (PageViews, Leads,
checkouts, payments, retry rate, and peak multiplier), source-outbox oldest
age, source-to-tracking acceptance lag, payment-to-canonical mapping lag,
Queue oldest age, cleanup watermark, and destination latency. Alert thresholds,
cadence, owner, notification route, deduplication/silence, and kill-switch
action are versioned configuration—not prose defaults—and are exercised by a
preview canary alert. Capacity is accepted only when the model and a bounded
soak demonstrate the five-minute Purchase SLO under the configured limits.

Cloudflare Queue metrics plus the D1 delivery ledger are authoritative for
backlog/failure alerts; Tinybird cannot be the only alarm path for its own
outage. An external probe checks collector health. Alerts fire for sustained
collection drops, oldest unresolved delivery age, queue/DLQ growth, permanent
failure, verified-payment/Meta mismatch, Tinybird quarantine rows, high
duplicate-claim rates, and material loss of fields that were available at the
source. Every alert names an owner, runbook, kill-switch action, and bounded
replay procedure.

## Failure behavior

- Tracking failures never prevent page rendering.
- PageView collection uses a beacon-compatible request and tolerates navigation.
- Lead is not accepted unless its business row and event outbox row commit
  together. InitiateCheckout is not recorded unless the provider session update
  and outbox row commit together.
- A provider checkout created just before a local write failure is reconciled
  by its stable lead/funnel metadata; it never causes a guessed conversion.
- Purchase delivery failure causes destination retry without repeating payment,
  fulfillment, or successful destinations.
- Invalid permanent destination payloads enter failed state with redacted
  diagnostics; they do not retry forever.
- The Worker's DLQ consumer records each unresolved failure in D1 before
  acknowledging the DLQ message. Replay requires an explicit, idempotent
  operator action and the original event ID.
- The consumer supports the current and previous envelope versions during a
  rolling deploy. Unknown versions are quarantined and alerted.
- Event ordering is never assumed. Refund-before-Purchase and stale identity
  updates are resolved from authoritative state and timestamps.
- A no-deploy Meta kill switch stops new sends while collection and the outbox
  continue, unless privacy or abuse requires intake suppression too.

## Test strategy

### Unit tests

- event schema validation and size limits;
- cookie creation, signature validation, expiry, and rolling refresh;
- exact cookie Domain/deletion attributes, duplicate-cookie rejection, and
  signing-key rotation;
- tenant-keyed identifier HMAC and Meta field-specific normalization fixtures;
- identity alias, redirect, quarantine, revocation, and unmerge rules;
- attribution first-touch/latest-touch behavior;
- Meta payload mapping for all four events;
- privacy, GPC, regional, and bot suppression;
- destination result classification; and
- event/destination idempotency keys and delivery leases.

### Integration tests

- bootstrap and credentialed CORS behavior on the first-party hostname;
- Host/Origin mismatch, `null` Origin, unapproved scheme/port, and compromised
  sibling-host cookie forgery attempts;
- D1 identity, business-state/outbox, and unique-claim batches;
- queue duplicate, unordered delivery, lease expiry, and retry behavior;
- crash windows immediately before and after each provider call and D1 status
  update;
- checkout Lead and InitiateCheckout authority boundaries;
- verified Dodo Purchase emission and refund/revocation isolation;
- webhook-only Purchase uses the captured buyer context and never Dodo request
  headers;
- one payment delivered concurrently to both candidate webhook routes, including
  crash/retry, creates one Purchase, outbox row, and fulfillment result plus one
  durable `ignored_not_owner` result;
- source-outbox crashes before bridge send, after bridge acceptance, and before
  source acknowledgement are recovered idempotently, and reconciliation alerts
  on every verified Convex payment lacking one D1 canonical mapping;
- direct browser calls to Convex and forged, altered, expired, or replayed
  bridge packets cannot create tracking events;
- browser-event cross-origin requests and preflights are rejected;
- Convex checkout-start and checkout-status contract fixtures for the
  App-Idea Evaluator and Blueprint flows;
- signed Convex-to-tracking bridge expiry, replay, origin, and idempotency;
- disjoint Dodo product ownership across Pages and Convex webhook routes; and
- one base-plus-bump payment produces one Purchase and separate payment IDs
  produce separate Purchases;
- Tinybird ingestion retry isolation; and
- no secret or raw disallowed PII in queues, logs, Tinybird, or browser
  responses.

### Browser tests

- initial PageView, navigation PageView, and beacon behavior;
- first-party cookie persistence and rolling refresh;
- `fbclid`, `_fbp`, `_fbc`, UTM, referrer, and landing-page capture;
- Pixel/CAPI shared event IDs and no implicit/unkeyed PageView;
- no Meta/Tinybird/tracking cookies before required prior consent;
- opt-out, GPC, stale consent, unknown region, and withdrawal suppression; and
- completion-page Purchase only after verified server state, with atomic
  single-use browser issuance across reloads; and
- missing-token, cross-flow token, leaked-link, and replay attempts against the
  browser-event claim endpoint.

### Data-lifecycle and abuse tests

- deletion by anonymous visitor and deterministic identifier;
- queued, retrying, DLQ, Tinybird, and replay behavior after a suppression
  tombstone;
- hard retention deadlines even for unresolved deliveries;
- concurrent writers bridging two people, duplicate messages, stale reads,
  shared/revoked identifiers, and correction/unmerge;
- PageView/Lead reversal, refund-before-Purchase, and current/previous/unknown
  envelope versions; and
- bounded storage/provider cost when public endpoints receive abusive traffic.

### Live validation

1. Use Meta Test Events only on explicit operator validation sessions for
   PageView, Lead, InitiateCheckout, and the later live Purchase canary.
2. Capture a redacted Pixel network payload and the exact pre-send CAPI fixture
   for every event. Assert field-level normalization and identical
   `(event_name, event_id, pixel_id)` pairing, and record the CAPI response and
   request/trace ID. Meta Test Events confirms browser/server receipt only; it
   does not prove normalization, match quality, or deduplication.
3. Confirm no third sender through browser network evidence and captured sender
   configuration.
4. Because Dodo test mode cannot validate the one-click upsell path, configure a
   separate temporary live `$1` product for every paid stage. Each canary product
   must exist in the local product catalog at its exact `$1` amount so webhook
   cart/amount/currency validation remains fully enabled.
5. Use the owner's live card only when supplied for the scheduled test. Mark the
   funnel flow as an explicit validation session; never weaken catalog or
   webhook validation and never use an unverified discount shortcut.
6. Confirm payment, saved-card/one-click transition, webhook, fulfillment,
   browser claim, Pixel, CAPI, Tinybird, D1 ledger, and privacy evidence for each
   stage.
7. Refund/revoke each canary immediately and verify access and event-state
   handling. A `$1` canary validates live transport and funnel chaining, not the
   production offer's catalog price; production IDs and prices receive a
   separate configuration check.
8. Complete and activate each funnel independently once its own path is green;
   all five complete paths remain the program-level launch milestone.

## Rollout

1. Add Pages/business-D1 source migrations beginning at `0010_*` and tracking-D1
   migrations beginning at `0001_*`; update each migration test to apply its
   complete lexically sorted directory, including both existing `0007_*` files
   in the business database. Record exact pending filenames and D1 Time Travel
   recovery points for both databases.
2. Pin separate deployed contracts for App-Idea and Blueprint checkout,
   payment, webhook, and fulfillment authorities, including the Blueprint
   checkout/status references, schemas, environments, and Dodo product
   metadata. Verify the signed token/bridge and source-outbox contracts before
   changing any runtime.
3. Reconcile the version-controlled Dodo product ownership manifest against
   live webhook configuration. Provision separate preview business/tracking
   D1s, Queue/DLQ, Tinybird, Worker secrets, and kill switches; additively
   migrate the production business D1 only for source-outbox rows and create
   the production tracking D1 from the tracking migrations. Attach the exact
   Worker custom domain.
4. Deploy a backward-compatible Worker in shadow mode with Meta delivery off,
   then deploy the Pages outbox/browser producer and the Convex source-outbox
   producers/bridge. Keep direct Convex browser calls accepted but shadowed
   until the same-origin proxies and signed producers are green; only then
   reject the direct path. The consumer supports the current and previous
   envelope during the rolling change, and the compatible source/runtime SHA
   set is recorded before cutover.
5. Validate collection, attribution, identity conflicts, privacy choices, GPC,
   abuse limits, retention cleanup, Tinybird deduplication, and independent
   alerts.
6. Run explicit Meta Test Events validation for the four standard events on
   each distinct runtime path, including both Convex-backed checkout paths.
7. Capture evidence that Admaxxer Meta forwarding and every legacy Pixel/CAPI
   sender for the launch products are disabled, then enable live PageView, Lead,
   and InitiateCheckout per funnel.
8. Run the approved per-stage `$1` live Purchase canaries for each funnel,
   verify browser/server pairing, source reconciliation, refund/revocation, and
   ownership evidence, then enable that funnel's production Purchase path.
9. Activate campaigns per funnel only after its event counts, diagnostics,
   buyer-context fields, delivery SLOs, privacy behavior, and owner evidence are
   green. The five-funnel rollout is complete when all five independent gates
   are green.

Rollback pauses the affected funnel's campaigns/traffic first, then disables
that funnel's Purchase/destination sender while preserving collection/outbox
state and consumer compatibility with already queued envelope versions. Use
the global Meta kill switch only for a cross-funnel incident. Do not roll back
additive D1 migrations while older code may still run.

## Acceptance criteria

- The first-party collector is served from `events.shop.maestrogtm.com`.
- Pages and each Convex source have an executable outbox drain/lease/ack/
  reconciliation owner; the Worker never scans a business D1. Source rows and
  canonical sensitive fields have enforced seven-day TTL/redaction.
- The existing Pages project writes authoritative business state plus bounded
  source-outbox rows; the standalone Worker owns collection, Queue
  consumption, scheduled dispatch, cleanup, Meta, and Tinybird and binds only
  the dedicated tracking D1, never the business D1.
- A returning browser retains one visitor identity across sessions while the
  cookie remains available.
- Cookie Domain, credentialed CORS, key rotation, privacy-gated issuance, and
  cross-subdomain trust are explicit and tested.
- Approved verified claims can alias anonymous history without probabilistic
  fingerprinting; asserted or conflicting claims cannot silently merge people.
- PageView, Lead, InitiateCheckout, and Purchase have matching browser/server
  event names and IDs where a browser counterpart exists.
- Pixel emits no implicit PageView, and Purchase browser payloads are issued by
  an atomic single-use claim so reloads cannot emit a second browser Purchase.
- Purchase CAPI uses the original buyer-context snapshot and never Dodo's
  request IP, user agent, URL, or geo.
- One Dodo payment ID creates one Purchase with verified major-unit value,
  currency, and aggregated contents.
- Each named launch funnel resolves at runtime to an explicitly owned Dodo
  product and webhook owner. Enabled Stripe checkout/webhook/sender paths for
  those products block launch; dormant, unrelated Stripe support may remain.
- App-Idea and Blueprint each have a pinned checkout, payment, webhook, and
  fulfillment contract. Their source-side outboxes and reconciliation prove
  that every verified source payment maps to exactly one tracking-D1 canonical Purchase
  or an alert.
- The deployed Blueprint checkout/status contract is pinned and its signed
  bridge token produces one idempotent InitiateCheckout only after a verified
  Dodo checkout-session ID is durably stored, with the same visitor/session,
  attribution, consent, and event-ID rules as Pages.
- The Dodo ownership manifest is version-controlled, reconciled against live
  provider configuration, and fails closed for unknown or non-owned products.
- Redacted Pixel network evidence and pre-send CAPI fixtures prove field-level
  normalization and identical `(event_name, event_id, pixel_id)` pairing for
  all four events; Meta Test Events is only receipt evidence.
- Internal aliases use tenant-scoped HMAC; Meta-specific normalized SHA-256 is
  exact, single-pass, and bounded to the retry window.
- External visitor/person IDs are persisted opaque values with versioned,
  rotation-safe continuity; cookie signatures bind name, tenant, site, and
  environment and Pages cannot mint them.
- Queue and remote delivery are described and tested as at-least-once. Every
  retry preserves the stable destination key; ambiguous outcomes are recorded,
  Meta receives the same deduplication identifiers, and Tinybird queries
  deduplicate canonical keys.
- Tinybird failure cannot block Meta, checkout, or fulfillment.
- Prior-consent regions receive no tracking cookies, Tinybird row, native pixel,
  CRM sync, or resolver call before consent. US opt-out and GPC suppress
  advertising, sale/share-classified processing, enrichment, and pending jobs.
- Prior-consent regions show an accessible, non-preselected banner with
  accept/reject/customize controls, and the unresolved state produces no
  tracking request or destination job.
- A verified operator privacy workflow covers D1, Tinybird, pending/replay
  state, suppression tombstones, retention, and documented Meta limitations.
- DSAR deletion is signed and acknowledged by every source runtime and
  projection, and tombstones cover visitor/person/alias/redirect scope.
- No forbidden data or credentials appear in browser responses, logs, D1
  tracking tables, Queue payloads, Tinybird, or destination payloads.
- Collector availability and five-minute event/Purchase resolution SLOs are
  observable through D1/Queue plus an external probe, with owned runbooks and
  no-deploy kill switches.
- Preview uses isolated business/tracking resources while production reuses
  the existing authoritative business D1 with additive source-outbox
  migrations and provisions a dedicated tracking D1. Convex business state
  remains in its existing deployments and is never copied into tracking D1 as
  a second authority.
  The Maestro deployment uses configuration and Worker secrets rather than
  hardcoded core behavior.
- A future customer can deploy an isolated stack with different hostname,
  cookie scope, dataset, token, privacy policy, and sender set without changing
  the four event or identity contracts, but no shared SaaS control plane is
  built before it is needed.

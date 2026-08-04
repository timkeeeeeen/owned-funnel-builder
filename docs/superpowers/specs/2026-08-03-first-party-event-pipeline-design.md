# First-Party Event Pipeline and Identity Graph Design

Date: 2026-08-03  
Status: architecture approved; written specification pending owner review

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

## Goals

- Collect events through `events.shop.maestrogtm.com` under Maestro's domain.
- Maintain one consistent visitor identity across sessions for as long as the
  browser retains the server-issued first-party cookie.
- Merge anonymous history into a durable person when deterministic identifiers
  become available.
- Deliver matching browser Pixel and server CAPI events with deterministic
  deduplication.
- Include every permitted, available Meta matching and event-context field.
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
shop.maestrogtm.com
  browser SDK + native destination pixels
          |
          v
events.shop.maestrogtm.com
  bootstrap + event collector + privacy choices
          |
          v
Cloudflare Queue -----> dead-letter queue
          |
          v
normalization + identity + destination transforms
     |                 |                  |
     v                 v                  v
 D1 authority      Tinybird          Meta CAPI
 identity,         analytics         and future
 idempotency,      projection        destinations
 deliveries
```

The browser never receives a Tinybird token, Meta access token, or other
destination credential. It communicates only with the first-party collector.

## Why Tinybird is not the delivery authority

Tinybird is well suited to high-volume append-only ingestion, low-latency
funnel queries, attribution analysis, and dashboards. It is not the source of
truth for transactional delivery claims or strict uniqueness.

D1 owns:

- deterministic identity aliases;
- unique event claims;
- unique per-destination delivery claims;
- delivery attempt state and final outcomes; and
- authoritative joins to leads, checkout sessions, and payments.

Tinybird receives normalized, privacy-reviewed projections for analytics. A
Tinybird outage cannot block checkout or cause Meta duplicates; its failed
delivery is retried independently.

## Tenant model

The first deployment is Maestro-only, but the data contract is tenant-aware.
Every event, identity, and delivery key includes:

- `tenant_id`;
- `site_id`; and
- `schema_version`.

Tenant configuration supplies:

- allowed origins and first-party collector hostnames;
- cookie name, scope, and retention policy;
- privacy behavior by region;
- destination enablement and transformation options;
- public destination identifiers such as Meta dataset/pixel ID; and
- encrypted server-side destination credentials.

No core collector, identity, or delivery code may contain a Maestro hostname,
dataset ID, offer slug, product ID, or provider credential. Maestro values live
in the initial tenant configuration.

The initial implementation may use one deployed tenant configuration. It must
not build the future tenant-management UI or automated customer provisioning.

## First-party identity model

### Identity levels

1. `visitor_id` is an opaque, server-issued identifier for one browser.
2. `session_id` groups activity into a rolling visit.
3. `person_id` is a durable server-side identity created or resolved when a
   deterministic identifier becomes available.

Deterministic identifiers include normalized hashes or provider IDs for:

- email;
- phone;
- authenticated account;
- Dodo customer;
- CRM contact; and
- a tenant-approved offline customer identifier.

The graph maps multiple visitor IDs and identifiers to one person. A visitor
merge must be supported by a deterministic identifier; IP address, user agent,
screen size, and browser characteristics are never sufficient to merge people.

### Cookie contract

The collector issues these cookies for `shop.maestrogtm.com`:

- `ma_vid`: signed opaque visitor ID, `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, rolling maximum practical lifetime;
- `ma_sid`: signed session ID, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
  rolling thirty-minute inactivity window; and
- `ma_privacy`: signed privacy-choice state with the same security attributes.

The visitor cookie uses a rolling `Max-Age` of 34,560,000 seconds (400 days).
Although a server can write a much later calendar expiry, modern browsers may
cap effective cookie lifetime. The collector refreshes the allowed lifetime on
valid first-party activity. The person graph, not a claimed thirty-year browser
cookie, provides durable continuity after identification.

The raw visitor ID is never exposed to browser JavaScript. `GET /v1/bootstrap`
sets the cookies and returns a non-secret, destination-safe external ID derived
from the visitor ID for native browser destinations.

### Cookie deletion and returning visitors

Cookie deletion creates a new visitor ID. The system does not resurrect the old
ID through fingerprinting. If the visitor later supplies a known email, phone,
account, payment, or CRM identifier, the new visitor aliases to the existing
person and the known history becomes connected again.

### Anonymous CRM behavior

The identity store creates an anonymous visitor profile on the first valid
event. A future CRM adapter may sync that visitor immediately when the target
CRM supports anonymous or custom objects. It must not create fabricated email
contacts. When identity enrichment or a direct submission supplies a verified
identifier, the adapter upserts the corresponding real contact and records the
visitor-to-contact alias.

RB2B-, Vector-, or similar page-viewer resolution is a future enrichment
adapter. Resolver output must record provider, timestamp, source event,
confidence, and the exact identifier used for a deterministic merge. It is not
part of the first implementation.

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
  "visitor": {},
  "session": {},
  "page": {},
  "attribution": {},
  "device": {},
  "geo": {},
  "identity": {},
  "commerce": {},
  "privacy": {},
  "properties": {}
}
```

Common context includes every available, permitted field:

- event ID, browser time, server receipt time, source, and schema version;
- visitor, session, person, lead, funnel, checkout, order, and payment IDs;
- landing URL, current URL, path, page title/type, referrer, referring domain;
- first-touch and latest-touch `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, and `utm_term`;
- `fbclid`, `_fbp`, `_fbc`, `gclid`, `ttclid`, and `msclkid`;
- language, timezone, screen dimensions, viewport dimensions, user agent;
- request IP and Cloudflare country, region, city, postal code, and timezone
  when supplied by the platform and permitted for the destination;
- offer, placement, product, content, quantity, value, and currency context;
- privacy notice version, opt-out state, GPC signal, and regional policy; and
- bot assessment and collector validation result.

Destination transforms receive the canonical envelope and emit only fields
accepted by that destination. Secrets, raw credentials, and unrelated internal
fields cannot enter a destination payload.

## Attribution

The collector records both:

- immutable first-touch attribution for the visitor; and
- replaceable latest-touch attribution for the current session.

An incoming click identifier or UTM set starts a new attributable session. The
original `fbclid` and its derived `_fbc` are preserved with receipt time. The
system also reads Meta's `_fbp` and `_fbc` cookies when present. A custom
visitor external ID complements `_fbp`, `_fbc`, and `fbclid`; it does not
replace them.

Attribution values have strict length and character limits. They are treated as
untrusted input and never interpolated into HTML, SQL, logs, or URLs without
encoding.

## Event semantics and deduplication

### PageView

- Trigger: an actual initial page render or client-side navigation.
- Browser generates a cryptographically random event ID.
- Native Meta Pixel and the collector receive the identical event ID.
- Server CAPI enriches the event with cookie identity, IP, user agent, geo, and
  attribution.

### Lead

- Trigger: a lead passes validation and is persisted.
- Browser supplies a random candidate event ID with the lead request.
- The server validates and persists it before accepting the lead.
- Browser Pixel uses the same ID after the valid submission path.
- Server CAPI uses authoritative email, lead, offer, placement, and identity
  data rather than trusting browser-supplied PII.

### InitiateCheckout

- Trigger: Dodo successfully creates a checkout session.
- Event ID derives from the provider checkout-session identity plus event type.
- The checkout response returns the destination-safe event ID for browser
  Pixel delivery.
- CAPI includes authoritative cart, products, quantities, value, currency,
  checkout session, offer, and attribution.

### Purchase

- Trigger: a Dodo `payment.succeeded` webhook passes signature, catalog, cart,
  amount, currency, and revocation checks.
- Event ID derives from Dodo payment ID plus event type.
- CAPI delivery occurs only after the verified payment is durably recorded.
- Browser Pixel emits Purchase only after a secure funnel-status response
  confirms the same payment and exposes the destination-safe event ID.
- Base, bump, and upsell payments remain separate purchases when Dodo issues
  separate payment IDs.

### Uniqueness

D1 enforces:

- unique canonical event: `(tenant_id, event_name, event_id)`;
- unique destination delivery:
  `(tenant_id, event_name, event_id, destination)`; and
- one current person alias for each deterministic identifier within a tenant.

Queue delivery is at least once. Duplicate queue messages find the existing
claim and cannot create a second Meta event or analytics row.

## Meta Pixel and CAPI transform

The Meta destination owns both browser and server mappings.

The server payload includes all available supported fields, including:

- `event_name`, `event_time`, `event_id`, `action_source`, and
  `event_source_url`;
- normalized SHA-256 email, phone, first name, last name, city, state, postal
  code, country, and other supported customer fields when actually supplied;
- destination-safe external visitor and person identifiers;
- `_fbp`, `_fbc`, client IP address, and client user agent;
- value, currency, order/payment ID, content IDs, content type, contents,
  quantity, and item count where applicable; and
- Meta test-event code only while a tenant is in validation mode.

Normalization and hashing happen in one shared server transform. Browser code
does not implement a second hashing standard. The Meta Graph API version is
pinned in tenant configuration and upgraded deliberately.

Admaxxer may remain enabled as a comparison analytics destination. Its Meta
forwarding must be disabled unless it demonstrably uses the exact same Meta
event names and event IDs. The initial cutover assumes our Meta destination is
the only server-side sender.

## Collection endpoints

### `GET /v1/bootstrap`

- validates the allowed origin;
- sets or refreshes first-party cookies;
- returns destination-safe visitor/session context and public destination
  configuration;
- never returns raw visitor IDs or secrets; and
- returns privacy state for browser destination gating.

### `POST /v1/events`

- accepts only versioned, allowlisted browser event names;
- limits body size, nesting, string lengths, and item counts;
- validates origin and credentialed CORS behavior;
- adds server time, cookie identity, IP, user agent, geo, and bot assessment;
- applies privacy policy before creating destination jobs;
- durably enqueues the accepted canonical event; and
- returns an event receipt without waiting for destinations.

Authoritative server events from checkout and Dodo webhooks use an internal
function or authenticated server endpoint and do not round-trip through an
untrusted browser payload.

## Bot and abuse protection

The collector runs behind Cloudflare's WAF and rate limiting. It applies:

- strict allowed-origin checks;
- schema and size validation;
- signed cookie validation;
- request-rate and event-rate limits;
- Cloudflare bot score or equivalent signals when available;
- obvious automation and malformed-client classification; and
- tenant-specific event allowlists.

Bot-classified activity remains observable in Tinybird with a bot flag when
allowed by retention policy, but is not forwarded to advertising destinations
by default.

## Privacy behavior

For US visitors, first-party collection and configured advertising delivery
begin immediately unless the visitor has opted out or sends Global Privacy
Control. The site provides an accurate privacy notice and a working privacy
choice, not a choice that is ignored.

For visitors in regions requiring prior advertising consent, advertising
destinations remain disabled until the required choice exists. Operational
checkout, fraud, security, and fulfillment records remain separate from
advertising consent.

The pipeline must support:

- suppression before destination delivery;
- deletion or anonymization by deterministic identifier;
- an audit record of privacy-choice changes;
- tenant-specific retention rules; and
- destination-specific deletion workflows when those adapters are added.

Raw card data, passwords, credentials, keystrokes, sensitive health or precise
location form fields, and arbitrary DOM text are forbidden regardless of
consent state.

## Operational storage

D1 contains compact tables for:

- tenants/sites used by the deployed configuration;
- visitors and rolling sessions;
- people and hashed deterministic identifiers;
- visitor-to-person aliases;
- canonical event claims;
- per-destination delivery claims, attempts, responses, and errors; and
- privacy choices and deletion audit records.

Raw email remains in the existing checkout/fulfillment system only where
needed. Tracking identity tables store normalized hashes and provider IDs.
Request IP and user agent may be retained only for the configured retry and
diagnostic window, then removed or anonymized.

The initial Maestro retention defaults are:

- raw retry context, including IP and user agent: seven days after final
  destination resolution;
- redacted delivery attempts and diagnostics: ninety days;
- normalized Tinybird analytics events: twenty-five months; and
- inactive visitor/person aliases: five years unless a privacy deletion,
  contractual requirement, or separate customer-record rule requires earlier
  removal or longer retention.

These are tenant configuration values, not constants in collector logic.

## Tinybird projection

Tinybird receives append-only normalized projections for:

- canonical events;
- identity-resolution updates;
- destination delivery outcomes; and
- privacy-safe diagnostic metrics.

Rows include `tenant_id`, `site_id`, event date, event name, funnel/offer,
campaign dimensions, visitor/person pseudonymous IDs, bot state, and delivery
state. Tinybird powers real-time funnel, attribution, EMQ-input completeness,
deduplication, failure, and latency dashboards.

Tinybird ingestion is an independent destination with its own retries. It is
never called directly from the browser and never gates checkout.

## Destination contract

A destination adapter receives:

- canonical event envelope;
- resolved identity view;
- tenant destination configuration;
- a scoped credential accessor; and
- delivery attempt metadata.

It returns a normalized result containing:

- accepted, retryable failure, or permanent failure;
- provider request/trace identifier when available;
- redacted response metadata;
- retry-after information; and
- validation diagnostics.

The first release implements Meta CAPI and Tinybird. Admaxxer remains an
optional compatibility adapter. Google, TikTok, LinkedIn, CRM, warehouse,
webhook, and identity-resolution providers are later adapters using the same
contract.

## Observability

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

Alerts fire for sustained collection drops, queue backlog, destination failure,
missing Purchase delivery, high duplicate-claim rates, and material loss of
match-quality fields.

## Failure behavior

- Tracking failures never prevent page rendering.
- PageView collection uses a beacon-compatible request and tolerates navigation.
- Lead and InitiateCheckout event failures do not invalidate an otherwise valid
  checkout, but produce retryable operational records and alerts.
- Purchase delivery failure causes destination retry without repeating payment,
  fulfillment, or successful destinations.
- Invalid permanent destination payloads enter failed state with redacted
  diagnostics; they do not retry forever.
- Dead-lettered events remain inspectable and replay requires an explicit,
  idempotent operator action.

## Test strategy

### Unit tests

- event schema validation and size limits;
- cookie creation, signature validation, expiry, and rolling refresh;
- deterministic identifier normalization and hashing;
- identity alias and merge rules;
- attribution first-touch/latest-touch behavior;
- Meta payload mapping for all four events;
- privacy, GPC, regional, and bot suppression;
- destination result classification; and
- event/destination idempotency keys.

### Integration tests

- bootstrap and credentialed CORS behavior on the first-party hostname;
- D1 identity and unique-claim transactions;
- queue duplicate delivery and retry behavior;
- checkout Lead and InitiateCheckout authority boundaries;
- verified Dodo Purchase emission and refund/revocation isolation;
- Tinybird ingestion retry isolation; and
- no secret or raw disallowed PII in logs, Tinybird, or browser responses.

### Browser tests

- initial PageView, navigation PageView, and beacon behavior;
- first-party cookie persistence and rolling refresh;
- `fbclid`, `_fbp`, `_fbc`, UTM, referrer, and landing-page capture;
- Pixel/CAPI shared event IDs;
- opt-out and GPC suppression; and
- completion-page Purchase only after verified server state.

### Live validation

1. Use Meta Test Events for PageView, Lead, and InitiateCheckout.
2. Confirm browser/server pairing and one deduplicated result per event.
3. Inspect every available matching field and normalization result.
4. Run one approved live `$1` Dodo Purchase canary.
5. Confirm payment, webhook, fulfillment, Pixel, CAPI, Tinybird, and delivery
   ledger evidence.
6. Refund and revoke the test purchase immediately.
7. Repeat for every paid funnel stage before enabling ads.

## Rollout

1. Deploy collector, identity cookies, D1 migrations, Queue, and Tinybird in
   shadow mode with external advertising delivery disabled.
2. Validate collection, attribution, identity, privacy choices, bot filtering,
   and dashboards.
3. Enable Meta Test Events for the four standard events.
4. Remove or disable legacy Meta senders and Admaxxer Meta forwarding.
5. Enable live PageView, Lead, and InitiateCheckout delivery.
6. Run the approved `$1` Purchase canary and verify deduplication.
7. Roll out to the remaining funnels and stages.
8. Activate paid campaigns only after event counts, diagnostics, identity
   fields, delivery health, refund/revocation behavior, and owner evidence are
   green.

## Acceptance criteria

- The first-party collector is served from `events.shop.maestrogtm.com`.
- A returning browser retains one visitor identity across sessions while the
  cookie remains available.
- Deterministic identification aliases anonymous history to one person without
  probabilistic fingerprinting.
- PageView, Lead, InitiateCheckout, and Purchase have matching browser/server
  event names and IDs where a browser counterpart exists.
- Meta Test Events shows all available supported matching and commerce fields.
- Queue retries and duplicate messages cannot produce duplicate destination
  deliveries.
- Tinybird failure cannot block Meta, checkout, or fulfillment.
- Opt-out and GPC choices suppress advertising delivery.
- No forbidden data or credentials appear in browser responses, logs, D1
  tracking tables, Tinybird, or destination payloads.
- The Maestro deployment is configured through tenant/site data rather than
  hardcoded core behavior.
- A future tenant can use a different hostname, cookie scope, dataset, token,
  privacy policy, and destination set without changing the event or identity
  contracts.

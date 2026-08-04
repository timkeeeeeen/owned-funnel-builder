import { cleanString, type D1Database, type D1PreparedStatement, type Environment } from './runtime.ts';

export type PurchaseContent = { id: string; quantity: number; item_price?: number };
export type PurchaseCustomData = {
  content_ids: string[];
  content_type: 'product';
  value: number;
  currency: string;
  num_items: number;
};
export type BrowserPurchaseClaim = {
  payment_id: string;
  event_id: string;
  custom_data: PurchaseCustomData;
};
export type VerifiedPurchase = {
  payment_id: string;
  event_id: string;
  value: number;
  currency: string;
  contents: PurchaseContent[];
};

export type SourceOutboxEvent = {
  tenantId: string;
  siteId: string;
  sourceEventId: string;
  eventName: 'Lead' | 'InitiateCheckout' | 'Purchase';
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
};

export type SourceOutboxKey = Pick<SourceOutboxEvent, 'tenantId' | 'siteId' | 'sourceEventId'>;

type SourceOutboxRow = {
  tenant_id: string;
  site_id: string;
  source_event_id: string;
  payload_json: string;
  lease_owner?: string | null;
};

type SourceBridge = { fetch(request: Request): Promise<Response> };
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function toSafeBrowserPurchase(row: unknown): BrowserPurchaseClaim | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const input = row as Record<string, unknown>;
  const paymentId = cleanString(input.payment_id, 180);
  const eventId = cleanString(input.event_id, 180);
  if (!paymentId || !eventId) return null;
  if ('custom_data' in input) {
    const custom = input.custom_data;
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return null;
    const data = custom as Record<string, unknown>;
    const contentIds = Array.isArray(data.content_ids)
      ? data.content_ids.map((id) => cleanString(id, 180)).filter(Boolean)
      : [];
    const currency = cleanString(data.currency, 3).toUpperCase();
    if (
      !contentIds.length ||
      data.content_type !== 'product' ||
      typeof data.value !== 'number' ||
      !Number.isFinite(data.value) ||
      !/^[A-Z]{3}$/.test(currency) ||
      typeof data.num_items !== 'number' ||
      !Number.isSafeInteger(data.num_items) ||
      data.num_items < 1
    )
      return null;
    return {
      payment_id: paymentId,
      event_id: eventId,
      custom_data: {
        content_ids: contentIds,
        content_type: 'product',
        value: data.value,
        currency,
        num_items: data.num_items,
      },
    };
  }
  const verified = input as unknown as VerifiedPurchase;
  if (
    typeof verified.value !== 'number' ||
    !Number.isFinite(verified.value) ||
    !Array.isArray(verified.contents)
  )
    return null;
  const contentIds = verified.contents.map((item) => cleanString(item?.id, 180)).filter(Boolean);
  const currency = cleanString(verified.currency, 3).toUpperCase();
  const numItems = verified.contents.reduce(
    (total, item) => total + (typeof item?.quantity === 'number' ? item.quantity : 0),
    0
  );
  if (!contentIds.length || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(numItems) || numItems < 1)
    return null;
  return {
    payment_id: paymentId,
    event_id: eventId,
    custom_data: {
      content_ids: contentIds,
      content_type: 'product',
      value: verified.value,
      currency,
      num_items: numItems,
    },
  };
}

export async function claimUnseenPurchases(
  flowToken: string,
  signedWorkerClaim: (flowToken: string) => Promise<BrowserPurchaseClaim[]>
): Promise<BrowserPurchaseClaim[]> {
  return signedWorkerClaim(flowToken);
}

export async function sourcePayloadHash(payload: Record<string, unknown>): Promise<string> {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonicalize(entry)])
      );
    }
    return value;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(payload)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function sourceOutboxStatement(
  database: D1Database,
  event: SourceOutboxEvent
): D1PreparedStatement {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(event.occurredAt) + SEVEN_DAYS_MS).toISOString();
  return database
    .prepare(
      `INSERT INTO source_tracking_outbox (
        tenant_id, site_id, source_event_id, source_system, event_name, payload_json, payload_hash,
        state, next_attempt_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pages', ?, ?, ?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(tenant_id, site_id, source_event_id) DO UPDATE SET
        state = CASE WHEN source_tracking_outbox.payload_hash = excluded.payload_hash
          THEN source_tracking_outbox.state ELSE 'quarantined' END,
        last_error = CASE WHEN source_tracking_outbox.payload_hash = excluded.payload_hash
          THEN source_tracking_outbox.last_error ELSE 'source_event_payload_conflict' END,
        updated_at = excluded.updated_at`
    )
    .bind(
      event.tenantId,
      event.siteId,
      event.sourceEventId,
      event.eventName,
      JSON.stringify(event.payload),
      event.payloadHash,
      now,
      expiresAt,
      now,
      now
    );
}

export function providerMappingStatement(
  database: D1Database,
  event: SourceOutboxEvent,
  provider: string,
  providerObjectId: string,
  claimOwner: string,
  claimUntil: string
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO source_tracking_provider_mappings (
        tenant_id, site_id, provider, provider_object_id, event_name, source_event_id,
        claim_owner, claim_until, claim_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?)`
    )
    .bind(
      event.tenantId,
      event.siteId,
      provider,
      providerObjectId,
      event.eventName,
      event.sourceEventId,
      claimOwner,
      claimUntil,
      new Date().toISOString()
    );
}

export function commitProviderMappingStatement(
  database: D1Database,
  event: SourceOutboxEvent,
  provider: string,
  providerObjectId: string,
  claimOwner: string
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE source_tracking_provider_mappings
       SET claim_owner = NULL, claim_until = NULL, claim_state = 'committed'
       WHERE tenant_id = ? AND site_id = ? AND provider = ?
         AND provider_object_id = ? AND event_name = ? AND source_event_id = ?
         AND claim_owner = ?`
    )
    .bind(
      event.tenantId,
      event.siteId,
      provider,
      providerObjectId,
      event.eventName,
      event.sourceEventId,
      claimOwner
    );
}

function bridge(env: Environment): SourceBridge | null {
  const value = env.TRACKING_SOURCE_BRIDGE;
  return value &&
    typeof value === 'object' &&
    'fetch' in value &&
    cleanString(env.TRACKING_SOURCE_BRIDGE_TOKEN, 4096)
    ? (value as SourceBridge)
    : null;
}

function bridgeHeaders(env: Environment): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Authorization', `Bearer ${cleanString(env.TRACKING_SOURCE_BRIDGE_TOKEN, 4096)}`);
  return headers;
}

export async function drainSourceEvent(
  database: D1Database,
  env: Environment,
  event: SourceOutboxKey,
  owner = crypto.randomUUID()
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT tenant_id, site_id, source_event_id, payload_json, lease_owner FROM source_tracking_outbox
       WHERE tenant_id = ? AND site_id = ? AND source_event_id = ?
         AND state IN ('pending', 'retryable', 'sending')
         AND expires_at > ?`
    )
    .bind(event.tenantId, event.siteId, event.sourceEventId, new Date().toISOString())
    .first<SourceOutboxRow>();
  if (!row) return false;

  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 60_000).toISOString();
  const claimed = await database
    .prepare(
      `UPDATE source_tracking_outbox
       SET state = 'sending', lease_owner = ?, lease_until = ?, attempt_count = attempt_count + 1,
           updated_at = ?
       WHERE (tenant_id = ? AND site_id = ? AND source_event_id = ?
              AND state IN ('pending', 'retryable'))
          OR (tenant_id = ? AND site_id = ? AND source_event_id = ?
              AND state = 'sending' AND lease_until < ?)`
    )
    .bind(
      owner,
      leaseUntil,
      now,
      event.tenantId,
      event.siteId,
      event.sourceEventId,
      event.tenantId,
      event.siteId,
      event.sourceEventId,
      now
    )
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        `INSERT INTO source_tracking_delivery_audit (
          tenant_id, site_id, source_event_id, owner, result, created_at
        ) VALUES (?, ?, ?, ?, 'ignored_not_owner', ?)`
      )
      .bind(row.tenant_id, row.site_id, event.sourceEventId, owner, now)
      .run();
    return false;
  }

  const sourceBridge = bridge(env);
  if (!sourceBridge) {
    await database
      .prepare(
        `UPDATE source_tracking_outbox SET state = 'retryable', lease_owner = NULL, lease_until = NULL,
         next_attempt_at = ?, last_error = 'source_bridge_unconfigured', updated_at = ?
         WHERE tenant_id = ? AND site_id = ? AND source_event_id = ? AND lease_owner = ?`
      )
      .bind(
        new Date(Date.now() + 60_000).toISOString(),
        now,
        event.tenantId,
        event.siteId,
        event.sourceEventId,
        owner
      )
      .run();
    return false;
  }

  try {
    const response = await sourceBridge.fetch(
      new Request('https://tracking.internal/private/source-events', {
        method: 'POST',
        headers: bridgeHeaders(env),
        body: row.payload_json,
      })
    );
    if (!response.ok) throw new Error(`bridge_${response.status}`);
    const accepted = await database
      .prepare(
        `UPDATE source_tracking_outbox SET state = 'delivered', bridge_accepted_at = ?,
         payload_json = '{}', redacted_at = ?, lease_owner = NULL, lease_until = NULL,
         last_error = NULL, updated_at = ?
         WHERE tenant_id = ? AND site_id = ? AND source_event_id = ? AND lease_owner = ?`
      )
      .bind(now, now, now, event.tenantId, event.siteId, event.sourceEventId, owner)
      .run();
    return (accepted.meta?.changes ?? 0) === 1;
  } catch (error) {
    await database
      .prepare(
        `UPDATE source_tracking_outbox SET state = 'retryable', lease_owner = NULL, lease_until = NULL,
         next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE tenant_id = ? AND site_id = ? AND source_event_id = ? AND lease_owner = ?`
      )
      .bind(
        new Date(Date.now() + 60_000).toISOString(),
        error instanceof Error ? error.message.slice(0, 500) : 'bridge_error',
        now,
        event.tenantId,
        event.siteId,
        event.sourceEventId,
        owner
      )
      .run();
    return false;
  }
}

/** Pages-owned scheduled recovery; tracking D1 remains private to the Worker. */
export async function recoverSourceOutbox(database: D1Database, env: Environment): Promise<number> {
  const now = new Date().toISOString();
  await database
    .prepare(
      `UPDATE source_tracking_outbox
       SET state = 'expired', payload_json = '{}', redacted_at = COALESCE(redacted_at, ?),
           lease_owner = NULL, lease_until = NULL, updated_at = ?
       WHERE expires_at <= ? AND state NOT IN ('delivered', 'expired')`
    )
    .bind(now, now, now)
    .run();
  const rows = await database
    .prepare(
      `SELECT tenant_id, site_id, source_event_id FROM source_tracking_outbox
       WHERE (state IN ('pending', 'retryable') AND next_attempt_at <= ?
              OR state = 'sending' AND lease_until < ?)
         AND expires_at > ?
       ORDER BY outbox_id ASC LIMIT 50`
    )
    .bind(now, now, now)
    .all<{ tenant_id: string; site_id: string; source_event_id: string }>();
  let delivered = 0;
  for (const row of rows.results ?? []) {
    if (
      await drainSourceEvent(database, env, {
        tenantId: row.tenant_id,
        siteId: row.site_id,
        sourceEventId: row.source_event_id,
      })
    )
      delivered += 1;
  }
  return delivered;
}

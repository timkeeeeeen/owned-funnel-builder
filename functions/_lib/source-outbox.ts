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

type SourceOutboxRow = {
  tenant_id: string;
  site_id: string;
  source_event_id: string;
  payload_json: string;
  lease_owner?: string | null;
};

type SourceBridge = { fetch(request: Request): Promise<Response> };
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function toSafeBrowserPurchase(row: VerifiedPurchase | BrowserPurchaseClaim): BrowserPurchaseClaim {
  if ('custom_data' in row) return row;
  return {
    payment_id: cleanString(row.payment_id, 180),
    event_id: cleanString(row.event_id, 180),
    custom_data: {
      content_ids: row.contents.map((item) => cleanString(item.id, 180)).filter(Boolean),
      content_type: 'product',
      value: row.value,
      currency: cleanString(row.currency, 3).toUpperCase(),
      num_items: row.contents.reduce((total, item) => total + item.quantity, 0),
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
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
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
  providerObjectId: string
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO source_tracking_provider_mappings (
        tenant_id, site_id, provider, provider_object_id, event_name, source_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      event.tenantId,
      event.siteId,
      provider,
      providerObjectId,
      event.eventName,
      event.sourceEventId,
      new Date().toISOString()
    );
}

function bridge(env: Environment): SourceBridge | null {
  const value = env.TRACKING_SOURCE_BRIDGE;
  return value && typeof value === 'object' && 'fetch' in value ? (value as SourceBridge) : null;
}

function bridgeHeaders(env: Environment): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = cleanString(env.TRACKING_SOURCE_BRIDGE_TOKEN, 4096);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function drainSourceEvent(
  database: D1Database,
  env: Environment,
  sourceEventId: string,
  owner = crypto.randomUUID()
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT tenant_id, site_id, source_event_id, payload_json, lease_owner FROM source_tracking_outbox
       WHERE source_event_id = ? AND state IN ('pending', 'retryable', 'sending')
         AND expires_at > ?`
    )
    .bind(sourceEventId, new Date().toISOString())
    .first<SourceOutboxRow>();
  if (!row) return false;

  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 60_000).toISOString();
  const claimed = await database
    .prepare(
      `UPDATE source_tracking_outbox
       SET state = 'sending', lease_owner = ?, lease_until = ?, attempt_count = attempt_count + 1,
           updated_at = ?
       WHERE (source_event_id = ? AND state IN ('pending', 'retryable'))
          OR (source_event_id = ? AND state = 'sending' AND lease_until < ?)`
    )
    .bind(owner, leaseUntil, now, sourceEventId, sourceEventId, now)
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    await database
      .prepare(
        `INSERT INTO source_tracking_delivery_audit (
          tenant_id, site_id, source_event_id, owner, result, created_at
        ) VALUES (?, ?, ?, ?, 'ignored_not_owner', ?)`
      )
      .bind(row.tenant_id, row.site_id, sourceEventId, owner, now)
      .run();
    return false;
  }

  const sourceBridge = bridge(env);
  if (!sourceBridge) {
    await database
      .prepare(
        `UPDATE source_tracking_outbox SET state = 'retryable', lease_owner = NULL, lease_until = NULL,
         next_attempt_at = ?, last_error = 'source_bridge_unconfigured', updated_at = ?
         WHERE source_event_id = ? AND lease_owner = ?`
      )
      .bind(new Date(Date.now() + 60_000).toISOString(), now, sourceEventId, owner)
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
         last_error = NULL, updated_at = ? WHERE source_event_id = ? AND lease_owner = ?`
      )
      .bind(now, now, now, sourceEventId, owner)
      .run();
    return (accepted.meta?.changes ?? 0) === 1;
  } catch (error) {
    await database
      .prepare(
        `UPDATE source_tracking_outbox SET state = 'retryable', lease_owner = NULL, lease_until = NULL,
         next_attempt_at = ?, last_error = ?, updated_at = ? WHERE source_event_id = ? AND lease_owner = ?`
      )
      .bind(
        new Date(Date.now() + 60_000).toISOString(),
        error instanceof Error ? error.message.slice(0, 500) : 'bridge_error',
        now,
        sourceEventId,
        owner
      )
      .run();
    return false;
  }
}

/** Pages-owned scheduled recovery; tracking D1 remains private to the Worker. */
export async function recoverSourceOutbox(database: D1Database, env: Environment): Promise<number> {
  const rows = await database
    .prepare(
      `SELECT source_event_id FROM source_tracking_outbox
       WHERE state IN ('pending', 'retryable') AND next_attempt_at <= ? AND expires_at > ?
       ORDER BY outbox_id ASC LIMIT 50`
    )
    .bind(new Date().toISOString(), new Date().toISOString())
    .all<{ source_event_id: string }>();
  let delivered = 0;
  for (const row of rows.results ?? []) {
    if (await drainSourceEvent(database, env, row.source_event_id)) delivered += 1;
  }
  return delivered;
}

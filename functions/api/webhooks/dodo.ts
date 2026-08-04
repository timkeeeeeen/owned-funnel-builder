import DodoPayments from 'dodopayments';

import { getProductDefinition } from '../../_generated/funnels';
import { recordAdmaxxerPayment } from '../../_lib/admaxxer';
import { minorUnitsToMajor } from '../../_lib/admaxxer';
import { deliverPurchase } from '../../_lib/fulfillment';
import {
  cleanString,
  json,
  readEnvironmentValue,
  type D1Database,
  type Environment,
  type PagesContext,
} from '../../_lib/runtime';
import {
  commitProviderMappingStatement,
  drainSourceEvent,
  providerMappingStatement,
  sourceOutboxStatement,
  sourcePayloadHash,
} from '../../_lib/source-outbox';

interface PaymentEventData {
  payment_id?: unknown;
  payment_method_id?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  status?: unknown;
  metadata?: unknown;
  customer?: { customer_id?: unknown; email?: unknown } | null;
  customer_id?: unknown;
  product_cart?: unknown;
}

interface OfferProductRow {
  dodo_product_id: string;
  price_amount: number;
  currency: string;
}

interface WebhookPayload {
  type?: unknown;
  data?: PaymentEventData;
}

type DodoWebhookResult = 'processed' | 'busy';
const WEBHOOK_STALE_AFTER_MS = 5 * 60 * 1000;
const WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60;

function metadataRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cleanString(item, 500)] as const)
      .filter(([, item]) => item)
  );
}

async function markPaymentFailed(
  database: D1Database,
  metadata: Record<string, string>
): Promise<void> {
  const now = new Date().toISOString();
  if (metadata.step_key && metadata.funnel_id) {
    await database
      .prepare(
        `UPDATE funnel_step_runs
         SET status = 'failed', updated_at = ?
         WHERE funnel_id = ? AND step_key = ? AND status = 'charging'`
      )
      .bind(now, metadata.funnel_id, metadata.step_key)
      .run();
    return;
  }

  if (metadata.funnel_id) {
    await database
      .prepare(
        `UPDATE funnel_runs SET base_status = 'failed', updated_at = ?
         WHERE id = ? AND base_status = 'pending'`
      )
      .bind(now, metadata.funnel_id)
      .run();
  }
}

async function recordPaymentRevocation(
  database: D1Database,
  data: PaymentEventData,
  webhookId: string,
  eventType: 'refund.succeeded' | 'dispute.accepted' | 'dispute.lost'
): Promise<void> {
  const paymentId = cleanString(data.payment_id, 180);
  if (!paymentId) throw new Error('The revocation event is missing the payment ID.');

  await database
    .prepare(
      `INSERT OR IGNORE INTO payment_revocations (
        payment_id, event_type, provider_event_id, created_at
      ) VALUES (?, ?, ?, ?)`
    )
    .bind(paymentId, eventType, webhookId, new Date().toISOString())
    .run();
  await database
    .prepare(
      `UPDATE fulfillments
       SET status = 'failed', error_message = ?, updated_at = ?
       WHERE payment_id = ? AND status IN ('pending', 'sending', 'sent')`
    )
    .bind(`Payment access revoked after ${eventType}.`, new Date().toISOString(), paymentId)
    .run();
}

async function assertPaymentMatchesCatalog(
  database: D1Database,
  data: PaymentEventData,
  metadata: Record<string, string>
): Promise<void> {
  const productKeys = [metadata.product_key, metadata.bump_product_key].filter(Boolean);
  const products = await Promise.all(
    productKeys.map((productKey) =>
      database
        .prepare(
          `SELECT dodo_product_id, price_amount, currency
           FROM offer_products WHERE product_key = ?`
        )
        .bind(productKey)
        .first<OfferProductRow>()
    )
  );
  const cart = Array.isArray(data.product_cart)
    ? data.product_cart.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const product = item as { product_id?: unknown; quantity?: unknown };
        return {
          productId: cleanString(product.product_id, 180),
          quantity: product.quantity,
        };
      })
    : null;
  const expectedProductIds = products.map((product) => cleanString(product?.dodo_product_id, 180));
  const cartMatches =
    products.every(Boolean) &&
    cart?.length === expectedProductIds.length &&
    cart.every(
      (item) =>
        item !== null &&
        item.quantity === 1 &&
        expectedProductIds.includes(item.productId)
    ) &&
    new Set(cart.filter(Boolean).map((item) => item?.productId)).size === expectedProductIds.length;
  const expectedAmount = products.reduce(
    (total, product) => total + (product?.price_amount ?? Number.NaN),
    0
  );
  const amountMatches = data.total_amount === expectedAmount;
  const currency = cleanString(data.currency, 3).toUpperCase();
  const currencyMatches =
    Boolean(currency) &&
    products.every((product) => cleanString(product?.currency, 3).toUpperCase() === currency);
  if (!cartMatches || !Number.isSafeInteger(expectedAmount) || !amountMatches || !currencyMatches) {
    throw new Error('The payment does not match the configured Dodo product.');
  }
}

async function markPaymentSucceeded(
  env: Environment,
  database: D1Database,
  data: PaymentEventData,
  metadata: Record<string, string>,
  webhookId: string
): Promise<void> {
  const paymentId = cleanString(data.payment_id, 180);
  const leadId = metadata.lead_id;
  const funnelId = metadata.funnel_id;
  const productKey = metadata.product_key;
  if (!paymentId) throw new Error('The payment event is missing the payment ID.');
  const revoked = await database
    .prepare('SELECT payment_id FROM payment_revocations WHERE payment_id = ?')
    .bind(paymentId)
    .first<{ payment_id: string }>();
  if (revoked) return;

  if (!leadId || !funnelId || !productKey) {
    throw new Error('The payment event is missing funnel metadata.');
  }
  await assertPaymentMatchesCatalog(database, data, metadata);

  const now = new Date().toISOString();
  const tenantId = cleanString(env.TRACKING_TENANT_ID, 128) || 'owned-funnel-builder';
  const siteId = cleanString(env.TRACKING_SITE_ID, 128) || 'shop.maestrogtm.com';
  const businessStatements = [];
  if (metadata.step_key) {
    businessStatements.push(
      database.prepare(
        `UPDATE funnel_step_runs
         SET status = 'accepted', dodo_payment_id = ?, updated_at = ?
         WHERE funnel_id = ? AND step_key = ?`
      )
      .bind(paymentId, now, funnelId, metadata.step_key)
    );
  } else {
    const customerId = cleanString(data.customer?.customer_id ?? data.customer_id, 180);
    const paymentMethodId = cleanString(data.payment_method_id, 180);
    if (!customerId) throw new Error('The payment event is missing the customer ID.');
    businessStatements.push(
      database.prepare(
        `UPDATE funnel_runs
         SET base_status = 'succeeded', base_payment_id = ?, dodo_customer_id = ?,
             dodo_payment_method_id = COALESCE(dodo_payment_method_id, ?), updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, customerId, paymentMethodId || null, now, funnelId)
    );
    businessStatements.push(
      database.prepare(
        `UPDATE checkout_leads
         SET status = 'converted', dodo_payment_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, now, leadId)
    );
  }

  const contents = [metadata.product_key, metadata.bump_product_key]
    .filter(Boolean)
    .map((id) => ({ id, quantity: 1 }));
  const flow = await database
    .prepare('SELECT context_hash, context_expires_at, flow_binding, privacy_snapshot_json FROM funnel_runs WHERE id = ?')
    .bind(funnelId)
    .first<{ context_hash: string; context_expires_at: string; flow_binding: string; privacy_snapshot_json: string }>();
  const contextHash = cleanString(flow?.context_hash, 64);
  if (!/^[a-f0-9]{64}$/i.test(contextHash) || !flow?.context_expires_at || Date.parse(flow.context_expires_at) <= Date.now()) throw new Error('Payment context is unavailable.');
  const currency = cleanString(data.currency, 3).toUpperCase();
  const purchaseSourceEventId = `purchase:${paymentId}`;
  const purchasePayload = {
    schema_version: '1',
    source_system: 'pages',
    source_event_id: purchaseSourceEventId,
    event_name: 'Purchase',
    occurred_at: now,
    context_hash: contextHash,
    context_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    funnel_slug: metadata.offer_slug || funnelId,
    product_id: metadata.product_key,
    payment_id: paymentId,
    value: minorUnitsToMajor(data.total_amount as number, currency), currency, num_items: contents.length,
    content_ids: contents.map((item) => item.id), contents,
    privacy_snapshot: JSON.parse(flow.privacy_snapshot_json || '{}'),
  };
  const purchaseEvent = {
    tenantId,
    siteId,
    sourceEventId: purchaseSourceEventId,
    eventName: 'Purchase' as const,
    occurredAt: now,
    payload: purchasePayload,
    payloadHash: await sourcePayloadHash(purchasePayload),
  };
  const claimOwner = crypto.randomUUID();
  const claimUntil = new Date(Date.now() + 60_000).toISOString();
  const existingMapping = await database
    .prepare(
      `SELECT source_event_id, claim_state, claim_until FROM source_tracking_provider_mappings
       WHERE tenant_id = ? AND site_id = ? AND provider = 'dodo'
         AND provider_object_id = ? AND event_name = 'Purchase'`
    )
    .bind(tenantId, siteId, paymentId)
    .first<{ source_event_id: string; claim_state?: string; claim_until?: string | null }>();
  let ownershipClaimed = false;
  if (existingMapping) {
    const existingOutbox = await database
      .prepare(
        `SELECT state FROM source_tracking_outbox
         WHERE tenant_id = ? AND site_id = ? AND source_event_id = ?`
      )
      .bind(tenantId, siteId, existingMapping.source_event_id)
      .first<{ state: string }>();
    if (existingOutbox) {
      await database
        .prepare(
          `INSERT INTO source_tracking_delivery_audit (
            tenant_id, site_id, source_event_id, owner, result, created_at
          ) VALUES (?, ?, ?, ?, 'ignored_not_owner', ?)`
        )
        .bind(tenantId, siteId, existingMapping.source_event_id, webhookId, now)
        .run();
      return;
    }
    const reclaimed = await database
      .prepare(
        `UPDATE source_tracking_provider_mappings
         SET claim_owner = ?, claim_until = ?, claim_state = 'claimed'
         WHERE tenant_id = ? AND site_id = ? AND provider = 'dodo'
           AND provider_object_id = ? AND event_name = 'Purchase'
           AND (claim_state = 'pending' OR claim_until IS NULL OR claim_until < ?)`
      )
      .bind(claimOwner, claimUntil, tenantId, siteId, paymentId, now)
      .run();
    ownershipClaimed = (reclaimed.meta?.changes ?? 0) === 1;
  } else {
    const ownership = await providerMappingStatement(
      database,
      purchaseEvent,
      'dodo',
      paymentId,
      claimOwner,
      claimUntil
    ).run();
    ownershipClaimed = (ownership.meta?.changes ?? 0) === 1;
  }
  if (!ownershipClaimed) {
    await database
      .prepare(
        `INSERT INTO source_tracking_delivery_audit (
          tenant_id, site_id, source_event_id, owner, result, created_at
        ) VALUES (?, ?, ?, ?, 'ignored_not_owner', ?)`
      )
      .bind(tenantId, siteId, purchaseSourceEventId, webhookId, now)
      .run();
    return;
  }
  businessStatements.push(
    commitProviderMappingStatement(database, purchaseEvent, 'dodo', paymentId, claimOwner)
  );
  businessStatements.push(sourceOutboxStatement(database, purchaseEvent));
  const businessResult = await database.batch(businessStatements);
  if (businessResult.some((result) => !result.success)) throw new Error('Payment capture failed.');
  if (env.TRACKING_SOURCE_BRIDGE) await drainSourceEvent(database, env, purchaseEvent);

  if (!getProductDefinition(productKey)) throw new Error('Purchased product is not configured.');
  await deliverPurchase(env, database, { paymentId, productKey, leadId, provider: 'dodo' });

  const bumpProductKey = metadata.bump_product_key;
  if (bumpProductKey) {
    if (!getProductDefinition(bumpProductKey)) throw new Error('Order bump is not configured.');
    await deliverPurchase(env, database, {
      paymentId,
      productKey: bumpProductKey,
      leadId,
      provider: 'dodo',
    });
  }

  const attributed = await recordAdmaxxerPayment(env, {
    paymentId,
    totalAmount: data.total_amount,
    currency: data.currency,
    visitorId: metadata.admx_visitor_id,
    email: data.customer?.email,
  });
  if (
    !attributed &&
    ['live', 'live_mode', 'production'].includes(readEnvironmentValue(env, 'DODO_PAYMENTS_ENVIRONMENT'))
  ) {
    throw new Error('Live payment attribution is not configured.');
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (!env.LEADS) return json({ error: 'Webhook storage is not configured.' }, 503);

  const webhookId = cleanString(request.headers.get('webhook-id'), 200);
  const webhookSignature = cleanString(request.headers.get('webhook-signature'), 2000);
  const webhookTimestamp = cleanString(request.headers.get('webhook-timestamp'), 100);
  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    return json({ error: 'Webhook signature headers are missing.' }, 400);
  }
  const apiKey = readEnvironmentValue(env, 'DODO_PAYMENTS_API_KEY');
  const webhookKey = readEnvironmentValue(env, 'DODO_PAYMENTS_WEBHOOK_KEY');
  const environment = readEnvironmentValue(env, 'DODO_PAYMENTS_ENVIRONMENT');
  if (!apiKey || !webhookKey || !['test_mode', 'live_mode'].includes(environment)) {
    return json({ error: 'Webhook verification is not configured.' }, 503);
  }

  const rawBody = await request.text();
  let payload: WebhookPayload;
  try {
    const client = new DodoPayments({
      bearerToken: apiKey,
      webhookKey,
      environment: environment as 'test_mode' | 'live_mode',
    });
    payload = client.webhooks.unwrap(rawBody, {
      headers: {
        'webhook-id': webhookId,
        'webhook-signature': webhookSignature,
        'webhook-timestamp': webhookTimestamp,
      },
    }) as WebhookPayload;
  } catch (error) {
    if (
      error instanceof Error &&
      ['Message timestamp too old', 'Message timestamp too new'].includes(error.message)
    ) {
      return json({ error: 'Webhook timestamp is stale.' }, 400);
    }
    return json({ error: 'Webhook signature is invalid.' }, 401);
  }

  const timestamp = Number(webhookTimestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TIMESTAMP_SKEW_SECONDS
  ) {
    return json({ error: 'Webhook timestamp is stale.' }, 400);
  }

  try {
    const result = await processDodoWebhookPayload(env, env.LEADS, webhookId, payload, rawBody);
    if (result === 'busy') return json({ error: 'Webhook is already being processed.' }, 503);
    return json({ received: true });
  } catch {
    console.error('Dodo webhook processing failed.', { webhookId });
    return json({ error: 'Webhook processing failed.' }, 500);
  }
}

export async function processDodoWebhookPayload(
  env: Environment,
  database: D1Database,
  webhookId: string,
  payload: WebhookPayload,
  rawBody = JSON.stringify(payload)
): Promise<DodoWebhookResult> {
  const eventType = cleanString(payload.type, 100) || 'unknown';
  const now = new Date().toISOString();
  const inserted = await database
    .prepare(
      `INSERT OR IGNORE INTO webhook_events (
        webhook_id, event_type, payload_json, status, created_at, attempt_started_at
      ) VALUES (?, ?, ?, 'received', ?, ?)`
    )
    .bind(webhookId, eventType, rawBody, now, now)
    .run();

  if ((inserted.meta?.changes ?? 0) === 0) {
    const existing = await database
      .prepare('SELECT status, attempt_started_at FROM webhook_events WHERE webhook_id = ?')
      .bind(webhookId)
      .first<{ status: string; attempt_started_at?: string | null }>();
    if (existing?.status === 'processed') return 'processed';

    const staleBefore = new Date(Date.now() - WEBHOOK_STALE_AFTER_MS).toISOString();
    const reclaim = await database
      .prepare(
        `UPDATE webhook_events
         SET status = 'received', attempt_started_at = ?, error_message = NULL, processed_at = NULL
         WHERE webhook_id = ?
           AND (status = 'failed' OR (status = 'received' AND attempt_started_at < ?))`
      )
      .bind(now, webhookId, staleBefore)
      .run();
    if ((reclaim.meta?.changes ?? 0) === 0) return 'busy';
  }

  try {
    const metadata = metadataRecord(payload.data?.metadata);
    const source = metadata.source;
    const isOwnedFunnelEvent = source === 'owned-funnel-builder';
    const isIntentionalNoOp = source === 'owned-funnel-diagnostic' || !source;
    if (eventType === 'payment.succeeded' && payload.data && isOwnedFunnelEvent) {
      await markPaymentSucceeded(env, database, payload.data, metadata, webhookId);
    } else if (eventType === 'payment.failed' && isOwnedFunnelEvent) {
      await markPaymentFailed(database, metadata);
    } else if (
      payload.data &&
      (eventType === 'refund.succeeded' ||
        eventType === 'dispute.accepted' ||
        eventType === 'dispute.lost')
    ) {
      await recordPaymentRevocation(database, payload.data, webhookId, eventType);
    } else if (!isOwnedFunnelEvent && !isIntentionalNoOp) {
      throw new Error('The payment event source is not configured for this funnel.');
    }

    await database
      .prepare(
        `UPDATE webhook_events
         SET status = 'processed', error_message = NULL, processed_at = ?, attempt_started_at = NULL
         WHERE webhook_id = ?`
      )
      .bind(new Date().toISOString(), webhookId)
      .run();
    return 'processed';
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Webhook failed.';
    await database
      .prepare(
        `UPDATE webhook_events
         SET status = 'failed', error_message = ?, processed_at = ?, attempt_started_at = NULL
         WHERE webhook_id = ?`
      )
      .bind(message, new Date().toISOString(), webhookId)
      .run();
    console.error('Dodo webhook processing failed.', { webhookId, eventType });
    throw error;
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

import DodoPayments from 'dodopayments';

import { getProductDefinition } from '../../_generated/funnels';
import { deliverPurchase } from '../../_lib/fulfillment';
import {
  cleanString,
  json,
  readEnvironmentValue,
  type D1Database,
  type Environment,
  type PagesContext,
} from '../../_lib/runtime';

interface PaymentEventData {
  payment_id?: unknown;
  status?: unknown;
  metadata?: unknown;
  customer?: { customer_id?: unknown } | null;
  customer_id?: unknown;
}

interface WebhookPayload {
  type?: unknown;
  data?: PaymentEventData;
}

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

async function markPaymentSucceeded(
  env: Environment,
  database: D1Database,
  data: PaymentEventData,
  metadata: Record<string, string>
): Promise<void> {
  const paymentId = cleanString(data.payment_id, 180);
  const leadId = metadata.lead_id;
  const funnelId = metadata.funnel_id;
  const productKey = metadata.product_key;
  if (!paymentId || !leadId || !funnelId || !productKey) {
    throw new Error('The payment event is missing funnel metadata.');
  }

  const now = new Date().toISOString();
  if (metadata.step_key) {
    await database
      .prepare(
        `UPDATE funnel_step_runs
         SET status = 'accepted', dodo_payment_id = ?, updated_at = ?
         WHERE funnel_id = ? AND step_key = ?`
      )
      .bind(paymentId, now, funnelId, metadata.step_key)
      .run();
  } else {
    const customerId = cleanString(data.customer?.customer_id ?? data.customer_id, 180);
    if (!customerId) throw new Error('The payment event is missing the customer ID.');
    await database
      .prepare(
        `UPDATE funnel_runs
         SET base_status = 'succeeded', base_payment_id = ?, dodo_customer_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, customerId, now, funnelId)
      .run();
    await database
      .prepare(
        `UPDATE checkout_leads
         SET status = 'converted', dodo_payment_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, now, leadId)
      .run();
  }

  if (!getProductDefinition(productKey)) throw new Error('Purchased product is not configured.');
  await deliverPurchase(env, database, { paymentId, productKey, leadId });

  const bumpProductKey = metadata.bump_product_key;
  if (bumpProductKey) {
    if (!getProductDefinition(bumpProductKey)) throw new Error('Order bump is not configured.');
    await deliverPurchase(env, database, { paymentId, productKey: bumpProductKey, leadId });
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
  } catch {
    return json({ error: 'Webhook signature is invalid.' }, 401);
  }

  const eventType = cleanString(payload.type, 100);
  const now = new Date().toISOString();
  await env.LEADS.prepare(
    `INSERT OR IGNORE INTO webhook_events (
      webhook_id, event_type, payload_json, status, created_at
    ) VALUES (?, ?, ?, 'received', ?)`
  )
    .bind(webhookId, eventType || 'unknown', rawBody, now)
    .run();

  const existing = await env.LEADS.prepare('SELECT status FROM webhook_events WHERE webhook_id = ?')
    .bind(webhookId)
    .first<{ status: string }>();
  if (existing?.status === 'processed') return json({ received: true });

  try {
    const metadata = metadataRecord(payload.data?.metadata);
    if (eventType === 'payment.succeeded' && payload.data) {
      await markPaymentSucceeded(env, env.LEADS, payload.data, metadata);
    } else if (eventType === 'payment.failed') {
      await markPaymentFailed(env.LEADS, metadata);
    }

    await env.LEADS.prepare(
      `UPDATE webhook_events
       SET status = 'processed', error_message = NULL, processed_at = ?
       WHERE webhook_id = ?`
    )
      .bind(new Date().toISOString(), webhookId)
      .run();
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Webhook failed.';
    await env.LEADS.prepare(
      `UPDATE webhook_events
       SET status = 'failed', error_message = ?, processed_at = ?
       WHERE webhook_id = ?`
    )
      .bind(message, new Date().toISOString(), webhookId)
      .run();
    console.error('Dodo webhook processing failed.', { webhookId, eventType });
    return json({ error: 'Webhook processing failed.' }, 500);
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

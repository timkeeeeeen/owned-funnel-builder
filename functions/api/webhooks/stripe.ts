import { getProductDefinition } from '../../_generated/funnels';
import { recordAdmaxxerPayment } from '../../_lib/admaxxer';
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
  getStripeConfig,
  stripeObjectId,
  stripeRequest,
  verifyStripeSignature,
  type StripeCheckoutSession,
  type StripePaymentIntent,
} from '../../_lib/stripe';

interface StripeEvent {
  id?: unknown;
  livemode?: unknown;
  type?: unknown;
  data?: { object?: unknown };
}

const MAX_WEBHOOK_BYTES = 512 * 1024;

function metadataRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cleanString(item, 500)] as const)
      .filter(([, item]) => item)
  );
}

async function leadEmail(database: D1Database, leadId: string): Promise<string> {
  const lead = await database
    .prepare('SELECT email FROM checkout_leads WHERE id = ?')
    .bind(leadId)
    .first<{ email: string }>();
  return cleanString(lead?.email, 320).toLowerCase();
}

async function markStripePaymentSucceeded(
  env: Environment,
  database: D1Database,
  payment: StripePaymentIntent,
  metadata: Record<string, string>
): Promise<void> {
  const paymentId = stripeObjectId(payment);
  const leadId = metadata.lead_id;
  const funnelId = metadata.funnel_id;
  const productKey = metadata.product_key;
  if (!paymentId || !leadId || !funnelId || !productKey) {
    throw new Error('The Stripe payment is missing funnel metadata.');
  }
  if (payment.status !== 'succeeded') return;

  const customerId = stripeObjectId(payment.customer);
  const paymentMethodId = stripeObjectId(payment.payment_method);
  if (!customerId || !paymentMethodId) {
    throw new Error('The Stripe payment is missing its saved customer payment method.');
  }

  const now = new Date().toISOString();
  if (metadata.step_key) {
    await database
      .prepare(
        `UPDATE funnel_step_runs
         SET status = 'accepted', stripe_payment_intent_id = ?, updated_at = ?
         WHERE funnel_id = ? AND step_key = ?`
      )
      .bind(paymentId, now, funnelId, metadata.step_key)
      .run();
    await database
      .prepare(
        `UPDATE funnel_runs
         SET stripe_customer_id = ?, stripe_payment_method_id = ?, updated_at = ?
         WHERE id = ? AND payment_provider = 'stripe'`
      )
      .bind(customerId, paymentMethodId, now, funnelId)
      .run();
  } else {
    await database
      .prepare(
        `UPDATE funnel_runs
         SET base_status = 'succeeded', base_payment_id = ?, stripe_customer_id = ?,
             stripe_payment_method_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, customerId, paymentMethodId, now, funnelId)
      .run();
    await database
      .prepare(
        `UPDATE checkout_leads
         SET status = 'converted', stripe_payment_intent_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, now, leadId)
      .run();
  }

  if (!getProductDefinition(productKey)) throw new Error('Purchased product is not configured.');
  await deliverPurchase(env, database, {
    paymentId,
    productKey,
    leadId,
    provider: 'stripe',
  });

  const bumpProductKey = metadata.bump_product_key;
  if (bumpProductKey) {
    if (!getProductDefinition(bumpProductKey)) throw new Error('Order bump is not configured.');
    await deliverPurchase(env, database, {
      paymentId,
      productKey: bumpProductKey,
      leadId,
      provider: 'stripe',
    });
  }

  await recordAdmaxxerPayment(env, {
    paymentId,
    totalAmount:
      typeof payment.amount_received === 'number' ? payment.amount_received : payment.amount,
    currency: payment.currency,
    visitorId: metadata.admx_visitor_id,
    email: cleanString(payment.receipt_email, 320) || (await leadEmail(database, leadId)),
  });
}

async function paymentIntentFromSession(
  env: Environment,
  session: StripeCheckoutSession
): Promise<StripePaymentIntent | null> {
  if (session.payment_intent && typeof session.payment_intent === 'object') {
    return session.payment_intent as StripePaymentIntent;
  }
  const paymentIntentId = stripeObjectId(session.payment_intent);
  if (!paymentIntentId) return null;
  return stripeRequest<StripePaymentIntent>(
    env,
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`
  );
}

async function handlePaymentFailed(
  database: D1Database,
  metadata: Record<string, string>
): Promise<void> {
  if (!metadata.funnel_id || !metadata.step_key) return;
  await database
    .prepare(
      `UPDATE funnel_step_runs
       SET status = 'failed', updated_at = ?
       WHERE funnel_id = ? AND step_key = ? AND status = 'charging'
         AND stripe_session_id IS NULL`
    )
    .bind(new Date().toISOString(), metadata.funnel_id, metadata.step_key)
    .run();
}

async function handleExpiredSession(
  database: D1Database,
  metadata: Record<string, string>
): Promise<void> {
  const now = new Date().toISOString();
  if (metadata.funnel_id && metadata.step_key) {
    await database
      .prepare(
        `UPDATE funnel_step_runs SET status = 'failed', updated_at = ?
         WHERE funnel_id = ? AND step_key = ? AND status = 'charging'`
      )
      .bind(now, metadata.funnel_id, metadata.step_key)
      .run();
  } else if (metadata.funnel_id) {
    await database
      .prepare(
        `UPDATE funnel_runs SET base_status = 'failed', updated_at = ?
         WHERE id = ? AND base_status = 'pending'`
      )
      .bind(now, metadata.funnel_id)
      .run();
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (!env.LEADS) return json({ error: 'Webhook storage is not configured.' }, 503);

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_WEBHOOK_BYTES) return json({ error: 'Webhook is too large.' }, 413);

  const signature = cleanString(request.headers.get('stripe-signature'), 4000);
  const endpointSecret = readEnvironmentValue(env, 'STRIPE_WEBHOOK_SECRET');
  if (!signature) return json({ error: 'Webhook signature is missing.' }, 400);
  if (!endpointSecret) return json({ error: 'Webhook verification is not configured.' }, 503);

  let checkoutMode: 'test' | 'live';
  try {
    checkoutMode = getStripeConfig(env).checkoutMode;
  } catch {
    return json({ error: 'Webhook verification is not configured.' }, 503);
  }

  const rawBytes = await request.arrayBuffer();
  if (rawBytes.byteLength > MAX_WEBHOOK_BYTES) {
    return json({ error: 'Webhook is too large.' }, 413);
  }
  const rawBody = new TextDecoder().decode(rawBytes);
  if (!(await verifyStripeSignature(rawBody, signature, endpointSecret))) {
    return json({ error: 'Webhook signature is invalid.' }, 401);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return json({ error: 'Webhook payload is invalid.' }, 400);
  }

  const eventId = cleanString(event.id, 180);
  const eventType = cleanString(event.type, 120);
  if (!eventId || !eventType || typeof event.livemode !== 'boolean') {
    return json({ error: 'Webhook payload is invalid.' }, 400);
  }
  if (event.livemode !== (checkoutMode === 'live')) {
    return json({ error: 'Webhook mode does not match checkout mode.' }, 400);
  }

  const storedEventId = `stripe:${eventId}`;
  const now = new Date().toISOString();
  await env.LEADS.prepare(
    `INSERT OR IGNORE INTO webhook_events (
      webhook_id, event_type, payload_json, status, created_at
    ) VALUES (?, ?, ?, 'received', ?)`
  )
    .bind(storedEventId, eventType, rawBody, now)
    .run();

  const existing = await env.LEADS.prepare('SELECT status FROM webhook_events WHERE webhook_id = ?')
    .bind(storedEventId)
    .first<{ status: string }>();
  if (existing?.status === 'processed') return json({ received: true });

  try {
    if (eventType === 'payment_intent.succeeded') {
      const payment = event.data?.object as StripePaymentIntent | undefined;
      if (payment) {
        await markStripePaymentSucceeded(env, env.LEADS, payment, metadataRecord(payment.metadata));
      }
    } else if (eventType === 'checkout.session.completed') {
      const session = event.data?.object as StripeCheckoutSession | undefined;
      if (session?.payment_status === 'paid') {
        const payment = await paymentIntentFromSession(env, session);
        if (payment) {
          await markStripePaymentSucceeded(env, env.LEADS, payment, {
            ...metadataRecord(session.metadata),
            ...metadataRecord(payment.metadata),
          });
        }
      }
    } else if (eventType === 'payment_intent.payment_failed') {
      const payment = event.data?.object as StripePaymentIntent | undefined;
      await handlePaymentFailed(env.LEADS, metadataRecord(payment?.metadata));
    } else if (eventType === 'checkout.session.expired') {
      const session = event.data?.object as StripeCheckoutSession | undefined;
      await handleExpiredSession(env.LEADS, metadataRecord(session?.metadata));
    }

    await env.LEADS.prepare(
      `UPDATE webhook_events
       SET status = 'processed', error_message = NULL, processed_at = ?
       WHERE webhook_id = ?`
    )
      .bind(new Date().toISOString(), storedEventId)
      .run();
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Webhook failed.';
    await env.LEADS.prepare(
      `UPDATE webhook_events
       SET status = 'failed', error_message = ?, processed_at = ?
       WHERE webhook_id = ?`
    )
      .bind(message, new Date().toISOString(), storedEventId)
      .run();
    console.error(
      JSON.stringify({ message: 'Stripe webhook processing failed.', eventId, eventType })
    );
    return json({ error: 'Webhook processing failed.' }, 500);
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

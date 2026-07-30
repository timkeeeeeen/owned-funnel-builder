import { getProductDefinition } from '../_generated/funnels';
import {
  cleanString,
  readEnvironmentValue,
  RequestError,
  type D1Database,
  type Environment,
} from './runtime';

interface FulfillmentInput {
  paymentId: string;
  productKey: string;
  leadId: string;
}

interface LeadRow {
  email: string;
}

interface ResendResponse {
  id?: string;
  message?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function deliverPurchase(
  env: Environment,
  database: D1Database,
  input: FulfillmentInput
): Promise<void> {
  const configured = getProductDefinition(input.productKey);
  if (!configured) throw new RequestError('The purchased product is not configured.', 500);

  const lead = await database
    .prepare('SELECT email FROM checkout_leads WHERE id = ?')
    .bind(input.leadId)
    .first<LeadRow>();
  if (!lead?.email) throw new RequestError('The checkout email could not be found.', 500);

  const apiKey = readEnvironmentValue(env, 'RESEND_API_KEY');
  const from = readEnvironmentValue(env, 'RESEND_FROM_EMAIL');
  if (!apiKey || !from) {
    throw new RequestError('Email delivery is not configured yet.', 503, 'configuration_email');
  }

  const now = new Date().toISOString();
  const fulfillmentId = crypto.randomUUID();
  await database
    .prepare(
      `INSERT OR IGNORE INTO fulfillments (
        id, payment_id, product_key, lead_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(fulfillmentId, input.paymentId, input.productKey, input.leadId, now, now)
    .run();

  const existing = await database
    .prepare(
      'SELECT id, status, updated_at FROM fulfillments WHERE payment_id = ? AND product_key = ?'
    )
    .bind(input.paymentId, input.productKey)
    .first<{ id: string; status: string; updated_at: string }>();
  if (!existing || existing.status === 'sent') return;

  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const lock = await database
    .prepare(
      `UPDATE fulfillments
       SET status = 'sending', attempt_count = attempt_count + 1, error_message = NULL, updated_at = ?
       WHERE id = ? AND (
         status IN ('pending', 'failed') OR (status = 'sending' AND updated_at < ?)
       )`
    )
    .bind(now, existing.id, staleBefore)
    .run();
  if ((lock.meta?.changes ?? 0) !== 1) return;

  const product = configured.product;
  const supportEmail = readEnvironmentValue(env, 'SUPPORT_EMAIL') || configured.funnel.supportEmail;
  const safeName = escapeHtml(product.name);
  const safeBody = escapeHtml(product.deliveryBody);
  const safeUrl = escapeHtml(product.accessUrl);
  const safeSupport = escapeHtml(supportEmail);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `fulfillment/${input.paymentId}/${input.productKey}`,
      },
      body: JSON.stringify({
        from,
        to: [lead.email],
        subject: product.deliverySubject,
        text: `${product.deliveryBody}\n\nOpen your purchase: ${product.accessUrl}\n\nNeed help? ${supportEmail}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#111827"><p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#2563eb">Purchase access</p><h1 style="font-size:32px;line-height:1.1">${safeName}</h1><p style="font-size:18px;line-height:1.6;color:#4b5563">${safeBody}</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-size:18px;font-weight:700;padding:16px 22px;border-radius:12px">Open your purchase</a></p><p style="font-size:14px;color:#6b7280">Need help? Reply to this email or contact ${safeSupport}.</p></div>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as ResendResponse;
    if (!response.ok || !result.id) {
      throw new Error(cleanString(result.message, 300) || `Resend returned ${response.status}.`);
    }

    await database
      .prepare(
        `UPDATE fulfillments
         SET status = 'sent', resend_email_id = ?, error_message = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(result.id, new Date().toISOString(), existing.id)
      .run();
  } catch (error) {
    await database
      .prepare(
        `UPDATE fulfillments
         SET status = 'failed', error_message = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed.',
        new Date().toISOString(),
        existing.id
      )
      .run();
    throw error;
  }
}

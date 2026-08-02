import { getProductDefinition } from '../_generated/funnels';
import {
  readEnvironmentValue,
  RequestError,
  type D1Database,
  type Environment,
  type PaymentProvider,
} from './runtime';
import { createPostmarkEmailProvider } from './email';

interface FulfillmentInput {
  paymentId: string;
  productKey: string;
  leadId: string;
  provider: PaymentProvider;
}

interface LeadRow {
  email: string;
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

  const token = readEnvironmentValue(env, 'POSTMARK_SERVER_TOKEN');
  const from = readEnvironmentValue(env, 'EMAIL_TRANSACTIONAL_FROM');
  if (!token || !from) {
    if (input.provider === 'stripe') {
      const message = 'Stripe delivery requires the access-email connection.';
      await database
        .prepare(
          `UPDATE fulfillments
           SET status = 'failed', error_message = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(message, new Date().toISOString(), existing.id)
        .run();
      throw new RequestError(message, 503, 'configuration_fulfillment');
    }

    // Every configured Dodo product carries a native Digital Files entitlement.
    // Dodo emails the grant and refreshes its download links in the customer portal.
    await database
      .prepare(
        `UPDATE fulfillments
         SET status = 'sent', provider_message_id = 'dodo-native', error_message = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(new Date().toISOString(), existing.id)
      .run();
    return;
  }

  const product = configured.product;
  const supportEmail = readEnvironmentValue(env, 'SUPPORT_EMAIL') || configured.funnel.supportEmail;

  try {
    const provider = createPostmarkEmailProvider({
      token,
      transactionalFrom: from,
      marketingFrom: readEnvironmentValue(env, 'EMAIL_MARKETING_FROM') || from,
    });
    const result = await provider.sendTransactional({
      to: lead.email,
      templateAlias:
        readEnvironmentValue(env, 'EMAIL_PURCHASE_TEMPLATE_ALIAS') || 'purchase-access',
      templateModel: {
        product_name: product.name,
        delivery_subject: product.deliverySubject,
        delivery_body: product.deliveryBody,
        access_url: product.accessUrl,
        support_email: supportEmail,
      },
      idempotencyKey: `fulfillment:${input.paymentId}:${input.productKey}`,
    });

    await database
      .prepare(
        `UPDATE fulfillments
         SET status = 'sent', provider_message_id = ?, error_message = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(result.messageId, new Date().toISOString(), existing.id)
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

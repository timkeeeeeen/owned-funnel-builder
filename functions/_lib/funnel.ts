import { FUNNEL_OFFERS, type FunnelOfferKey } from './products';
import {
  dodoRequest,
  hashFlowToken,
  RequestError,
  type D1Database,
  type Environment,
} from './runtime';

interface CheckoutSessionStatus {
  id?: string;
  payment_id?: string | null;
  payment_status?: string | null;
}

interface PaymentDetails {
  payment_id?: string;
  status?: string | null;
  customer?: { customer_id?: string };
}

export interface FunnelRow {
  id: string;
  lead_id: string;
  token_hash: string;
  base_status: 'pending' | 'succeeded' | 'failed';
  base_payment_id: string | null;
  dodo_customer_id: string | null;
  dodo_session_id: string | null;
  bump_selected: 0 | 1;
  blueprints_status: 'offered' | 'charging' | 'accepted' | 'declined' | 'failed';
  blueprints_session_id: string | null;
  blueprints_payment_id: string | null;
  blueprints_checkout_url: string | null;
  launch_status: 'offered' | 'charging' | 'accepted' | 'declined' | 'failed';
  launch_session_id: string | null;
  launch_payment_id: string | null;
  launch_checkout_url: string | null;
}

export async function getFunnelByToken(database: D1Database, token: string): Promise<FunnelRow> {
  const tokenHash = await hashFlowToken(token);
  const row = await database
    .prepare(
      `SELECT f.*, l.dodo_session_id, l.bump_selected
       FROM checkout_funnels f
       JOIN checkout_leads l ON l.id = f.lead_id
       WHERE f.token_hash = ?`
    )
    .bind(tokenHash)
    .first<FunnelRow>();

  if (!row)
    throw new RequestError('This purchase link is invalid or expired.', 404, 'flow_not_found');
  return row;
}

async function refreshBasePayment(
  env: Environment,
  database: D1Database,
  funnel: FunnelRow
): Promise<void> {
  if (funnel.base_status !== 'pending' || !funnel.dodo_session_id) return;

  const session = await dodoRequest<CheckoutSessionStatus>(
    env,
    `/checkouts/${encodeURIComponent(funnel.dodo_session_id)}`
  );
  if (!session.payment_id || !session.payment_status) return;

  if (session.payment_status === 'succeeded') {
    const payment = await dodoRequest<PaymentDetails>(
      env,
      `/payments/${encodeURIComponent(session.payment_id)}`
    );
    const customerId = payment.customer?.customer_id;
    if (!customerId || payment.status !== 'succeeded') return;

    const now = new Date().toISOString();
    await database
      .prepare(
        `UPDATE checkout_funnels
         SET base_status = 'succeeded', base_payment_id = ?, dodo_customer_id = ?, updated_at = ?
         WHERE id = ? AND base_status = 'pending'`
      )
      .bind(session.payment_id, customerId, now, funnel.id)
      .run();
    await database
      .prepare(
        `UPDATE checkout_leads
         SET status = 'converted', dodo_payment_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(session.payment_id, now, funnel.lead_id)
      .run();
    return;
  }

  if (['failed', 'cancelled'].includes(session.payment_status)) {
    await database
      .prepare(`UPDATE checkout_funnels SET base_status = 'failed', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), funnel.id)
      .run();
  }
}

async function refreshUpsellPayment(
  env: Environment,
  database: D1Database,
  funnel: FunnelRow,
  offerKey: FunnelOfferKey
): Promise<void> {
  const offer = FUNNEL_OFFERS[offerKey];
  const status = funnel[`${offerKey}_status` as keyof FunnelRow];
  const sessionId = funnel[`${offerKey}_session_id` as keyof FunnelRow];
  if (status !== 'charging' || typeof sessionId !== 'string' || !sessionId) return;

  const session = await dodoRequest<CheckoutSessionStatus>(
    env,
    `/checkouts/${encodeURIComponent(sessionId)}`
  );
  if (!session.payment_id || !session.payment_status) return;

  if (session.payment_status === 'succeeded') {
    await database
      .prepare(
        `UPDATE checkout_funnels
         SET ${offer.statusColumn} = 'accepted', ${offer.paymentColumn} = ?, updated_at = ?
         WHERE id = ? AND ${offer.statusColumn} = 'charging'`
      )
      .bind(session.payment_id, new Date().toISOString(), funnel.id)
      .run();
    return;
  }

  if (['failed', 'cancelled', 'requires_payment_method'].includes(session.payment_status)) {
    await database
      .prepare(
        `UPDATE checkout_funnels
         SET ${offer.statusColumn} = 'failed', updated_at = ?
         WHERE id = ? AND ${offer.statusColumn} = 'charging'`
      )
      .bind(new Date().toISOString(), funnel.id)
      .run();
  }
}

export async function refreshFunnel(
  env: Environment,
  database: D1Database,
  token: string
): Promise<FunnelRow> {
  let funnel = await getFunnelByToken(database, token);
  await refreshBasePayment(env, database, funnel);
  funnel = await getFunnelByToken(database, token);
  await refreshUpsellPayment(env, database, funnel, 'blueprints');
  funnel = await getFunnelByToken(database, token);
  await refreshUpsellPayment(env, database, funnel, 'launch');
  return getFunnelByToken(database, token);
}

export function nextFunnelPath(funnel: FunnelRow): string | null {
  if (funnel.base_status !== 'succeeded') return null;
  if (['offered', 'failed', 'charging'].includes(funnel.blueprints_status)) {
    return '/checkout/upsell/blueprints/';
  }
  if (['offered', 'failed', 'charging'].includes(funnel.launch_status)) {
    return '/checkout/upsell/launch/';
  }
  return '/checkout/complete/';
}

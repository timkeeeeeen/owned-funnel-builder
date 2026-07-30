import { getFunnelDefinition } from '../_generated/funnels';
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
  payment_method_id?: string | null;
}

export interface FunnelRun {
  id: string;
  lead_id: string;
  offer_slug: string;
  token_hash: string;
  base_status: 'pending' | 'succeeded' | 'failed';
  base_payment_id: string | null;
  dodo_customer_id: string | null;
  dodo_payment_method_id: string | null;
  dodo_session_id: string | null;
  bump_selected: 0 | 1;
}

export interface FunnelStepRun {
  id: string;
  funnel_id: string;
  step_key: string;
  ordinal: number;
  status: 'offered' | 'charging' | 'accepted' | 'declined' | 'failed';
  dodo_session_id: string | null;
  dodo_payment_id: string | null;
  checkout_url: string | null;
}

export interface FunnelState {
  run: FunnelRun;
  steps: FunnelStepRun[];
}

export async function getFunnelByToken(database: D1Database, token: string): Promise<FunnelState> {
  const tokenHash = await hashFlowToken(token);
  const run = await database
    .prepare(
      `SELECT f.*, l.dodo_session_id, l.bump_selected
       FROM funnel_runs f
       JOIN checkout_leads l ON l.id = f.lead_id
       WHERE f.token_hash = ?`
    )
    .bind(tokenHash)
    .first<FunnelRun>();

  if (!run) {
    throw new RequestError('This purchase link is invalid or expired.', 404, 'flow_not_found');
  }

  const rows = await database
    .prepare('SELECT * FROM funnel_step_runs WHERE funnel_id = ? ORDER BY ordinal ASC')
    .bind(run.id)
    .all<FunnelStepRun>();

  return { run, steps: rows.results ?? [] };
}

async function refreshBasePayment(
  env: Environment,
  database: D1Database,
  run: FunnelRun
): Promise<void> {
  if (run.base_status === 'failed') return;

  let paymentId = run.base_payment_id;
  if (run.base_status === 'pending') {
    if (!run.dodo_session_id) return;
    const session = await dodoRequest<CheckoutSessionStatus>(
      env,
      `/checkouts/${encodeURIComponent(run.dodo_session_id)}`
    );
    if (!session.payment_id || !session.payment_status) return;

    if (['failed', 'cancelled'].includes(session.payment_status)) {
      await database
        .prepare(`UPDATE funnel_runs SET base_status = 'failed', updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), run.id)
        .run();
      return;
    }
    if (session.payment_status !== 'succeeded') return;
    paymentId = session.payment_id;
  }

  if (!paymentId || (run.dodo_customer_id && run.dodo_payment_method_id)) return;

  const payment = await dodoRequest<PaymentDetails>(
    env,
    `/payments/${encodeURIComponent(paymentId)}`
  );
  if (payment.status === 'succeeded') {
    const customerId = payment.customer?.customer_id;
    if (!customerId) return;

    const now = new Date().toISOString();
    await database
      .prepare(
        `UPDATE funnel_runs
         SET base_status = 'succeeded',
             base_payment_id = COALESCE(base_payment_id, ?),
             dodo_customer_id = COALESCE(dodo_customer_id, ?),
             dodo_payment_method_id = COALESCE(dodo_payment_method_id, ?),
             updated_at = ?
         WHERE id = ? AND base_status IN ('pending', 'succeeded')`
      )
      .bind(paymentId, customerId, payment.payment_method_id ?? null, now, run.id)
      .run();
    await database
      .prepare(
        `UPDATE checkout_leads
         SET status = 'converted', dodo_payment_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(paymentId, now, run.lead_id)
      .run();
  }
}

async function refreshUpsellPayment(
  env: Environment,
  database: D1Database,
  step: FunnelStepRun
): Promise<void> {
  if (step.status !== 'charging' || !step.dodo_session_id) return;

  const session = await dodoRequest<CheckoutSessionStatus>(
    env,
    `/checkouts/${encodeURIComponent(step.dodo_session_id)}`
  );
  if (!session.payment_id || !session.payment_status) return;

  if (session.payment_status === 'succeeded') {
    await database
      .prepare(
        `UPDATE funnel_step_runs
         SET status = 'accepted', dodo_payment_id = ?, updated_at = ?
         WHERE id = ? AND status = 'charging'`
      )
      .bind(session.payment_id, new Date().toISOString(), step.id)
      .run();
    return;
  }

  if (['failed', 'cancelled', 'requires_payment_method'].includes(session.payment_status)) {
    await database
      .prepare(
        `UPDATE funnel_step_runs
         SET status = 'failed', updated_at = ?
         WHERE id = ? AND status = 'charging'`
      )
      .bind(new Date().toISOString(), step.id)
      .run();
  }
}

export async function refreshFunnel(
  env: Environment,
  database: D1Database,
  token: string
): Promise<FunnelState> {
  let state = await getFunnelByToken(database, token);
  await refreshBasePayment(env, database, state.run);
  state = await getFunnelByToken(database, token);

  for (const step of state.steps) {
    await refreshUpsellPayment(env, database, step);
  }

  return getFunnelByToken(database, token);
}

export function nextFunnelPath(state: FunnelState): string | null {
  if (state.run.base_status !== 'succeeded') return null;
  const nextStep = state.steps.find((step) =>
    ['offered', 'failed', 'charging'].includes(step.status)
  );
  if (nextStep) return `/checkout/upsell/${nextStep.step_key}/`;
  return '/checkout/complete/';
}

export function assertFunnelDefinition(offerSlug: string) {
  const definition = getFunnelDefinition(offerSlug);
  if (!definition) {
    throw new RequestError('This offer does not have a checkout funnel.', 404, 'funnel_not_found');
  }
  return definition;
}

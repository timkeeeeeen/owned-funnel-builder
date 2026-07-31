import { getFunnelDefinition } from '../../_generated/funnels';
import { refreshFunnel } from '../../_lib/funnel';
import { getProductId } from '../../_lib/products';
import {
  cleanString,
  dodoRequest,
  json,
  sameOrigin,
  validFlowToken,
  type PagesContext,
} from '../../_lib/runtime';

interface DecisionRequest {
  flow?: unknown;
  offer?: unknown;
  decision?: unknown;
}

interface PaymentMethodsResponse {
  items?: Array<{
    payment_method_id?: string;
  }>;
}

interface CheckoutResponse {
  checkout_url?: string | null;
  session_id?: string;
  payment_id?: string | null;
}

const SAVED_METHOD_ATTEMPTS = 5;
const SAVED_METHOD_RETRY_MS = 300;

async function findReusablePaymentMethod(
  env: PagesContext['env'],
  customerId: string,
  storedPaymentMethodId: string | null
): Promise<string | null> {
  for (let attempt = 0; attempt < SAVED_METHOD_ATTEMPTS; attempt += 1) {
    const methods = await dodoRequest<PaymentMethodsResponse>(
      env,
      `/customers/${encodeURIComponent(customerId)}/payment-methods`
    );
    const availableMethods =
      methods.items?.filter(
        (method): method is { payment_method_id: string } => Boolean(method.payment_method_id)
      ) ?? [];
    const paymentMethod =
      availableMethods.find((method) => method.payment_method_id === storedPaymentMethodId) ??
      availableMethods[0];
    if (paymentMethod?.payment_method_id) return paymentMethod.payment_method_id;
    if (attempt < SAVED_METHOD_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, SAVED_METHOD_RETRY_MS));
    }
  }
  return null;
}

function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'dodopayments.com' || url.hostname.endsWith('.dodopayments.com'))
    );
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (!env.LEADS) return json({ error: 'Checkout is not configured yet.' }, 503);

  let stepKey = '';
  let funnelId = '';

  try {
    const bodyText = await request.text();
    if (bodyText.length > 8 * 1024) return json({ error: 'Request is too large.' }, 413);
    const input = JSON.parse(bodyText) as DecisionRequest;
    const flow = cleanString(input.flow, 100);
    stepKey = cleanString(input.offer, 80);
    const decision = cleanString(input.decision, 20);
    if (
      !validFlowToken(flow) ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(stepKey) ||
      !['accept', 'decline'].includes(decision)
    ) {
      return json({ error: 'Request is invalid.' }, 400);
    }

    const state = await refreshFunnel(env, env.LEADS, flow);
    funnelId = state.run.id;
    if (state.run.base_status !== 'succeeded') {
      return json({ error: 'We are still verifying the original purchase.' }, 409);
    }

    const definition = getFunnelDefinition(state.run.offer_slug);
    const offerConfig = definition?.upsells.find((step) => step.key === stepKey);
    const stepRun = state.steps.find((step) => step.step_key === stepKey);
    if (!definition || !offerConfig || !stepRun) {
      return json({ error: 'This upgrade is not part of the original purchase.' }, 404);
    }

    const earlierIncomplete = state.steps.some(
      (step) => step.ordinal < stepRun.ordinal && !['accepted', 'declined'].includes(step.status)
    );
    if (earlierIncomplete) return json({ error: 'Complete the previous offer first.' }, 409);

    const nextStep = state.steps.find((step) => step.ordinal === stepRun.ordinal + 1);
    const nextPath = nextStep ? `/checkout/upsell/${nextStep.step_key}/` : '/checkout/complete/';
    const nextUrl = new URL(nextPath, request.url);
    nextUrl.searchParams.set('flow', flow);

    if (stepRun.status === 'accepted' || stepRun.status === 'declined') {
      return json({ state: stepRun.status, nextUrl: nextUrl.toString() });
    }

    if (decision === 'decline') {
      await env.LEADS.prepare(
        `UPDATE funnel_step_runs
         SET status = 'declined', updated_at = ?
         WHERE id = ? AND status IN ('offered', 'failed')`
      )
        .bind(new Date().toISOString(), stepRun.id)
        .run();
      return json({ state: 'declined', nextUrl: nextUrl.toString() });
    }

    if (!state.run.dodo_customer_id) {
      return json({ error: 'The saved payment method is not ready yet. Try again.' }, 409);
    }
    if (stepRun.status === 'charging') {
      return json({ state: 'processing', nextUrl: nextUrl.toString() });
    }

    const lock = await env.LEADS.prepare(
      `UPDATE funnel_step_runs
       SET status = 'charging', updated_at = ?
       WHERE id = ? AND status IN ('offered', 'failed')`
    )
      .bind(new Date().toISOString(), stepRun.id)
      .run();
    if ((lock.meta?.changes ?? 0) !== 1) {
      return json({ state: 'processing', nextUrl: nextUrl.toString() });
    }

    const paymentMethodId = await findReusablePaymentMethod(
      env,
      state.run.dodo_customer_id,
      state.run.dodo_payment_method_id
    );
    const productId = await getProductId(env.LEADS, offerConfig.productKey);
    const checkoutBody: Record<string, unknown> = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { customer_id: state.run.dodo_customer_id },
      return_url: nextUrl.toString(),
      feature_flags: { redirect_immediately: true },
      metadata: {
        funnel_id: state.run.id,
        lead_id: state.run.lead_id,
        offer_slug: state.run.offer_slug,
        step_key: stepKey,
        product_key: offerConfig.productKey,
        source: 'owned-funnel-builder',
        ...(state.run.admaxxer_visitor_id
          ? { admx_visitor_id: state.run.admaxxer_visitor_id }
          : {}),
      },
    };
    if (paymentMethodId) {
      checkoutBody.payment_method_id = paymentMethodId;
      checkoutBody.confirm = true;
    }

    const checkout = await dodoRequest<CheckoutResponse>(env, '/checkouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': `${state.run.id}:${stepKey}` },
      body: JSON.stringify(checkoutBody),
    });
    if (!checkout.session_id || (!paymentMethodId && !validCheckoutUrl(checkout.checkout_url))) {
      throw new Error('Dodo did not return a valid checkout session.');
    }

    await env.LEADS.prepare(
      `UPDATE funnel_step_runs
       SET dodo_session_id = ?, checkout_url = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        checkout.session_id,
        checkout.checkout_url ?? null,
        new Date().toISOString(),
        stepRun.id
      )
      .run();

    return paymentMethodId
      ? json({ state: 'processing', nextUrl: nextUrl.toString() })
      : json({ state: 'redirect', checkoutUrl: checkout.checkout_url });
  } catch (error) {
    if (stepKey && funnelId && env.LEADS) {
      await env.LEADS.prepare(
        `UPDATE funnel_step_runs
         SET status = 'failed', updated_at = ?
         WHERE funnel_id = ? AND step_key = ? AND status = 'charging'`
      )
        .bind(new Date().toISOString(), funnelId, stepKey)
        .run();
    }
    console.error('Upsell decision failed.', { stepKey, funnelId });
    return json(
      { error: error instanceof Error ? error.message : 'Unable to process this offer.' },
      502
    );
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

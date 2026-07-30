import { refreshFunnel } from '../../_lib/funnel';
import { FUNNEL_OFFERS, getProductId, type FunnelOfferKey } from '../../_lib/products';
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
    recurring_enabled?: boolean | null;
  }>;
}

interface CheckoutResponse {
  checkout_url?: string;
  session_id?: string;
}

function validOffer(value: string): value is FunnelOfferKey {
  return value === 'blueprints' || value === 'launch';
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

  let offerKey: FunnelOfferKey | null = null;
  let funnelId = '';
  try {
    const bodyText = await request.text();
    if (bodyText.length > 8 * 1024) return json({ error: 'Request is too large.' }, 413);
    const input = JSON.parse(bodyText) as DecisionRequest;
    const flow = cleanString(input.flow, 100);
    const offer = cleanString(input.offer, 40);
    const decision = cleanString(input.decision, 20);
    if (!validFlowToken(flow) || !validOffer(offer) || !['accept', 'decline'].includes(decision)) {
      return json({ error: 'Request is invalid.' }, 400);
    }
    offerKey = offer;

    const funnel = await refreshFunnel(env, env.LEADS, flow);
    funnelId = funnel.id;
    if (funnel.base_status !== 'succeeded') {
      return json({ error: 'We are still verifying the original purchase.' }, 409);
    }
    if (offerKey === 'launch' && !['accepted', 'declined'].includes(funnel.blueprints_status)) {
      return json({ error: 'Complete the previous offer first.' }, 409);
    }

    const offerConfig = FUNNEL_OFFERS[offerKey];
    const currentStatus = funnel[`${offerKey}_status`];
    const nextUrl = new URL(offerConfig.nextPath, request.url);
    nextUrl.searchParams.set('flow', flow);

    if (currentStatus === 'accepted' || currentStatus === 'declined') {
      return json({ state: currentStatus, nextUrl: nextUrl.toString() });
    }

    if (decision === 'decline') {
      await env.LEADS.prepare(
        `UPDATE checkout_funnels
         SET ${offerConfig.statusColumn} = 'declined', updated_at = ?
         WHERE id = ? AND ${offerConfig.statusColumn} IN ('offered', 'failed')`
      )
        .bind(new Date().toISOString(), funnel.id)
        .run();
      return json({ state: 'declined', nextUrl: nextUrl.toString() });
    }

    if (!funnel.dodo_customer_id) {
      return json({ error: 'The saved payment method is not ready yet. Try again.' }, 409);
    }

    if (currentStatus === 'charging') {
      return json({ state: 'processing', nextUrl: nextUrl.toString() });
    }

    const lock = await env.LEADS.prepare(
      `UPDATE checkout_funnels
       SET ${offerConfig.statusColumn} = 'charging', updated_at = ?
       WHERE id = ? AND ${offerConfig.statusColumn} IN ('offered', 'failed')`
    )
      .bind(new Date().toISOString(), funnel.id)
      .run();
    if ((lock.meta?.changes ?? 0) !== 1) {
      return json({ state: 'processing', nextUrl: nextUrl.toString() });
    }

    const methods = await dodoRequest<PaymentMethodsResponse>(
      env,
      `/customers/${encodeURIComponent(funnel.dodo_customer_id)}/payment-methods`
    );
    const paymentMethod = methods.items?.find(
      (method) => method.payment_method_id && method.recurring_enabled !== false
    );
    const productId = await getProductId(env.LEADS, offerConfig.productKey);
    const checkoutBody: Record<string, unknown> = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { customer_id: funnel.dodo_customer_id },
      return_url: nextUrl.toString(),
      feature_flags: { redirect_immediately: true },
      metadata: {
        funnel_id: funnel.id,
        lead_id: funnel.lead_id,
        upsell_key: offerKey,
        source: 'maestro-offers',
      },
    };
    if (paymentMethod?.payment_method_id) {
      checkoutBody.payment_method_id = paymentMethod.payment_method_id;
      checkoutBody.confirm = true;
    }

    const checkout = await dodoRequest<CheckoutResponse>(env, '/checkouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': `${funnel.id}:${offerKey}` },
      body: JSON.stringify(checkoutBody),
    });
    if (!checkout.session_id || !validCheckoutUrl(checkout.checkout_url)) {
      throw new Error('Dodo did not return a valid checkout session.');
    }

    await env.LEADS.prepare(
      `UPDATE checkout_funnels
       SET ${offerConfig.sessionColumn} = ?, ${offerConfig.checkoutUrlColumn} = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(checkout.session_id, checkout.checkout_url, new Date().toISOString(), funnel.id)
      .run();

    return paymentMethod?.payment_method_id
      ? json({ state: 'processing', nextUrl: nextUrl.toString() })
      : json({ state: 'redirect', checkoutUrl: checkout.checkout_url });
  } catch (error) {
    if (offerKey && funnelId && env.LEADS) {
      const offerConfig = FUNNEL_OFFERS[offerKey];
      await env.LEADS.prepare(
        `UPDATE checkout_funnels SET ${offerConfig.statusColumn} = 'failed', updated_at = ? WHERE id = ?`
      )
        .bind(new Date().toISOString(), funnelId)
        .run();
    }
    console.error('Upsell decision failed.', { offerKey, funnelId });
    return json(
      { error: error instanceof Error ? error.message : 'Unable to process this offer.' },
      502
    );
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

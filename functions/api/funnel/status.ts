import { getFunnelDefinition } from '../../_generated/funnels';
import { nextFunnelPath, refreshFunnel } from '../../_lib/funnel';
import { json, validFlowToken, type PagesContext } from '../../_lib/runtime';

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  try {
    const flow = new URL(request.url).searchParams.get('flow');
    if (!validFlowToken(flow)) return json({ error: 'Purchase link is invalid.' }, 400);
    if (!env.LEADS) return json({ error: 'Checkout is not configured yet.' }, 503);

    const state = await refreshFunnel(env, env.LEADS, flow);
    const definition = getFunnelDefinition(state.run.offer_slug);
    if (!definition) return json({ error: 'This checkout funnel no longer exists.' }, 404);

    const response = json({
      offerSlug: definition.offerSlug,
      supportEmail: definition.supportEmail,
      baseStatus: state.run.base_status,
      baseProduct: { key: definition.base.productKey, name: definition.base.name },
      bump:
        definition.bump && state.run.bump_selected === 1
          ? { key: definition.bump.productKey, name: definition.bump.name, accepted: true }
          : null,
      steps: state.steps.map((step) => {
        const configured = definition.upsells.find((item) => item.key === step.step_key);
        return {
          key: step.step_key,
          name: configured?.name ?? step.step_key,
          status: step.status,
        };
      }),
      nextPath: nextFunnelPath(state),
      completion: definition.completion,
    });
    response.headers.set('Referrer-Policy', 'strict-origin');
    return response;
  } catch (error) {
    console.error('Funnel status request failed.');
    return json(
      { error: error instanceof Error ? error.message : 'Unable to verify purchase.' },
      502
    );
  }
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

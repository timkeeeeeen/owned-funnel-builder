import { nextFunnelPath, refreshFunnel } from '../../_lib/funnel';
import { json, validFlowToken, type PagesContext } from '../../_lib/runtime';

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  try {
    const flow = new URL(request.url).searchParams.get('flow');
    if (!validFlowToken(flow)) return json({ error: 'Purchase link is invalid.' }, 400);
    if (!env.LEADS) return json({ error: 'Checkout is not configured yet.' }, 503);

    const funnel = await refreshFunnel(env, env.LEADS, flow);
    return json({
      baseStatus: funnel.base_status,
      bumpAccepted: funnel.base_status === 'succeeded' && funnel.bump_selected === 1,
      blueprintsStatus: funnel.blueprints_status,
      launchStatus: funnel.launch_status,
      nextPath: nextFunnelPath(funnel),
    });
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

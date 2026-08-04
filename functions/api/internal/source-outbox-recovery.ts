import { recoverSourceOutbox } from '../../_lib/source-outbox.ts';
import { cleanString, json, readEnvironmentValue, type PagesContext } from '../../_lib/runtime.ts';

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.LEADS) return json({ error: 'Recovery storage is not configured.' }, 503);

  const configuredToken = readEnvironmentValue(env, 'TRACKING_SOURCE_RECOVERY_TOKEN');
  const authorization = cleanString(request.headers.get('authorization'), 4096);
  if (!configuredToken || authorization !== `Bearer ${configuredToken}`) {
    return json({ error: 'Not authorized.' }, 401);
  }

  const delivered = await recoverSourceOutbox(env.LEADS, env);
  return json({ delivered });
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}

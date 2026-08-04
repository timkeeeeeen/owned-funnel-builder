import { json, type PagesContext } from '../../_lib/runtime.ts';

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  void request;
  void env;
  return json({ error: 'not_allowed' }, 403);
}

export function onRequest(): Response {
  return json({ error: 'not_allowed' }, 403);
}

import { proxyCheckout } from './_proxy';
import type { PagesContext } from '../../_lib/runtime';

export function onRequestPost(context: PagesContext): Promise<Response> {
  return proxyCheckout(context, 'checkout-status');
}

export function onRequest(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}

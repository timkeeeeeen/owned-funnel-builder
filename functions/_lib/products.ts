import type { D1Database } from './runtime';
import { RequestError } from './runtime';

export const PRODUCT_KEYS = {
  promptPack: 'vibe-code-prompt-pack',
  blueprints: 'vibe-code-five-app-blueprints',
  launch: 'vibe-code-production-launch-pack',
} as const;

export type FunnelOfferKey = 'blueprints' | 'launch';

export const FUNNEL_OFFERS: Record<
  FunnelOfferKey,
  {
    productKey: string;
    nextPath: string;
    statusColumn: string;
    sessionColumn: string;
    paymentColumn: string;
    checkoutUrlColumn: string;
  }
> = {
  blueprints: {
    productKey: PRODUCT_KEYS.blueprints,
    nextPath: '/checkout/upsell/launch/',
    statusColumn: 'blueprints_status',
    sessionColumn: 'blueprints_session_id',
    paymentColumn: 'blueprints_payment_id',
    checkoutUrlColumn: 'blueprints_checkout_url',
  },
  launch: {
    productKey: PRODUCT_KEYS.launch,
    nextPath: '/checkout/complete/',
    statusColumn: 'launch_status',
    sessionColumn: 'launch_session_id',
    paymentColumn: 'launch_payment_id',
    checkoutUrlColumn: 'launch_checkout_url',
  },
};

export async function getProductId(database: D1Database, productKey: string): Promise<string> {
  const row = await database
    .prepare('SELECT dodo_product_id FROM offer_products WHERE product_key = ?')
    .bind(productKey)
    .first<{ dodo_product_id: string }>();

  if (!row?.dodo_product_id) {
    throw new RequestError(
      'This checkout option is not configured yet.',
      503,
      'configuration_product'
    );
  }

  return row.dodo_product_id;
}

import type { D1Database } from './runtime';
import { RequestError } from './runtime';

export interface StripePriceMapping {
  priceId: string;
  amount: number;
  currency: string;
}

export async function getProductId(database: D1Database, productKey: string): Promise<string> {
  const row = await database
    .prepare('SELECT dodo_product_id FROM offer_products WHERE product_key = ?')
    .bind(productKey)
    .first<{ dodo_product_id: string }>();

  if (!row?.dodo_product_id) {
    throw new RequestError(
      `The product "${productKey}" is not connected to Dodo Payments yet.`,
      503,
      'configuration_product'
    );
  }

  return row.dodo_product_id;
}

export async function getStripePrice(
  database: D1Database,
  productKey: string
): Promise<StripePriceMapping> {
  const row = await database
    .prepare(
      `SELECT stripe_price_id, price_amount, currency
       FROM offer_products WHERE product_key = ?`
    )
    .bind(productKey)
    .first<{ stripe_price_id: string | null; price_amount: number; currency: string }>();

  if (
    !row?.stripe_price_id ||
    !/^price_[A-Za-z0-9]+$/.test(row.stripe_price_id) ||
    !Number.isSafeInteger(row.price_amount) ||
    row.price_amount < 1 ||
    !/^[A-Za-z]{3}$/.test(row.currency)
  ) {
    throw new RequestError(
      `The product "${productKey}" is not connected to Stripe yet.`,
      503,
      'configuration_product'
    );
  }

  return {
    priceId: row.stripe_price_id,
    amount: row.price_amount,
    currency: row.currency.toLowerCase(),
  };
}

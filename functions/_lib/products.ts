import type { D1Database } from './runtime';
import { RequestError } from './runtime';

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

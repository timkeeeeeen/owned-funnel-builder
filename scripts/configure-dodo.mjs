import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import DodoPayments from 'dodopayments';
import { readLocalSettings, requireSetting } from './lib/local-settings.mjs';

const execute = promisify(execFile);
const settings = await readLocalSettings();
const apiKey = requireSetting(settings, 'DODO_PAYMENTS_API_KEY');
const environment = requireSetting(settings, 'DODO_PAYMENTS_ENVIRONMENT');
const databaseName = requireSetting(settings, 'FUNNEL_D1_DATABASE');
if (!['test_mode', 'live_mode'].includes(environment)) {
  throw new Error('Dodo mode must be test_mode or live_mode.');
}

const client = new DodoPayments({ bearerToken: apiKey, environment });
const funnelFiles = (await readdir('src/content/funnels')).filter((file) => file.endsWith('.json'));
const configuredProducts = [];
for (const file of funnelFiles) {
  const funnel = JSON.parse(await readFile(`src/content/funnels/${file}`, 'utf8'));
  configuredProducts.push(
    { ...funnel.base, offerSlug: funnel.offerSlug, role: 'main' },
    ...(funnel.bump ? [{ ...funnel.bump, offerSlug: funnel.offerSlug, role: 'bump' }] : []),
    ...funnel.upsells.map((product) => ({
      ...product,
      offerSlug: funnel.offerSlug,
      role: 'upsell',
    }))
  );
}

const existingProducts = [];
for await (const product of client.products.list()) existingProducts.push(product);

const results = [];
for (const product of configuredProducts) {
  let remote = existingProducts.find(
    (item) => item.metadata?.owned_funnel_product_key === product.productKey
  );
  if (!remote) {
    remote = await client.products.create({
      name: product.name,
      description: `Product for the ${product.offerSlug} funnel (${product.role}).`,
      price: {
        currency: product.currency,
        discount: 0,
        price: Math.round(product.priceAmount * 100),
        purchasing_power_parity: false,
        type: 'one_time_price',
      },
      tax_category: 'digital_products',
      metadata: {
        owned_funnel_product_key: product.productKey,
        offer_slug: product.offerSlug,
        funnel_role: product.role,
      },
    });
    console.log(`Created Dodo product: ${product.name}.`);
  } else {
    console.log(`Dodo product already connected: ${product.name}.`);
  }
  results.push({ product, remote });
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const statements = results.map(
  ({ product, remote }) =>
    `INSERT INTO offer_products (product_key, dodo_product_id, name, price_amount, currency, created_at, updated_at)
   VALUES (${quote(product.productKey)}, ${quote(remote.product_id)}, ${quote(product.name)}, ${Math.round(product.priceAmount * 100)}, ${quote(product.currency)}, ${quote(now)}, ${quote(now)})
   ON CONFLICT(product_key) DO UPDATE SET
     dodo_product_id = excluded.dodo_product_id,
     name = excluded.name,
     price_amount = excluded.price_amount,
     currency = excluded.currency,
     updated_at = excluded.updated_at;`
);

const wrangler = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
await execute(
  wrangler,
  ['d1', 'execute', databaseName, '--remote', '--command', statements.join('\n')],
  { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 }
);
console.log(`Connected ${results.length} Dodo products to the checkout database.`);

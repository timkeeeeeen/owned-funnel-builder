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
const skipRegistry = process.argv.includes('--skip-registry');
if (!['test_mode', 'live_mode'].includes(environment)) {
  throw new Error('Dodo mode must be test_mode or live_mode.');
}

const client = new DodoPayments({ bearerToken: apiKey, environment });
const deliveryFiles = {
  'owned-funnel-builder': '.funnel-state/deliverables/owned-funnel-builder.zip',
  'owned-funnel-conversion-copy-swipe-file':
    'deliverables/owned-funnel-builder/conversion-copy-swipe-file.md',
  'owned-funnel-ten-blueprints': 'deliverables/owned-funnel-builder/ten-funnel-blueprints.md',
  'owned-funnel-agency-toolkit':
    'deliverables/owned-funnel-builder/client-funnel-delivery-toolkit.md',
  'vibe-code-anything': '.funnel-state/deliverables/maestro-saas-ui-template.zip',
  'vibe-code-prompt-pack': 'deliverables/vibe-code-anything/vibe-coding-prompt-pack.md',
  'vibe-code-five-app-blueprints': 'deliverables/vibe-code-anything/five-app-blueprints.md',
  'vibe-code-production-launch-pack': 'deliverables/vibe-code-anything/production-launch-pack.md',
  'talking-head-ad-machine':
    '.funnel-state/deliverables/talking-head-ad-machine-macos-arm64-v0.1.0.zip',
  'talking-head-hook-recording-pack':
    '.funnel-state/deliverables/hook-recording-pack-v0.1.0.zip',
  'talking-head-ad-test-lab': '.funnel-state/deliverables/ad-test-lab-v0.1.0.zip',
};
const funnelFiles = (await readdir('src/content/funnels')).filter((file) => file.endsWith('.json'));
const configuredProducts = [];
for (const file of funnelFiles) {
  const funnel = JSON.parse(await readFile(`src/content/funnels/${file}`, 'utf8'));
  configuredProducts.push(
    {
      ...funnel.base,
      offerSlug: funnel.offerSlug,
      supportEmail: funnel.supportEmail,
      role: 'main',
    },
    ...(funnel.bump
      ? [
          {
            ...funnel.bump,
            offerSlug: funnel.offerSlug,
            supportEmail: funnel.supportEmail,
            role: 'bump',
          },
        ]
      : []),
    ...funnel.upsells.map((product) => ({
      ...product,
      offerSlug: funnel.offerSlug,
      supportEmail: funnel.supportEmail,
      role: 'upsell',
    }))
  );
}

const existingProducts = [];
for await (const product of client.products.list()) existingProducts.push(product);
const existingEntitlements = [];
for await (const entitlement of client.entitlements.list({ integration_type: 'digital_files' })) {
  existingEntitlements.push(entitlement);
}

const results = [];
for (const product of configuredProducts) {
  const deliveryPath = deliveryFiles[product.productKey];
  if (!deliveryPath) throw new Error(`No delivery file is configured for ${product.productKey}.`);
  const deliveryBytes = await readFile(deliveryPath);
  const deliveryFilename = deliveryPath.split('/').at(-1);

  let entitlement = existingEntitlements.find(
    (item) => item.metadata?.owned_funnel_product_key === product.productKey
  );
  if (!entitlement) {
    entitlement = await client.entitlements.create({
      name: `${product.name} access`,
      description: `Customer delivery for ${product.name}.`,
      integration_type: 'digital_files',
      integration_config: {
        digital_file_ids: [],
        instructions: `${product.deliveryBody} Sign in at customer.dodopayments.com whenever you need a fresh download link. For help, email ${product.supportEmail}.`,
      },
      metadata: {
        owned_funnel_product_key: product.productKey,
        offer_slug: product.offerSlug,
      },
    });
    existingEntitlements.push(entitlement);
    console.log(`Created Dodo delivery: ${product.name}.`);
  }

  const currentEntitlement = await client.entitlements.retrieve(entitlement.id);
  const currentFiles = currentEntitlement.integration_config?.digital_files?.files ?? [];
  if (!currentFiles.some((file) => file.filename === deliveryFilename)) {
    const form = new FormData();
    form.append('file', new File([deliveryBytes], deliveryFilename));
    await client.entitlements.files.upload(entitlement.id, { body: form });
    console.log(`Uploaded customer file: ${deliveryFilename}.`);
  } else {
    console.log(`Customer file already present: ${deliveryFilename}.`);
  }

  let remote = existingProducts.find(
    (item) => item.metadata?.owned_funnel_product_key === product.productKey
  );
  if (!remote) remote = existingProducts.find((item) => item.name === product.name);
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
      entitlements: [{ entitlement_id: entitlement.id }],
      metadata: {
        owned_funnel_product_key: product.productKey,
        offer_slug: product.offerSlug,
        funnel_role: product.role,
      },
    });
    console.log(`Created Dodo product: ${product.name}.`);
  } else {
    const attached = remote.entitlements?.map((item) => item.id) ?? [];
    await client.products.update(remote.product_id, {
      entitlements: [...new Set([...attached, entitlement.id])].map((id) => ({
        entitlement_id: id,
      })),
      metadata: {
        ...remote.metadata,
        owned_funnel_product_key: product.productKey,
        offer_slug: product.offerSlug,
        funnel_role: product.role,
      },
    });
    console.log(`Dodo product already connected: ${product.name}.`);
  }
  results.push({ product, remote });
}

if (skipRegistry) {
  console.log(`Verified ${results.length} Dodo products and their customer delivery files.`);
  process.exit(0);
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

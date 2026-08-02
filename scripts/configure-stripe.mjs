import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { readLocalSettings, requireSetting, writeLocalSettings } from './lib/local-settings.mjs';
import {
  collectStripePages,
  requireExistingWebhookSecret,
  stripeMinorAmount,
  stripeWebhookBody,
  validateStripeAccessUrl,
  validateStripeSetupCredentials,
} from './lib/stripe-setup.mjs';

const execute = promisify(execFile);
const settings = await readLocalSettings();
const secretKey = requireSetting(settings, 'STRIPE_SECRET_KEY');
const environment = requireSetting(settings, 'STRIPE_PAYMENTS_ENVIRONMENT');
const databaseName = requireSetting(settings, 'FUNNEL_D1_DATABASE');
const siteUrl = requireSetting(settings, 'PUBLIC_SITE_URL').replace(/\/$/, '');
requireSetting(settings, 'POSTMARK_SERVER_TOKEN');
requireSetting(settings, 'EMAIL_TRANSACTIONAL_FROM');

validateStripeSetupCredentials(secretKey, environment);

function appendMetadata(body, metadata) {
  for (const [key, value] of Object.entries(metadata)) {
    body.set(`metadata[${key}]`, String(value));
  }
}

async function stripeRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code || payload?.error?.type || `http_${response.status}`;
    throw new Error(`Stripe could not complete setup (${code}).`);
  }
  return payload;
}

async function stripeList(path, initial = {}) {
  return collectStripePages((requestPath) => stripeRequest(requestPath), path, initial);
}

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

const uniqueProducts = new Map();
for (const product of configuredProducts) {
  if (uniqueProducts.has(product.productKey)) {
    throw new Error(`The product key ${product.productKey} is used more than once.`);
  }
  validateStripeAccessUrl(product);
  uniqueProducts.set(product.productKey, product);
}

const remoteProducts = await stripeList('/products', { active: 'true' });
const results = [];
for (const product of uniqueProducts.values()) {
  const metadata = {
    owned_funnel_product_key: product.productKey,
    offer_slug: product.offerSlug,
    funnel_role: product.role,
  };
  let remoteProduct = remoteProducts.find(
    (item) => item.metadata?.owned_funnel_product_key === product.productKey
  );

  const productBody = new URLSearchParams({
    name: product.name,
    description: `Product for the ${product.offerSlug} funnel (${product.role}).`,
  });
  appendMetadata(productBody, metadata);
  if (!remoteProduct) {
    remoteProduct = await stripeRequest('/products', {
      method: 'POST',
      body: productBody,
      idempotencyKey: `owned-funnel-product:${product.productKey}`,
    });
    remoteProducts.push(remoteProduct);
    console.log(`Created Stripe product: ${product.name}.`);
  } else {
    await stripeRequest(`/products/${encodeURIComponent(remoteProduct.id)}`, {
      method: 'POST',
      body: productBody,
    });
    console.log(`Stripe product already connected: ${product.name}.`);
  }

  const amount = stripeMinorAmount(product.priceAmount, product.currency);
  const currency = String(product.currency).toLowerCase();
  const prices = await stripeList('/prices', { product: remoteProduct.id, active: 'true' });
  let price = prices.find(
    (item) => item.type === 'one_time' && item.unit_amount === amount && item.currency === currency
  );
  if (!price) {
    const priceBody = new URLSearchParams({
      product: remoteProduct.id,
      unit_amount: String(amount),
      currency,
    });
    appendMetadata(priceBody, metadata);
    price = await stripeRequest('/prices', {
      method: 'POST',
      body: priceBody,
      idempotencyKey: `owned-funnel-price:${product.productKey}:${currency}:${amount}`,
    });
    console.log(`Created Stripe price: ${product.name}.`);
  }
  results.push({ product, price });
}

const webhookUrl = `${siteUrl}/api/webhooks/stripe`;
const webhooks = await stripeList('/webhook_endpoints');
const existingWebhook = webhooks.find((item) => item.url === webhookUrl);
requireExistingWebhookSecret(existingWebhook, settings.STRIPE_WEBHOOK_SECRET);
if (!existingWebhook) {
  const webhook = await stripeRequest('/webhook_endpoints', {
    method: 'POST',
    body: stripeWebhookBody(webhookUrl),
    idempotencyKey: `owned-funnel-webhook:${new URL(siteUrl).hostname}`,
  });
  if (typeof webhook.secret !== 'string' || !webhook.secret.startsWith('whsec_')) {
    throw new Error('Stripe created the webhook without returning a valid signing secret.');
  }
  settings.STRIPE_WEBHOOK_SECRET = webhook.secret;
  console.log('Created the verified Stripe payment webhook.');
} else {
  await stripeRequest(`/webhook_endpoints/${encodeURIComponent(existingWebhook.id)}`, {
    method: 'POST',
    body: stripeWebhookBody(webhookUrl),
  });
  console.log('The Stripe payment webhook is connected with the required events.');
}

settings.PAYMENTS_PROVIDER = 'stripe';
await writeLocalSettings(settings);
console.log('Saved Stripe mode and webhook verification locally without printing secrets.');

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const statements = results.map(
  ({ product, price }) =>
    `INSERT INTO offer_products (
      product_key, dodo_product_id, stripe_price_id, name, price_amount, currency,
      created_at, updated_at
    ) VALUES (
      ${quote(product.productKey)}, NULL, ${quote(price.id)}, ${quote(product.name)},
      ${stripeMinorAmount(product.priceAmount, product.currency)}, ${quote(product.currency)}, ${quote(now)}, ${quote(now)}
    )
    ON CONFLICT(product_key) DO UPDATE SET
      stripe_price_id = excluded.stripe_price_id,
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
console.log(`Connected ${results.length} Stripe prices to the checkout database.`);

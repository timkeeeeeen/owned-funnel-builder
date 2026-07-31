export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

export function validateStripeSetupCredentials(secretKey, environment) {
  if (!['test_mode', 'live_mode'].includes(environment)) {
    throw new Error('Stripe mode must be test_mode or live_mode.');
  }

  const keyMode = /^(?:sk|rk)_test_/.test(secretKey)
    ? 'test_mode'
    : /^(?:sk|rk)_live_/.test(secretKey)
      ? 'live_mode'
      : '';
  if (keyMode !== environment) {
    throw new Error('The Stripe key does not match the selected test or live mode.');
  }
}

export function validateStripeAccessUrl(product) {
  let accessUrl;
  try {
    accessUrl = new URL(product.accessUrl);
  } catch {
    throw new Error(`${product.name} needs a valid HTTPS download or member-access link.`);
  }

  if (accessUrl.protocol !== 'https:' || accessUrl.username || accessUrl.password) {
    throw new Error(`${product.name} needs a valid HTTPS download or member-access link.`);
  }

  if (
    accessUrl.hostname === 'customer.dodopayments.com' ||
    accessUrl.hostname.endsWith('.dodopayments.com')
  ) {
    throw new Error(
      `${product.name} still points to Dodo for delivery. Add its real download or member-access link before connecting Stripe.`
    );
  }
}

export function stripeMinorAmount(amount, currencyValue) {
  const currency = String(currencyValue).trim().toUpperCase();
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Stripe product prices must be positive numbers.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Stripe product currency is invalid.');

  let fractionDigits;
  try {
    fractionDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw new Error('Stripe product currency is invalid.');
  }

  const exactMinorAmount = amount * 10 ** fractionDigits;
  const minorAmount = Math.round(exactMinorAmount);
  if (
    !Number.isSafeInteger(minorAmount) ||
    minorAmount < 1 ||
    Math.abs(exactMinorAmount - minorAmount) > Number.EPSILON * Math.abs(exactMinorAmount) * 4
  ) {
    throw new Error(`Stripe product price has too many decimal places for ${currency}.`);
  }
  return minorAmount;
}

export function requireExistingWebhookSecret(existingWebhook, savedSecret) {
  if (existingWebhook && (typeof existingWebhook.id !== 'string' || !existingWebhook.id)) {
    throw new Error('Stripe returned an invalid existing webhook during setup.');
  }
  if (existingWebhook && !savedSecret) {
    throw new Error(
      'The Stripe webhook already exists, but its signing secret is not saved here. Reveal that signing secret in Stripe Workbench, paste it into the private setup screen, and run setup again.'
    );
  }
  if (existingWebhook && !savedSecret.startsWith('whsec_')) {
    throw new Error('The saved Stripe webhook signing secret is invalid.');
  }
}

export function stripeWebhookBody(webhookUrl) {
  const body = new URLSearchParams({
    url: webhookUrl,
    description: 'Owned Funnel Builder payment verification and fulfillment',
  });
  STRIPE_WEBHOOK_EVENTS.forEach((eventType, index) =>
    body.set(`enabled_events[${index}]`, eventType)
  );
  return body;
}

export async function collectStripePages(requestPage, path, initial = {}) {
  const items = [];
  const cursors = new Set();
  let startingAfter = '';

  for (;;) {
    const query = new URLSearchParams({ ...initial, limit: '100' });
    if (startingAfter) query.set('starting_after', startingAfter);
    const page = await requestPage(`${path}?${query.toString()}`);
    const data = Array.isArray(page?.data) ? page.data : [];
    items.push(...data);
    if (!page?.has_more) return items;

    const nextCursor = data.at(-1)?.id;
    if (typeof nextCursor !== 'string' || !nextCursor || cursors.has(nextCursor)) {
      throw new Error('Stripe returned an invalid pagination cursor during setup.');
    }
    cursors.add(nextCursor);
    startingAfter = nextCursor;
  }
}

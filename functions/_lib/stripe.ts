import { cleanString, readEnvironmentValue, RequestError, type Environment } from './runtime';

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';
const STRIPE_TIMEOUT_MS = 15_000;
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface StripePaymentIntent {
  id?: unknown;
  amount?: unknown;
  amount_received?: unknown;
  currency?: unknown;
  customer?: unknown;
  metadata?: unknown;
  payment_method?: unknown;
  receipt_email?: unknown;
  status?: unknown;
}

export interface StripeCheckoutSession {
  id?: unknown;
  customer?: unknown;
  customer_details?: { email?: unknown } | null;
  metadata?: unknown;
  payment_intent?: unknown;
  payment_status?: unknown;
  status?: unknown;
  url?: unknown;
}

interface StripeErrorPayload {
  error?: {
    code?: unknown;
    decline_code?: unknown;
    message?: unknown;
    payment_intent?: StripePaymentIntent;
    type?: unknown;
  };
}

export class StripeApiError extends Error {
  constructor(
    readonly responseStatus: number,
    readonly stripeCode: string,
    readonly paymentIntent: StripePaymentIntent | null
  ) {
    super('Stripe could not complete that payment request.');
  }
}

export function getStripeConfig(env: Environment): {
  secretKey: string;
  checkoutMode: 'test' | 'live';
} {
  const secretKey = readEnvironmentValue(env, 'STRIPE_SECRET_KEY');
  if (!secretKey) {
    throw new RequestError('Checkout is not configured yet.', 503, 'configuration_credentials');
  }

  const configuredMode = readEnvironmentValue(env, 'STRIPE_PAYMENTS_ENVIRONMENT');
  if (!['test_mode', 'live_mode'].includes(configuredMode)) {
    throw new RequestError('Checkout is not configured yet.', 503, 'configuration_environment');
  }

  const keyMode = /^(?:sk|rk)_test_/.test(secretKey)
    ? 'test'
    : /^(?:sk|rk)_live_/.test(secretKey)
      ? 'live'
      : null;
  if (!keyMode || `${keyMode}_mode` !== configuredMode) {
    throw new RequestError(
      'The Stripe key does not match the selected checkout mode.',
      503,
      'configuration_credentials'
    );
  }

  return { secretKey, checkoutMode: keyMode };
}

export function assertStripeFulfillmentConfig(env: Environment): void {
  const apiKey = readEnvironmentValue(env, 'RESEND_API_KEY');
  const from = readEnvironmentValue(env, 'RESEND_FROM_EMAIL');
  if (!apiKey || !from) {
    throw new RequestError(
      'Stripe checkout needs the access-email connection before it can accept payments.',
      503,
      'configuration_fulfillment'
    );
  }
}

export async function stripeRequest<T>(
  env: Environment,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { secretKey } = getStripeConfig(env);
  const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as StripeErrorPayload).error
        : undefined;
    throw new StripeApiError(
      response.status,
      cleanString(error?.code ?? error?.decline_code ?? error?.type, 120),
      error?.payment_intent ?? null
    );
  }

  return payload as T;
}

export function appendStripeMetadata(
  body: URLSearchParams,
  metadata: Record<string, string>,
  prefix = 'metadata'
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (value) body.set(`${prefix}[${key}]`, value);
  }
}

export function appendStripeLineItems(body: URLSearchParams, priceIds: string[]): void {
  priceIds.forEach((priceId, index) => {
    body.set(`line_items[${index}][price]`, priceId);
    body.set(`line_items[${index}][quantity]`, '1');
  });
}

export function validateStripeCheckoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Stripe did not return a checkout URL.');
  const checkoutUrl = new URL(value);
  if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
    throw new Error('Stripe returned an unexpected checkout URL.');
  }
  return checkoutUrl.toString();
}

export function stripeObjectId(value: unknown): string {
  if (typeof value === 'string') return cleanString(value, 180);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return cleanString((value as { id?: unknown }).id, 180);
  }
  return '';
}

export function isRecoverableStripePaymentError(error: unknown): boolean {
  if (!(error instanceof StripeApiError)) return false;
  const paymentStatus = cleanString(error.paymentIntent?.status, 80);
  return (
    error.responseStatus === 402 ||
    ['authentication_required', 'card_declined', 'payment_method_provider_decline'].includes(
      error.stripeCode
    ) ||
    ['requires_action', 'requires_payment_method'].includes(paymentStatus)
  );
}

function decodeHex(value: string): ArrayBuffer | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  endpointSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const parts = signatureHeader.split(',').map((part) => part.trim());
  const timestampValue = parts.find((part) => part.startsWith('t='))?.slice(2) ?? '';
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!/^\d+$/.test(timestampValue) || signatures.length === 0) return false;

  const timestamp = Number(timestampValue);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(endpointSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signedPayload = new TextEncoder().encode(`${timestampValue}.${rawBody}`);
  const checks = signatures.map((signature) => {
    const received = decodeHex(signature);
    return received
      ? crypto.subtle.verify('HMAC', key, received, signedPayload)
      : Promise.resolve(false);
  });
  return (await Promise.all(checks)).some(Boolean);
}

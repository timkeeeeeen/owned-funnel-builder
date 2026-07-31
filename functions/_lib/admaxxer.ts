import { cleanString, readEnvironmentValue, type Environment } from './runtime';

const ADMAXXER_PAYMENTS_URL = 'https://admaxxer.com/api/v1/payments';

export interface AdmaxxerPayment {
  paymentId: unknown;
  totalAmount: unknown;
  currency: unknown;
  visitorId?: unknown;
  email?: unknown;
}

function currencyFractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    throw new Error('The payment currency is invalid.');
  }
}

export function minorUnitsToMajor(totalAmount: unknown, currencyValue: unknown): number {
  const currency = cleanString(currencyValue, 3).toUpperCase();
  if (!currency || currency.length !== 3) throw new Error('The payment currency is missing.');
  if (typeof totalAmount !== 'number' || !Number.isSafeInteger(totalAmount) || totalAmount < 0) {
    throw new Error('The payment amount is invalid.');
  }

  return totalAmount / 10 ** currencyFractionDigits(currency);
}

export async function recordAdmaxxerPayment(
  env: Environment,
  payment: AdmaxxerPayment
): Promise<boolean> {
  const apiKey = readEnvironmentValue(env, 'ADMAXXER_API_KEY');
  if (!apiKey) return false;

  const transactionId = cleanString(payment.paymentId, 180);
  const currency = cleanString(payment.currency, 3).toUpperCase();
  if (!transactionId) throw new Error('The payment ID is missing.');

  const visitorId = cleanString(payment.visitorId, 180);
  const email = cleanString(payment.email, 320).toLowerCase();
  const body: Record<string, string | number> = {
    amount: minorUnitsToMajor(payment.totalAmount, currency),
    currency,
    transaction_id: transactionId,
  };
  if (visitorId) body.admaxxer_visitor_id = visitorId;
  if (email) body.email = email;

  const response = await fetch(ADMAXXER_PAYMENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Admaxxer payment attribution failed with status ${response.status}.`);
  }

  return true;
}

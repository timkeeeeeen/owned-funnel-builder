export interface D1RunResult {
  success: boolean;
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: Array<string | number | null>): D1PreparedStatement;
  run(): Promise<D1RunResult>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Environment {
  LEADS?: D1Database;
  [key: string]: unknown;
}

export interface PagesContext {
  request: Request;
  env: Environment;
}

export const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export function cleanString(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

export function readEnvironmentValue(env: Environment, key: string): string {
  return cleanString(env[key], 4096);
}

export function parseDodoEnvironment(value: string): {
  apiBaseUrl: string;
  checkoutMode: 'test' | 'live';
} {
  if (['test', 'test_mode', 'sandbox'].includes(value)) {
    return { apiBaseUrl: 'https://test.dodopayments.com', checkoutMode: 'test' };
  }

  if (['live', 'live_mode', 'production'].includes(value)) {
    return { apiBaseUrl: 'https://live.dodopayments.com', checkoutMode: 'live' };
  }

  throw new RequestError('Checkout is not configured yet.', 503, 'configuration_environment');
}

export function getDodoConfig(env: Environment): {
  apiKey: string;
  apiBaseUrl: string;
  checkoutMode: 'test' | 'live';
} {
  const apiKey = readEnvironmentValue(env, 'DODO_PAYMENTS_API_KEY');
  if (!apiKey) {
    throw new RequestError('Checkout is not configured yet.', 503, 'configuration_credentials');
  }

  return {
    apiKey,
    ...parseDodoEnvironment(readEnvironmentValue(env, 'DODO_PAYMENTS_ENVIRONMENT')),
  };
}

export async function dodoRequest<T>(
  env: Environment,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { apiKey, apiBaseUrl } = getDodoConfig(env);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new RequestError(
      'The payment provider could not complete that request.',
      502,
      `dodo_${response.status}`
    );
  }

  return (await response.json()) as T;
}

export function randomFlowToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function hashFlowToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validFlowToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

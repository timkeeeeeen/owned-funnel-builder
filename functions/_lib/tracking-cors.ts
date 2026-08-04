const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_HEADERS = ['content-type', 'x-csrf-nonce'];

export type CorsRequest = {
  host?: string | null;
  allowedHost?: string;
  preflightMethod?: string | null;
  requestedHeaders?: string | null;
};

function origins(value: readonly string[] | string): readonly string[] {
  return typeof value === 'string' ? [value] : value;
}

function exactOrigin(origin: string | null, allowlist: readonly string[]): boolean {
  return origin !== null && origin !== 'null' && allowlist.includes(origin);
}

function validPreflight(request: CorsRequest | undefined): boolean {
  if (!request || request.host === undefined || request.allowedHost === undefined) return false;
  if (
    request.preflightMethod !== undefined &&
    request.preflightMethod !== null &&
    request.preflightMethod !== 'POST'
  )
    return false;
  if (request.requestedHeaders === undefined || request.requestedHeaders === null) return true;
  return request.requestedHeaders
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
    .every((header) => ALLOW_HEADERS.includes(header));
}

export function corsHeaders(
  origin: string | null,
  allowedOrigins: readonly string[] | string,
  request: CorsRequest
): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (
    !exactOrigin(origin, origins(allowedOrigins)) ||
    !request ||
    (request.allowedHost !== undefined && request.host !== request.allowedHost) ||
    !validPreflight(request)
  ) {
    return headers;
  }
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS.join(', '));
  headers.set('Access-Control-Expose-Headers', 'x-csrf-nonce');
  return headers;
}

function base64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function createCsrfNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function sameOriginNoCors(
  request: Request,
  expectedOrigin: string,
  expectedHost: string
): boolean {
  if (request.method !== 'POST' || request.headers.has('access-control-request-method'))
    return false;
  if (request.headers.get('origin') !== expectedOrigin) return false;
  if (new URL(request.url).host !== expectedHost) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin';
}

export function verifyCsrfNonce(
  request: Request,
  expectedNonce: string,
  expectedOrigin: string,
  expectedHost: string
): boolean {
  return (
    sameOriginNoCors(request, expectedOrigin, expectedHost) &&
    request.headers.get('x-csrf-nonce') === expectedNonce
  );
}

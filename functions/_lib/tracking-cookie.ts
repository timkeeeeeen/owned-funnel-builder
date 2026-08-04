export const COOKIE_DOMAIN = 'shop.maestrogtm.com';
export const VISITOR_MAX_AGE = 34_560_000;
export const SESSION_INACTIVITY_SECONDS = 1_800;

export type TrackingCookieName = 'ma_vid' | 'ma_sid' | 'ma_privacy';
export type CookieContext = {
  tenantId: string;
  siteId: string;
  environment: 'preview' | 'live';
};
export type SignedCookieInput = CookieContext & {
  name: TrackingCookieName;
  value: string;
  keyId: string;
  maxAge: number;
};

function base64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function contextMessage(context: CookieContext): string {
  return [context.tenantId, context.siteId, context.environment]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}

function cookieAttributes(maxAge: number): string {
  return `Max-Age=${maxAge}; Domain=${COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** Signs with the already-imported Worker secret; the verifier never handles raw key material. */
export async function issueSignedCookie(
  input: SignedCookieInput,
  signingKey: CryptoKey
): Promise<string> {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.keyId) ||
    !input.value ||
    !input.tenantId ||
    !input.siteId ||
    !['preview', 'live'].includes(input.environment) ||
    input.maxAge < 0 ||
    !Number.isSafeInteger(input.maxAge)
  ) {
    throw new TypeError('Invalid tracking cookie');
  }
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        value: input.value,
        tenantId: input.tenantId,
        siteId: input.siteId,
        environment: input.environment,
      })
    )
  );
  const unsigned = `v2.${input.keyId}.${payload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    new TextEncoder().encode(`${input.name}.${contextMessage(input)}.${unsigned}`)
  );
  return `${input.name}=${unsigned}.${base64url(new Uint8Array(signature))}; ${cookieAttributes(input.maxAge)}`;
}

function cookieValues(header: string, name: string): string[] {
  return header
    .split(';')
    .map((part) => part.trim())
    .flatMap((part) => {
      const index = part.indexOf('=');
      return index === -1 || part.slice(0, index) !== name ? [] : [part.slice(index + 1)];
    });
}

export async function verifySignedCookie(
  header: string | null,
  name: TrackingCookieName,
  verifyKeys: Record<string, CryptoKey>,
  expected: CookieContext
): Promise<string | null> {
  if (!header || !['ma_vid', 'ma_sid', 'ma_privacy'].includes(name)) return null;
  const values = cookieValues(header, name);
  if (values.length !== 1) return null;
  const match = /^v2\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(values[0]!);
  if (!match) return null;
  const [, keyId, payload, signature] = match;
  const verifyKey = verifyKeys[keyId!];
  const payloadBytes = decodeBase64url(payload!);
  const signatureBytes = decodeBase64url(signature!);
  if (!verifyKey || !payloadBytes || !signatureBytes) return null;

  let decoded: Partial<CookieContext> & { value?: unknown };
  try {
    decoded = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<CookieContext> & {
      value?: unknown;
    };
  } catch {
    return null;
  }
  if (
    decoded.tenantId !== expected.tenantId ||
    decoded.siteId !== expected.siteId ||
    decoded.environment !== expected.environment ||
    typeof decoded.value !== 'string' ||
    !decoded.value
  ) {
    return null;
  }
  if (
    Object.keys(decoded).some(
      (key) => !['value', 'tenantId', 'siteId', 'environment'].includes(key)
    )
  )
    return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    verifyKey,
    signatureBytes,
    new TextEncoder().encode(`${name}.${contextMessage(expected)}.v2.${keyId}.${payload}`)
  );
  return valid ? decoded.value : null;
}

export function deleteTrackingCookie(name: TrackingCookieName): string {
  return `${name}=; ${cookieAttributes(0)}`;
}

export function trackingCookieNames(decisions: {
  analytics: boolean;
  advertising: boolean;
}): TrackingCookieName[] {
  return decisions.analytics || decisions.advertising
    ? ['ma_privacy', 'ma_vid', 'ma_sid']
    : ['ma_privacy'];
}

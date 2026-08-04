export const COOKIE_DOMAIN = 'shop.maestrogtm.com';
export const VISITOR_MAX_AGE = 34_560_000;
export const SESSION_INACTIVITY_SECONDS = 1_800;

export type TrackingCookieName = 'ma_vid' | 'ma_sid' | 'ma_privacy';
type SigningKey = string | CryptoKey;

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

async function hmacKey(key: SigningKey): Promise<CryptoKey> {
  if (typeof key !== 'string') return key;
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signedValue(value: string, key: SigningKey): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(key), new TextEncoder().encode(value));
  return base64url(new Uint8Array(signature));
}

function cookieAttributes(maxAge: number): string {
  return `Max-Age=${maxAge}; Domain=${COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** The signing key is intentionally explicit: a key id is not secret material. */
export async function issueSignedCookie(
  name: TrackingCookieName,
  value: string,
  keyId: string,
  maxAge: number,
  key: SigningKey
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !value || maxAge < 0 || !Number.isSafeInteger(maxAge)) {
    throw new TypeError('Invalid tracking cookie');
  }
  const payload = base64url(new TextEncoder().encode(value));
  const valueToSign = `v1.${keyId}.${payload}`;
  return `${name}=${valueToSign}.${await signedValue(`${name}.${valueToSign}`, key)}; ${cookieAttributes(maxAge)}`;
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
  name: string,
  keys: Record<string, SigningKey>
): Promise<string | null> {
  if (!header) return null;
  const values = cookieValues(header, name);
  if (values.length !== 1) return null;
  const match = /^v1\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(values[0]!);
  if (!match) return null;
  const [, keyId, payload, signature] = match;
  const key = keys[keyId!];
  const bytes = decodeBase64url(payload!);
  const signatureBytes = decodeBase64url(signature!);
  if (!key || !bytes || !signatureBytes) return null;
  const unsigned = `${name}.v1.${keyId}.${payload}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(key),
    signatureBytes,
    new TextEncoder().encode(unsigned)
  );
  return valid ? new TextDecoder().decode(bytes) : null;
}

export function deleteTrackingCookie(name: TrackingCookieName): string {
  return `${name}=; ${cookieAttributes(0)}`;
}

export function trackingCookieNames(decisions: { analytics: boolean; advertising: boolean }): TrackingCookieName[] {
  return decisions.analytics || decisions.advertising
    ? ['ma_privacy', 'ma_vid', 'ma_sid']
    : ['ma_privacy'];
}

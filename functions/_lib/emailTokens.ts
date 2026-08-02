const encoder = new TextEncoder();

const encodeBase64Url = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const decodeBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

export async function createUnsubscribeToken(options: {
  subscriberId: string;
  secret: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(options.subscriberId)) {
    throw new Error('Subscriber ID is invalid.');
  }
  if (options.secret.length < 32) throw new Error('Unsubscribe secret is too short.');
  const expiresAt =
    (options.nowSeconds ?? Math.floor(Date.now() / 1000)) + (options.ttlSeconds ?? 31_536_000);
  const payload = `${options.subscriberId}.${expiresAt}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importKey(options.secret), encoder.encode(payload))
  );
  return `${payload}.${encodeBase64Url(signature)}`;
}

export async function verifyUnsubscribeToken(options: {
  token: string;
  secret: string;
  nowSeconds?: number;
}): Promise<{ subscriberId: string } | null> {
  if (options.secret.length < 32) return null;
  const [subscriberId, expiresAtValue, signatureValue, extra] = options.token.split('.');
  if (
    extra !== undefined ||
    !subscriberId ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(subscriberId) ||
    !expiresAtValue ||
    !/^\d+$/.test(expiresAtValue) ||
    !signatureValue
  ) {
    return null;
  }
  const expiresAt = Number(expiresAtValue);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < (options.nowSeconds ?? Math.floor(Date.now() / 1000))
  ) {
    return null;
  }
  const signature = decodeBase64Url(signatureValue);
  if (!signature) return null;
  const signatureBuffer = new ArrayBuffer(signature.byteLength);
  new Uint8Array(signatureBuffer).set(signature);
  const payload = `${subscriberId}.${expiresAtValue}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importKey(options.secret),
    signatureBuffer,
    encoder.encode(payload)
  );
  return valid ? { subscriberId } : null;
}

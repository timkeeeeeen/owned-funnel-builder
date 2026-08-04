import type { SourceSystem } from '../../../functions/_lib/tracking-contract.ts';

export const SOURCE_SYSTEMS = new Set<SourceSystem>(['pages', 'app_idea', 'blueprint']);
export const AUTHORITATIVE_EVENTS = new Set(['Lead', 'InitiateCheckout', 'Purchase']);

export type PrivacySnapshot = {
  schema_version: '1';
  server_subject_ref: string;
  subject_ref_version: string;
  snapshot_issued_at: string;
  snapshot_expires_at: string;
  snapshot_key_id: string;
  snapshot_signature: string;
  purposes: Record<
    'necessary' | 'analytics' | 'advertising' | 'identity_enrichment' | 'sale_share',
    'granted' | 'denied' | 'unknown'
  >;
  policy_version: string;
  choice_id: string;
  decision_source: 'banner' | 'gpc' | 'operator' | 'policy';
  notice_locale: string;
  region: string;
  region_source: string;
  gpc: boolean;
  observed_at: string;
};

export type SourceEventEnvelope = {
  schema_version: '1';
  source_system: SourceSystem;
  source_event_id: string;
  event_name: 'Lead' | 'InitiateCheckout' | 'Purchase';
  occurred_at: string;
  context_hash: string;
  context_expires_at: string;
  funnel_slug: string;
  product_id?: string;
  lead_id?: string;
  checkout_session_id?: string;
  payment_id?: string;
  value?: number;
  currency?: string;
  num_items?: number;
  content_ids?: string[];
  contents?: Array<{ id: string; quantity: number }>;
  privacy_snapshot: PrivacySnapshot;
};

const ID = /^[A-Za-z0-9:_-]{1,180}$/;
const HASH = /^[a-f0-9]{64}$/i;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SKEW_SECONDS = 300;

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importHmac(value: unknown, usages: KeyUsage[] = ['verify']): Promise<CryptoKey | null> {
  if (value && typeof value === 'object' && 'type' in value) return value as CryptoKey;
  if (typeof value !== 'string' || value.length < 16 || value.length > 4096) return null;
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

export async function bodyHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return base64url(new Uint8Array(digest));
}

export async function sourceSignatureInput(timestamp: string, nonce: string, body: string): Promise<string> {
  return `v1\n${timestamp}\n${nonce}\n${await bodyHash(body)}\n${body}`;
}

function envText(env: Record<string, unknown>, key: string, fallback = ''): string {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4096) : fallback;
}

export function sourceKey(env: Record<string, unknown>, source: SourceSystem): unknown {
  return env[`TRACKING_${source.toUpperCase()}_BRIDGE_KEY_CURRENT`];
}

export async function verifySignedBridge(
  request: Request,
  body: string,
  env: Record<string, unknown>,
  source: SourceSystem,
  audience: string
): Promise<boolean> {
  const issuer = request.headers.get('x-maestro-issuer') ?? '';
  const keyId = request.headers.get('x-maestro-key-id') ?? '';
  const timestamp = request.headers.get('x-maestro-timestamp') ?? '';
  const nonce = request.headers.get('x-maestro-nonce') ?? '';
  const signature = request.headers.get('x-maestro-signature') ?? '';
  const expectedKeyId = envText(
    env,
    `TRACKING_${source.toUpperCase()}_BRIDGE_KEY_ID_CURRENT`,
    `${source}-current`
  );
  const expectedAudience = envText(env, `TRACKING_${source.toUpperCase()}_BRIDGE_AUDIENCE`, audience);
  if (
    issuer !== source ||
    keyId !== expectedKeyId ||
    !KEY_ID.test(keyId) ||
    !/^\d{10}$/.test(timestamp) ||
    !NONCE.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS
  )
    return false;
  const key = await importHmac(sourceKey(env, source));
  if (!key) return false;
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/').padEnd(44, '=')),
      (char) => char.charCodeAt(0)
    ),
    new TextEncoder().encode(await sourceSignatureInput(timestamp, nonce, body))
  );
  if (!valid) return false;
  // Audience is selected by the Worker route and can be pinned per source.
  // It is never trusted from a browser/body field.
  return expectedAudience === audience;
}

function validDate(value: unknown, maximumFutureSeconds = 600): value is string {
  if (typeof value !== 'string') return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= Date.now() + maximumFutureSeconds * 1000;
}

export function validatePrivacySnapshot(value: unknown): PrivacySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const purposes = input.purposes;
  if (!purposes || typeof purposes !== 'object' || Array.isArray(purposes)) return null;
  const purposeNames = ['necessary', 'analytics', 'advertising', 'identity_enrichment', 'sale_share'] as const;
  if (purposeNames.some((name) => !['granted', 'denied', 'unknown'].includes((purposes as Record<string, unknown>)[name] as string))) return null;
  if (
    input.schema_version !== '1' ||
    typeof input.server_subject_ref !== 'string' ||
    typeof input.subject_ref_version !== 'string' ||
    !validDate(input.snapshot_issued_at) ||
    !validDate(input.snapshot_expires_at, 86400 * 7) ||
    Date.parse(input.snapshot_expires_at as string) <= Date.now() ||
    typeof input.snapshot_key_id !== 'string' ||
    !KEY_ID.test(input.snapshot_key_id) ||
    typeof input.snapshot_signature !== 'string' ||
    !/^[A-Za-z0-9_-]{16,1024}$/.test(input.snapshot_signature) ||
    typeof input.policy_version !== 'string' ||
    typeof input.choice_id !== 'string' ||
    !['banner', 'gpc', 'operator', 'policy'].includes(input.decision_source as string) ||
    typeof input.notice_locale !== 'string' ||
    typeof input.region !== 'string' ||
    typeof input.region_source !== 'string' ||
    typeof input.gpc !== 'boolean' ||
    !validDate(input.observed_at)
  ) return null;
  return { ...input, purposes: { ...(purposes as Record<string, 'granted' | 'denied' | 'unknown'>) } } as PrivacySnapshot;
}

export function parseSourceEventEnvelope(value: unknown, source: SourceSystem): SourceEventEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !SOURCE_SYSTEMS.has(source))
    throw new TypeError('invalid_source_envelope');
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    'schema_version', 'source_system', 'source_event_id', 'event_name', 'occurred_at',
    'context_hash', 'context_expires_at', 'funnel_slug', 'product_id', 'lead_id',
    'checkout_session_id', 'payment_id', 'value', 'currency', 'num_items', 'content_ids', 'contents', 'privacy_snapshot',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new TypeError('invalid_source_envelope');
  if (
    input.schema_version !== '1' || input.source_system !== source ||
    typeof input.source_event_id !== 'string' || !ID.test(input.source_event_id) ||
    !AUTHORITATIVE_EVENTS.has(input.event_name) || !validDate(input.occurred_at, 86400) ||
    typeof input.context_hash !== 'string' || !HASH.test(input.context_hash) ||
    !validDate(input.context_expires_at, 86400 * 7) || Date.parse(input.context_expires_at as string) <= Date.now() ||
    typeof input.funnel_slug !== 'string' || !ID.test(input.funnel_slug)
  ) throw new TypeError('invalid_source_envelope');
  for (const key of ['product_id', 'lead_id', 'checkout_session_id', 'payment_id']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !ID.test(input[key])))
      throw new TypeError('invalid_source_envelope');
  }
  if (input.event_name === 'Lead' && typeof input.lead_id !== 'string') throw new TypeError('invalid_source_envelope');
  if (input.event_name === 'InitiateCheckout' && typeof input.checkout_session_id !== 'string') throw new TypeError('invalid_source_envelope');
  if (input.event_name === 'Purchase' && typeof input.payment_id !== 'string') throw new TypeError('invalid_source_envelope');
  if (input.value !== undefined && (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value <= 0)) throw new TypeError('invalid_source_envelope');
  if (input.currency !== undefined && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) throw new TypeError('invalid_source_envelope');
  if (input.num_items !== undefined && (!Number.isSafeInteger(input.num_items) || (input.num_items as number) < 0)) throw new TypeError('invalid_source_envelope');
  if (input.content_ids !== undefined && (!Array.isArray(input.content_ids) || input.content_ids.length > 50 || input.content_ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,180}$/.test(id)))) throw new TypeError('invalid_source_envelope');
  if (input.contents !== undefined && (!Array.isArray(input.contents) || input.contents.length > 50 || input.contents.some((item) => !item || typeof item !== 'object' || typeof (item as Record<string, unknown>).id !== 'string' || !Number.isSafeInteger((item as Record<string, unknown>).quantity)))) throw new TypeError('invalid_source_envelope');
  const snapshot = validatePrivacySnapshot(input.privacy_snapshot);
  if (!snapshot) throw new TypeError('invalid_privacy_snapshot');
  return { ...input, privacy_snapshot: snapshot } as SourceEventEnvelope;
}

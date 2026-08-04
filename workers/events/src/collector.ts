import type {
  CanonicalEvent,
  EventName,
  SourceSystem,
} from '../../../functions/_lib/tracking-contract.ts';
import { validateCanonicalEvent } from '../../../functions/_lib/tracking-contract.ts';
import {
  projectPermittedFields,
  validateTrackingArtifacts,
  type TrackingFieldRule,
} from '../../../functions/_lib/tracking-policy.ts';
import privacyPolicy from '../../../config/privacy-policy.json';
import fieldPolicy from '../../../config/tracking-field-policy.json';
import trustedHosts from '../../../config/trusted-hosts.json';
import sourceRuntimeManifest from '../../../config/source-runtime-manifest.json';
import rolloutState from '../../../config/rollout-state.json';
import providerCapabilities from '../../../config/provider-capabilities.json';
import type { D1Database } from '../../../functions/_lib/runtime.ts';
import {
  corsHeaders,
  createCsrfNonce,
  sameOriginNoCors,
} from '../../../functions/_lib/tracking-cors.ts';
import {
  issueSignedCookie,
  verifySignedCookie,
  type CookieContext,
  type TrackingCookieName,
} from '../../../functions/_lib/tracking-cookie.ts';
import {
  recordGpcObservation,
  loadPrivacyState,
  allows,
  privacyBody,
  suppressPendingForSubject,
} from './privacy.ts';
import { persistCanonicalEvent, type QueueLike } from './outbox.ts';
import { createPrivacyRequest } from './privacy-requests.ts';
import { healthResponse, jsonResponse, redactError } from './observability.ts';
import {
  SOURCE_SYSTEMS,
  parseSourceEventEnvelope,
  verifySignedBridge,
  type PrivacySnapshot,
  validatePrivacySnapshot,
} from './source-bridge.ts';

export type CollectorEnv = Record<string, unknown> & {
  TRACKING_DB: D1Database;
  EVENTS_QUEUE?: QueueLike;
  TRACKING_CONTEXT_SIGN?: TrackingContextSigner;
  TRACKING_CONTEXT_VERIFY?: TrackingContextVerifier;
  TRACKING_FLOW_BINDING_VERIFY?: (flowBinding: string, funnelId: string, paymentIds: string[]) => Promise<boolean> | boolean;
};

export type ExecutionContextLike = { waitUntil?(promise: Promise<unknown>): void };

const EVENT_MAX_BYTES = 64 * 1024;
const BODY_MAX_DEPTH = 8;
const BODY_MAX_ITEMS = 100;
const trackingControls = {
  privacyPolicy,
  fieldPolicy,
  trustedHosts,
  sourceRuntimeManifest,
  rolloutState,
  providerCapabilities,
};
const trackingFieldPolicy = fieldPolicy.rules as TrackingFieldRule[];

type EventContext = {
  tenant_id: string;
  site_id: string;
  funnel_id: string;
  subject_id: string;
  subject_deleted: boolean;
  policy_version: string;
  flow_binding?: string;
  buyer_context?: Record<string, unknown>;
};
type TrackingContextVerifier = (
  contextHash: string
) => EventContext | null | Promise<EventContext | null>;
type TrackingContextSigner = (context: EventContext) => string | Promise<string>;

function base64url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(
      value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=')
    );
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return base64url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

async function signTrackingContext(
  env: CollectorEnv,
  context: EventContext
): Promise<string | null> {
  if (typeof env.TRACKING_CONTEXT_SIGN === 'function') return env.TRACKING_CONTEXT_SIGN(context);
  const secret = env.TRACKING_CONTEXT_SIGNING_KEY_CURRENT;
  const keyId = textEnv(env, 'TRACKING_CONTEXT_SIGNING_KEY_ID_CURRENT');
  if (typeof secret !== 'string' || secret.length < 32 || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
    return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify([
        context.tenant_id,
        context.site_id,
        context.funnel_id,
        context.subject_id,
        context.subject_deleted ? 1 : 0,
        context.policy_version,
        Math.floor(Date.now() / 1000) + 300,
      ])
    )
  );
  const unsigned = `v1.${keyId}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

async function verifyTrackingContextToken(
  env: CollectorEnv,
  token: string
): Promise<EventContext | null> {
  const match = token.match(
    /^v1\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16,512})\.([A-Za-z0-9_-]{43})$/
  );
  if (!match) return null;
  const [, keyId, payload, encodedSignature] = match;
  const currentKeyId = textEnv(env, 'TRACKING_CONTEXT_SIGNING_KEY_ID_CURRENT');
  const previousKeyId = textEnv(env, 'TRACKING_CONTEXT_SIGNING_KEY_ID_PREVIOUS');
  const secret =
    keyId === currentKeyId
      ? env.TRACKING_CONTEXT_SIGNING_KEY_CURRENT
      : keyId === previousKeyId
        ? env.TRACKING_CONTEXT_SIGNING_KEY_PREVIOUS
        : null;
  if (typeof secret !== 'string' || secret.length < 32) return null;
  const signature = decodeBase64url(encodedSignature);
  if (!signature) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(`v1.${keyId}.${payload}`)
    ))
  )
    return null;
  const decodedPayload = decodeBase64url(payload);
  if (!decodedPayload) return null;
  try {
    const context = JSON.parse(new TextDecoder().decode(decodedPayload)) as unknown;
    if (!Array.isArray(context) || context.length !== 7) return null;
    const [tenantId, siteId, funnelId, subjectId, subjectDeleted, policyVersion, expiresAt] =
      context;
    const boundedString = (value: unknown, maximum: number): value is string =>
      typeof value === 'string' && value.length > 0 && value.length <= maximum;
    const now = Math.floor(Date.now() / 1000);
    if (
      !boundedString(tenantId, 128) ||
      !boundedString(siteId, 256) ||
      !boundedString(funnelId, 256) ||
      !boundedString(subjectId, 256) ||
      (subjectDeleted !== 0 && subjectDeleted !== 1) ||
      !boundedString(policyVersion, 128) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 300
    )
      return null;
    return {
      tenant_id: tenantId,
      site_id: siteId,
      funnel_id: funnelId,
      subject_id: subjectId,
      subject_deleted: subjectDeleted === 1,
      policy_version: policyVersion,
    };
  } catch {
    return null;
  }
}

function projectedEvent(
  event: CanonicalEvent,
  state: { decisions: Parameters<typeof projectPermittedFields>[1] }
): CanonicalEvent {
  validateTrackingArtifacts(trackingControls);
  const projected = projectPermittedFields(event, state.decisions, trackingFieldPolicy);
  if (!projected.identity.funnel_id) throw new TypeError('canonical_funnel_id_required');
  return projected;
}

export function sourceRuntimeReady(
  source: SourceSystem,
  runtimes: unknown[] = sourceRuntimeManifest.runtimes
): boolean {
  const runtime = runtimes.find(
    (item) => item && typeof item === 'object' && (item as { source?: unknown }).source === source
  ) as Record<string, unknown> | undefined;
  return Boolean(
    runtime &&
    runtime.status !== 'shadow' &&
    typeof runtime.source_sha === 'string' &&
    /^[a-f0-9]{40,64}$/i.test(runtime.source_sha) &&
    runtime.context_verifier === 'signed' &&
    runtime.outbox_reconciliation_owner &&
    runtime.dodo_ownership_readback === 'verified'
  );
}

async function verifyEventContext(
  env: CollectorEnv,
  event: CanonicalEvent,
  contextHash: string | null
): Promise<EventContext | null> {
  if (!contextHash) return null;
  const verifier = env.TRACKING_CONTEXT_VERIFY;
  const externallyVerified = typeof verifier === 'function';
  let context =
    typeof verifier === 'function'
      ? /^[a-f0-9]{64}$/i.test(contextHash)
        ? await verifier(contextHash)
        : null
      : await verifyTrackingContextToken(env, contextHash);
  if (!context && /^[a-f0-9]{64}$/i.test(contextHash)) {
    let row: {
      tenant_id: string;
      site_id: string;
      funnel_slug: string;
      server_subject_ref: string;
      privacy_snapshot_json: string;
      buyer_context_json: string;
      flow_binding: string;
      expires_at: string;
    } | null = null;
    try {
      row = await env.TRACKING_DB.prepare(
        `SELECT tenant_id, site_id, funnel_slug, flow_binding, server_subject_ref,
                privacy_snapshot_json, buyer_context_json, expires_at
         FROM tracking_context_exchanges WHERE context_hash = ? AND expires_at > ? LIMIT 1`
      )
        .bind(contextHash, new Date().toISOString())
        .first();
    } catch {
      row = null;
    }
    if (row) {
      try {
        const snapshot = validatePrivacySnapshot(JSON.parse(row.privacy_snapshot_json));
        context = snapshot
          ? {
              tenant_id: row.tenant_id,
              site_id: row.site_id,
              funnel_id: row.funnel_slug,
              subject_id: row.server_subject_ref,
              subject_deleted: false,
              policy_version: snapshot.policy_version,
              flow_binding: row.flow_binding,
              buyer_context: JSON.parse(row.buyer_context_json || '{}') as Record<string, unknown>,
            }
          : null;
      } catch {
        context = null;
      }
    }
  }
  if (!context) return null;
  const rolloutContext = rolloutState.context;
  const policyVersion = String(privacyPolicy.policy_version);
  if (
    context.subject_deleted ||
    context.tenant_id !== event.tenant_id ||
    context.site_id !== event.site_id ||
    event.identity.funnel_id !== context.funnel_id ||
    context.funnel_id !== rolloutContext.funnel ||
    context.funnel_id !== rolloutContext.bound_funnel ||
    !context.subject_id ||
    context.policy_version !== policyVersion ||
    event.privacy.policy_version !== policyVersion
  )
    return null;
  if (!externallyVerified && event.event_name === 'Purchase' && /^[a-f0-9]{64}$/i.test(contextHash)) {
    const consumed = await env.TRACKING_DB.prepare(
      `UPDATE tracking_context_exchanges
       SET consumed_at = ?, consumed_event_id = ?, consumed_flow_binding = flow_binding
       WHERE context_hash = ? AND expires_at > ?
         AND (consumed_at IS NULL OR consumed_event_id = ?)`
    )
      .bind(new Date().toISOString(), event.event_id, contextHash, new Date().toISOString(), event.event_id)
      .run();
    if (Number(consumed.meta?.changes ?? 0) !== 1) return null;
  }
  return context;
}
const PUBLIC_BROWSER_EVENTS = new Set<EventName>(['PageView']);

type Counter = { window: number; count: number };
const counters = new Map<string, Counter>();

function textEnv(env: Record<string, unknown>, key: string, fallback = ''): string {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4096) : fallback;
}

function allowedOrigins(env: Record<string, unknown>): string[] {
  return textEnv(env, 'TRACKING_ALLOWED_ORIGINS', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function allowedHost(env: Record<string, unknown>, request: Request): string {
  return textEnv(env, 'TRACKING_HOST', new URL(request.url).host);
}

function exactHost(request: Request, env: Record<string, unknown>): boolean {
  const configured = allowedHost(env, request);
  return (
    new URL(request.url).host === configured &&
    (!request.headers.get('host') || request.headers.get('host') === configured)
  );
}

function exactOrigin(request: Request, env: Record<string, unknown>): boolean {
  const origin = request.headers.get('origin');
  const origins = allowedOrigins(env);
  return !!origin && origins.length > 0 && origins.includes(origin);
}

function cors(request: Request, env: Record<string, unknown>): Headers {
  return corsHeaders(request.headers.get('origin'), allowedOrigins(env), {
    host: new URL(request.url).host,
    allowedHost: allowedHost(env, request),
    preflightMethod: request.headers.get('access-control-request-method'),
    requestedHeaders: request.headers.get('access-control-request-headers'),
  });
}

function boundedCounter(
  map: Map<string, Counter>,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const current = map.get(key);
  if (!current || now - current.window >= windowMs) {
    map.set(key, { window: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function budget(env: Record<string, unknown>, request: Request): boolean {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const cookie = request.headers.get('cookie')?.slice(0, 256) ?? 'anonymous';
  const tenant = textEnv(env, 'TRACKING_TENANT_ID', 'default');
  const ipLimit = Number(env.TRACKING_IP_RATE_LIMIT) || 60;
  const visitorLimit = Number(env.TRACKING_VISITOR_RATE_LIMIT) || 120;
  const tenantLimit = Number(env.TRACKING_TENANT_RATE_LIMIT) || 10_000;
  return (
    boundedCounter(counters, `ip:${ip}`, ipLimit, 60_000) &&
    boundedCounter(counters, `cookie:${cookie}`, visitorLimit, 60_000) &&
    boundedCounter(counters, `tenant:${tenant}`, tenantLimit, 3_600_000)
  );
}

function safeJson(value: unknown): boolean {
  const walk = (current: unknown, depth: number): boolean => {
    if (depth > BODY_MAX_DEPTH) return false;
    if (Array.isArray(current))
      return current.length <= BODY_MAX_ITEMS && current.every((item) => walk(item, depth + 1));
    if (!current || typeof current !== 'object') return true;
    const entries = Object.entries(current);
    return entries.length <= BODY_MAX_ITEMS && entries.every(([, item]) => walk(item, depth + 1));
  };
  return walk(value, 0);
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > EVENT_MAX_BYTES) throw new TypeError('body_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > EVENT_MAX_BYTES)
    throw new TypeError('body_too_large');
  if (!text) throw new TypeError('body_required');
  const body = JSON.parse(text) as unknown;
  if (!safeJson(body)) throw new TypeError('body_limits_exceeded');
  return body;
}

function cookieContext(env: Record<string, unknown>): CookieContext {
  const environment = textEnv(env, 'TRACKING_ENVIRONMENT', 'preview');
  if (environment !== 'preview' && environment !== 'live')
    throw new TypeError('invalid_environment');
  return {
    tenantId: textEnv(env, 'TRACKING_TENANT_ID', 'default'),
    siteId: textEnv(env, 'TRACKING_SITE_ID', 'default'),
    environment,
  };
}

function cookieKeys(env: Record<string, unknown>): Record<string, CryptoKey> {
  const keys: Record<string, CryptoKey> = {};
  for (const [name, idName] of [
    ['TRACKING_COOKIE_SIGNING_KEY_CURRENT', 'TRACKING_COOKIE_SIGNING_KEY_ID_CURRENT'],
    ['TRACKING_COOKIE_SIGNING_KEY_PREVIOUS', 'TRACKING_COOKIE_SIGNING_KEY_ID_PREVIOUS'],
  ] as const) {
    const key = env[name];
    const id = textEnv(env, idName, name.includes('CURRENT') ? 'current' : 'previous');
    if (key && typeof key === 'object' && 'type' in key) keys[id] = key as CryptoKey;
  }
  return keys;
}

function cookieDomain(env: Record<string, unknown>): string {
  return textEnv(env, 'TRACKING_COOKIE_DOMAIN', 'shop.maestrogtm.com');
}

async function signedCookie(
  env: Record<string, unknown>,
  name: TrackingCookieName,
  value: string,
  maxAge: number
): Promise<string> {
  const key = env.TRACKING_COOKIE_SIGNING_KEY_CURRENT;
  if (!key || typeof key !== 'object' || !('type' in key))
    throw new Error('cookie_signing_key_unavailable');
  const result = await issueSignedCookie(
    {
      ...cookieContext(env),
      name,
      value,
      keyId: textEnv(env, 'TRACKING_COOKIE_SIGNING_KEY_ID_CURRENT', 'current'),
      maxAge,
    },
    key as CryptoKey
  );
  return result.replace('Domain=shop.maestrogtm.com', `Domain=${cookieDomain(env)}`);
}

async function visitorId(request: Request, env: Record<string, unknown>): Promise<string | null> {
  const keys = cookieKeys(env);
  if (!Object.keys(keys).length) return null;
  return verifySignedCookie(request.headers.get('cookie'), 'ma_vid', keys, cookieContext(env));
}

async function privacySubjectId(
  request: Request,
  env: Record<string, unknown>
): Promise<string | null> {
  const keys = cookieKeys(env);
  if (!Object.keys(keys).length) return null;
  return verifySignedCookie(request.headers.get('cookie'), 'ma_privacy', keys, cookieContext(env));
}

function jsonError(
  code: string,
  status: number,
  request: Request,
  env: Record<string, unknown>
): Response {
  const headers = cors(request, env);
  return jsonResponse({ error: code }, status, headers);
}

async function recordScopeAudit(
  env: CollectorEnv,
  sourceSystem: string,
  sourceEventId: string,
  result: 'ignored_not_owner' | 'rejected_scope',
  reason: string
): Promise<void> {
  await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_scope_audits
       (audit_id, tenant_id, site_id, source_system, source_event_id, result, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      textEnv(env, 'TRACKING_TENANT_ID', 'default'),
      textEnv(env, 'TRACKING_SITE_ID', 'default'),
      sourceSystem,
      sourceEventId,
      result,
      reason.slice(0, 256),
      new Date().toISOString()
    )
    .run();
}

async function bootstrap(request: Request, env: CollectorEnv): Promise<Response> {
  if (!exactHost(request, env) || !exactOrigin(request, env))
    return jsonError('not_allowed', 403, request, env);
  const visitor = await visitorId(request, env);
  const privacySubject = await privacySubjectId(request, env);
  const state = await loadPrivacyState(
    request,
    env,
    visitor ?? undefined,
    privacySubject ?? undefined
  );
  const nonce = createCsrfNonce();
  const nextPrivacySubject = privacySubject ?? `privacy_${crypto.randomUUID()}`;
  await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_csrf_nonces
       (nonce, tenant_id, site_id, visitor_id, privacy_subject_id, policy_version, region_source,
        expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      nonce,
      textEnv(env, 'TRACKING_TENANT_ID', 'default'),
      textEnv(env, 'TRACKING_SITE_ID', 'default'),
      visitor,
      nextPrivacySubject,
      state.policyVersion,
      state.region,
      new Date(Date.now() + 600_000).toISOString(),
      new Date().toISOString()
    )
    .run();
  const trackingAllowed = state.decisions.some(
    (decision) =>
      (decision.purpose === 'analytics' || decision.purpose === 'advertising') && decision.allowed
  );
  const context =
    state.resolved && trackingAllowed
      ? await env.TRACKING_DB.prepare(
          `SELECT context_hash FROM tracking_csrf_nonces
         WHERE tenant_id = ? AND site_id = ? AND privacy_subject_id = ?
           AND policy_version = ? AND consumed_at IS NOT NULL AND context_hash IS NOT NULL
         ORDER BY consumed_at DESC LIMIT 1`
        )
          .bind(
            textEnv(env, 'TRACKING_TENANT_ID', 'default'),
            textEnv(env, 'TRACKING_SITE_ID', 'default'),
            nextPrivacySubject,
            state.policyVersion
          )
          .first<{ context_hash: string }>()
      : null;
  const contextToken =
    state.resolved
      ? await signTrackingContext(env, {
          tenant_id: textEnv(env, 'TRACKING_TENANT_ID', 'default'),
          site_id: textEnv(env, 'TRACKING_SITE_ID', 'default'),
          funnel_id: rolloutState.context.bound_funnel,
          subject_id: nextPrivacySubject,
          subject_deleted: false,
          policy_version: state.policyVersion,
        })
      : null;
  const response = jsonResponse(
    {
      schema_version: '1',
      policy_version: state.policyVersion,
      resolved: state.resolved,
      ...(state.resolved
        ? {
            privacy: state.decisions,
            visitor_ready: Boolean(visitor || trackingAllowed),
            purposes: state.decisions
              .filter((decision) => decision.allowed)
              .map((decision) => decision.purpose),
            ...(context?.context_hash ? { tracking_context_hash: context.context_hash } : {}),
            ...(contextToken ? { tracking_context_token: contextToken } : {}),
          }
        : {}),
    },
    200,
    cors(request, env)
  );
  response.headers.set('x-csrf-nonce', nonce);
  if (!privacySubject) {
    response.headers.append(
      'Set-Cookie',
      await signedCookie(env, 'ma_privacy', nextPrivacySubject, 34_560_000)
    );
  }
  if (!visitor && trackingAllowed) {
    response.headers.append(
      'Set-Cookie',
      await signedCookie(env, 'ma_vid', `visitor_${crypto.randomUUID()}`, 34_560_000)
    );
    response.headers.append(
      'Set-Cookie',
      await signedCookie(env, 'ma_sid', `session_${crypto.randomUUID()}`, 1_800)
    );
  }
  return response;
}

async function browserEvents(
  request: Request,
  env: CollectorEnv,
  ctx: ExecutionContextLike
): Promise<Response> {
  const body = await readBody(request);
  const candidate = validateCanonicalEvent(body);
  if (
    candidate.tenant_id !== textEnv(env, 'TRACKING_TENANT_ID', 'default') ||
    candidate.site_id !== textEnv(env, 'TRACKING_SITE_ID', 'default')
  ) {
    await recordScopeAudit(
      env,
      candidate.source_system,
      candidate.event_id,
      'ignored_not_owner',
      'event_scope_mismatch'
    );
    return jsonError('event_scope_mismatch', 403, request, env);
  }
  if (!PUBLIC_BROWSER_EVENTS.has(candidate.event_name) || candidate.source !== 'browser')
    return jsonError('authoritative_event_requires_source_bridge', 403, request, env);
  if (candidate.source_system !== 'event_worker')
    return jsonError('invalid_browser_source', 403, request, env);
  const eventContext = await verifyEventContext(
    env,
    candidate,
    request.headers.get('x-tracking-context-hash')
  );
  if (!eventContext) return jsonError('invalid_context', 403, request, env);
  const visitor = await visitorId(request, env);
  const privacySubject = await privacySubjectId(request, env);
  const state = await loadPrivacyState(
    request,
    env,
    visitor ?? privacySubject ?? undefined,
    privacySubject ?? undefined
  );
  if (state.gpc) {
    const observation = recordGpcObservation(env, visitor ?? privacySubject ?? undefined);
    if (ctx.waitUntil) ctx.waitUntil(observation);
    else await observation;
  }
  if (state.gpc && !allows(state, 'advertising')) {
    await persistCanonicalEvent(
      env,
      projectedEvent(candidate, state),
      state,
      eventContext.subject_id,
      new Date(),
      { buyerContext: eventContext.buyer_context }
    );
    return jsonResponse({ accepted: true, suppressed: true }, 202, cors(request, env));
  }
  await persistCanonicalEvent(
    env,
    projectedEvent(candidate, state),
    state,
    eventContext.subject_id,
    new Date(),
    { buyerContext: eventContext.buyer_context }
  );
  return jsonResponse({ accepted: true, suppressed: false }, 202, cors(request, env));
}

export function sourceEnvelopeToCanonical(
  value: unknown,
  source: SourceSystem,
  env: CollectorEnv
): CanonicalEvent {
  const envelope = parseSourceEventEnvelope(value, source);
  const identity: Record<string, string> = {
    funnel_id: envelope.funnel_slug,
    ...(envelope.lead_id ? { lead_id: envelope.lead_id } : {}),
    ...(envelope.checkout_session_id ? { checkout_id: envelope.checkout_session_id } : {}),
    ...(envelope.payment_id ? { payment_id: envelope.payment_id } : {}),
  };
  const commerce = envelope.product_id
    ? {
        product_id: envelope.product_id,
        content_ids: [envelope.product_id],
        content_type: 'product',
        ...(envelope.payment_id ? { payment_id: envelope.payment_id } : {}),
        ...(envelope.value !== undefined ? { value: envelope.value } : {}),
        ...(envelope.currency ? { currency: envelope.currency } : {}),
        ...(envelope.num_items !== undefined ? { num_items: envelope.num_items } : {}),
      }
    : envelope.payment_id ? { payment_id: envelope.payment_id, ...(envelope.value !== undefined ? { value: envelope.value } : {}), ...(envelope.currency ? { currency: envelope.currency } : {}) } : {};
  const snapshot = envelope.privacy_snapshot;
  return validateCanonicalEvent({
    schema_version: '1',
    tenant_id: textEnv(env, 'TRACKING_TENANT_ID', 'default'),
    site_id: textEnv(env, 'TRACKING_SITE_ID', 'default'),
    event_id: envelope.source_event_id,
    event_name: envelope.event_name,
    source: 'server',
    source_system: source,
    context_hash: envelope.context_hash,
    occurred_at: envelope.occurred_at,
    visitor: {},
    session: {},
    page: {},
    attribution: {},
    identity,
    commerce,
    privacy: {
      policy_version: snapshot.policy_version,
      region: snapshot.region,
      gpc: snapshot.gpc,
      opted_out: snapshot.purposes.advertising === 'denied',
    },
  });
}

async function sourceEvents(request: Request, env: CollectorEnv): Promise<Response> {
  if (!exactHost(request, env)) return jsonError('not_allowed', 403, request, env);
  const source = request.headers.get('x-maestro-issuer') as SourceSystem | null;
  if (!source && request.headers.get('x-tracking-source'))
    return jsonError('source_runtime_not_ready', 403, request, env);
  if (!source || !SOURCE_SYSTEMS.has(source)) return jsonError('invalid_source', 401, request, env);
  if (!sourceRuntimeReady(source)) return jsonError('source_runtime_not_ready', 403, request, env);
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > EVENT_MAX_BYTES)
    return jsonError('body_too_large', 413, request, env);
  if (!(await verifySignedBridge(request, bodyText, env, source, 'source-events')))
    return jsonError('invalid_signature', 401, request, env);
  const nonce = request.headers.get('x-maestro-nonce') ?? '';
  const nonceResult = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(source_system, nonce) DO NOTHING`
  )
    .bind(nonce, source, new Date(Date.now() + 300_000).toISOString(), new Date().toISOString())
    .run();
  if ((nonceResult.meta?.changes ?? 0) !== 1)
    return jsonError('replayed_request', 409, request, env);
  const body = JSON.parse(bodyText) as unknown;
  if (!safeJson(body)) return jsonError('body_limits_exceeded', 400, request, env);
  const envelope = parseSourceEventEnvelope(body, source);
  const event = sourceEnvelopeToCanonical(envelope, source, env);
  if (
    event.tenant_id !== textEnv(env, 'TRACKING_TENANT_ID', 'default') ||
    event.site_id !== textEnv(env, 'TRACKING_SITE_ID', 'default')
  ) {
    await recordScopeAudit(
      env,
      source,
      event.event_id,
      'ignored_not_owner',
      'event_scope_mismatch'
    );
    return jsonError('event_scope_mismatch', 403, request, env);
  }
  const eventContext = await verifyEventContext(env, event, envelope.context_hash);
  if (!eventContext) return jsonError('invalid_context', 403, request, env);
  const state = await loadPrivacyState(
    request,
    env,
    eventContext.subject_id,
    eventContext.subject_id
  );
  const result = await persistCanonicalEvent(
    env,
    projectedEvent(event, state),
    state,
    eventContext.subject_id,
    new Date(),
    { buyerContext: eventContext.buyer_context }
  );
  return jsonResponse(
    { accepted: true, event_key: result.eventKey, suppressed: result.suppressed },
    202,
    new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' })
  );
}

type ContextExchange = {
  tenant_id: string;
  site_id: string;
  funnel_slug: string;
  flow_binding: string;
  server_subject_ref: string;
  privacy_snapshot: PrivacySnapshot;
  buyer_context?: Record<string, unknown>;
};

async function contextExchange(request: Request, env: CollectorEnv): Promise<Response> {
  if (!exactHost(request, env)) return jsonError('not_allowed', 403, request, env);
  const source = request.headers.get('x-maestro-issuer') as SourceSystem | null;
  if (!source || !SOURCE_SYSTEMS.has(source)) return jsonError('invalid_source', 401, request, env);
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > 16 * 1024)
    return jsonError('body_too_large', 413, request, env);
  if (!(await verifySignedBridge(request, bodyText, env, source, 'context-exchange')))
    return jsonError('invalid_signature', 401, request, env);
  const nonce = request.headers.get('x-maestro-nonce') ?? '';
  const nonceResult = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(source_system, nonce) DO NOTHING`
  )
    .bind(nonce, `${source}:context-exchange`, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString())
    .run();
  if ((nonceResult.meta?.changes ?? 0) !== 1) return jsonError('replayed_request', 409, request, env);
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch {
    return jsonError('invalid_request', 400, request, env);
  }
  const token = input.tracking_context_token;
  if (typeof token !== 'string' || !/^v1\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,512}\.[A-Za-z0-9_-]{43}$/.test(token))
    return jsonError('invalid_context', 403, request, env);
  if (new URL(request.url).search) return jsonError('invalid_context', 403, request, env);
  const verifier = env.TRACKING_CONTEXT_TOKEN_VERIFY;
  let verified: unknown;
  try {
    verified = typeof verifier === 'function'
      ? await (verifier as (value: string, audience: string) => Promise<unknown>)(token, 'source-outbox')
      : await verifyTrackingContextToken(env, token);
  } catch {
    return jsonError('invalid_context', 403, request, env);
  }
  if (!verified || typeof verified !== 'object' || Array.isArray(verified))
    return jsonError('invalid_context', 403, request, env);
  const context = verified as Record<string, unknown>;
  const requestedFlowBinding = typeof input.flow_binding === 'string' && /^[a-f0-9]{64}$/i.test(input.flow_binding)
    ? input.flow_binding
    : '';
  const tenantId = textEnv(env, 'TRACKING_TENANT_ID', 'default');
  const siteId = textEnv(env, 'TRACKING_SITE_ID', 'default');
  const exchange: ContextExchange = {
    tenant_id: tenantId,
    site_id: siteId,
    funnel_slug: typeof context.funnel_slug === 'string' ? context.funnel_slug : String(context.funnel_id ?? ''),
    flow_binding: requestedFlowBinding || (typeof context.flow_binding === 'string' ? context.flow_binding : String(context.funnel_id ?? '')),
    server_subject_ref: typeof context.server_subject_ref === 'string' ? context.server_subject_ref : String(context.subject_id ?? ''),
    privacy_snapshot: (context.privacy_snapshot ?? {
      schema_version: '1', server_subject_ref: String(context.subject_id ?? context.server_subject_ref ?? ''),
      subject_ref_version: 'v1', snapshot_issued_at: new Date().toISOString(),
      snapshot_expires_at: new Date(Date.now() + 600_000).toISOString(), snapshot_key_id: 'worker-current',
      snapshot_signature: base64url(crypto.getRandomValues(new Uint8Array(32))),
      purposes: { necessary: 'granted', analytics: 'unknown', advertising: 'unknown', identity_enrichment: 'unknown', sale_share: 'unknown' },
      policy_version: String(context.policy_version ?? privacyPolicy.policy_version), choice_id: 'context-token', decision_source: 'policy',
      notice_locale: 'en-US', region: 'unknown', region_source: 'unknown', gpc: false, observed_at: new Date().toISOString(),
    }) as PrivacySnapshot,
    ...(context.buyer_context && typeof context.buyer_context === 'object' && !Array.isArray(context.buyer_context)
      ? { buyer_context: context.buyer_context as Record<string, unknown> }
      : {}),
  };
  if (
    !/^[A-Za-z0-9:_-]{1,180}$/.test(exchange.funnel_slug) ||
    !exchange.flow_binding ||
    !exchange.server_subject_ref ||
    !validatePrivacySnapshot(exchange.privacy_snapshot)
  )
    return jsonError('invalid_context', 403, request, env);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  const digest = await crypto.subtle.digest('SHA-256', crypto.getRandomValues(new Uint8Array(32)));
  const contextHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  try {
    await env.TRACKING_DB.prepare(
      `INSERT INTO tracking_context_exchanges
       (context_hash, tenant_id, site_id, funnel_slug, flow_binding, server_subject_ref,
        privacy_snapshot_json, buyer_context_json, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        contextHash,
        exchange.tenant_id,
        exchange.site_id,
        exchange.funnel_slug,
        exchange.flow_binding,
        exchange.server_subject_ref,
        JSON.stringify(exchange.privacy_snapshot),
        JSON.stringify(exchange.buyer_context ?? {}),
        now,
        expiresAt
      )
      .run();
  } catch {
    return jsonError('tracking_unavailable', 503, request, env);
  }
  return jsonResponse(
    {
      context_hash: contextHash,
      context_expires_at: expiresAt,
      privacy_snapshot: exchange.privacy_snapshot,
    },
    201
  );
}

async function privacyMutation(request: Request, env: CollectorEnv): Promise<Response> {
  const origin = allowedOrigins(env)[0];
  if (!origin || !sameOriginNoCors(request, origin, allowedHost(env, request)))
    return jsonError('not_allowed', 403, request, env);
  const nonce = request.headers.get('x-csrf-nonce');
  if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce))
    return jsonError('csrf_required', 403, request, env);
  const body = privacyBody(await readBody(request));
  if (request.headers.get('sec-gpc') === '1' && body.purposes.advertising)
    return jsonError('gpc_blocks_grant', 409, request, env);
  const visitor = await visitorId(request, env);
  const privacySubject = await privacySubjectId(request, env);
  if (!visitor && !privacySubject) return jsonError('verification_required', 403, request, env);
  const policyVersion = String(privacyPolicy.policy_version);
  if (body.policyVersion !== policyVersion) return jsonError('stale_policy', 409, request, env);
  const trackingAllowed = body.purposes.analytics || body.purposes.advertising;
  const contextHash = trackingAllowed
    ? await signTrackingContext(env, {
        tenant_id: textEnv(env, 'TRACKING_TENANT_ID', 'default'),
        site_id: textEnv(env, 'TRACKING_SITE_ID', 'default'),
        funnel_id: rolloutState.context.bound_funnel,
        subject_id: visitor ?? privacySubject!,
        subject_deleted: false,
        policy_version: policyVersion,
      })
    : null;
  if (trackingAllowed && !contextHash)
    return jsonError('context_signer_unavailable', 503, request, env);
  if (
    contextHash &&
    !/^(?:[A-Za-z0-9_-]{16,256}|v1\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,512}\.[A-Za-z0-9_-]{43})$/.test(
      contextHash
    )
  )
    return jsonError('invalid_signed_context', 503, request, env);
  const now = new Date().toISOString();
  const consumed = await env.TRACKING_DB.prepare(
    `UPDATE tracking_csrf_nonces
       SET consumed_at = ?, choice_id = ?, context_hash = ?, action = ?,
           analytics_allowed = ?, advertising_allowed = ?
       WHERE nonce = ? AND tenant_id = ? AND site_id = ?
         AND (visitor_id = ? OR privacy_subject_id = ?)
         AND policy_version = ? AND consumed_at IS NULL AND expires_at > ?`
  )
    .bind(
      now,
      body.choiceId,
      contextHash,
      body.action,
      body.purposes.analytics ? 1 : 0,
      body.purposes.advertising ? 1 : 0,
      nonce,
      textEnv(env, 'TRACKING_TENANT_ID', 'default'),
      textEnv(env, 'TRACKING_SITE_ID', 'default'),
      visitor,
      privacySubject,
      policyVersion,
      now
    )
    .run();
  if (!consumed.success || Number(consumed.meta?.changes ?? 0) !== 1)
    return jsonError('nonce_consumed', 409, request, env);
  if (!body.purposes.analytics && !body.purposes.advertising) {
    await suppressPendingForSubject(
      env,
      privacySubject ?? visitor!,
      body.choiceId,
      'privacy_withdrawal'
    );
  }
  const state = await loadPrivacyState(
    request,
    env,
    visitor ?? undefined,
    privacySubject ?? undefined
  );
  return jsonResponse(
    {
      accepted: true,
      choice_id: body.choiceId,
      resolved: state.resolved,
      policy_version: state.policyVersion,
      purposes: state.decisions
        .filter((decision) => decision.allowed)
        .map((decision) => decision.purpose),
    },
    202,
    cors(request, env)
  );
}

async function privacyRequest(request: Request, env: CollectorEnv): Promise<Response> {
  if (!exactHost(request, env) || !exactOrigin(request, env))
    return jsonError('not_allowed', 403, request, env);
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return jsonError('invalid_request', 400, request, env);
  const input = body as Record<string, unknown>;
  const requestType = input.request_type;
  const subject = input.subject_key;
  if (
    !['access', 'correction', 'deletion'].includes(String(requestType)) ||
    typeof subject !== 'string' ||
    (subject !== 'self' && !/^[A-Za-z0-9:_-]{1,128}$/.test(subject))
  )
    return jsonError('invalid_request', 400, request, env);
  const verifiedVisitor = await visitorId(request, env);
  if (!verifiedVisitor || (subject !== 'self' && verifiedVisitor !== subject))
    return jsonError('verification_required', 403, request, env);
  const subjectKey = verifiedVisitor;
  const requestId = await createPrivacyRequest(env, {
    action: requestType as 'access' | 'correction' | 'deletion',
    subjectId: subjectKey,
    verified: true,
  });
  return jsonResponse(
    {
      request_id: requestId,
      state: requestType === 'deletion' ? 'tombstone_committed' : 'pending',
    },
    202,
    cors(request, env)
  );
}

async function browserClaims(request: Request, env: CollectorEnv): Promise<Response> {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405, request, env);
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > EVENT_MAX_BYTES)
    return jsonError('body_too_large', 413, request, env);
  if (!(await verifySignedBridge(request, bodyText, env, 'pages', 'browser-claims')))
    return jsonError('not_authorized', 401, request, env);
  const nonce = request.headers.get('x-maestro-nonce') ?? '';
  const nonceResult = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(source_system, nonce) DO NOTHING`
  )
    .bind(nonce, 'pages:browser-claims', new Date(Date.now() + 600_000).toISOString(), new Date().toISOString())
    .run();
  if ((nonceResult.meta?.changes ?? 0) !== 1) return jsonError('replayed_request', 409, request, env);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError('invalid_request', 400, request, env);
  }
  const funnelSlug = body.funnel_slug;
  const flowBinding = body.flow_binding;
  let flowContextHashes: string[] = [];
  const paymentIds = Array.isArray(body.payment_ids)
    ? body.payment_ids
        .filter(
          (value): value is string =>
            typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value)
        )
        .slice(0, 50)
    : [];
  if (typeof funnelSlug !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(funnelSlug) ||
      typeof flowBinding !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(flowBinding))
    return jsonError('invalid_request', 400, request, env);
  try {
    const validFlow = typeof env.TRACKING_FLOW_BINDING_VERIFY === 'function'
      ? await env.TRACKING_FLOW_BINDING_VERIFY(flowBinding, funnelSlug, paymentIds)
      : (() => {
          return env.TRACKING_DB.prepare(
            `SELECT context_hash FROM tracking_context_exchanges
             WHERE tenant_id = ? AND site_id = ? AND funnel_slug = ? AND flow_binding = ?
               AND expires_at > ? LIMIT 1`
          )
            .bind(
              textEnv(env, 'TRACKING_TENANT_ID', 'default'),
              textEnv(env, 'TRACKING_SITE_ID', 'default'),
              funnelSlug,
              flowBinding,
              new Date().toISOString()
            )
            .all<{ context_hash: string }>()
            .then((result) => {
              flowContextHashes = (result.results ?? []).map((row) => row.context_hash).filter(Boolean);
              return flowContextHashes.length > 0;
            });
        })();
    if (!validFlow)
      return jsonError('invalid_flow', 403, request, env);
  } catch {
    return jsonError('tracking_unavailable', 503, request, env);
  }
  if (!paymentIds.length) return jsonResponse({ claims: [] }, 200);
  const placeholders = paymentIds.map(() => '?').join(', ');
  const contextClause = flowContextHashes.length
    ? ` AND json_extract(envelope_json, '$.context_hash') IN (${flowContextHashes.map(() => '?').join(', ')})`
    : '';
  const events = await env.TRACKING_DB.prepare(
    `SELECT event_key, event_id, envelope_json
       FROM tracking_events
      WHERE tenant_id = ? AND site_id = ? AND source_system = 'pages'
        AND event_name = 'Purchase' AND json_extract(envelope_json, '$.commerce.payment_id') IN (${placeholders})
        AND json_extract(envelope_json, '$.identity.funnel_id') = ?${contextClause}`
  )
    .bind(textEnv(env, 'TRACKING_TENANT_ID', 'default'), textEnv(env, 'TRACKING_SITE_ID', 'default'), ...paymentIds, funnelSlug, ...flowContextHashes)
    .all<{ event_key: string; event_id: string; envelope_json: string }>();
  const claims: Array<Record<string, unknown>> = [];
  for (const row of events.results ?? []) {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(row.envelope_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const commerce = envelope.commerce;
    if (!commerce || typeof commerce !== 'object' || Array.isArray(commerce)) continue;
    const paymentId = (commerce as Record<string, unknown>).payment_id;
    if (typeof paymentId !== 'string') continue;
    const claimed = await env.TRACKING_DB.prepare(
      `INSERT OR IGNORE INTO tracking_purchase_browser_claims
       (tenant_id, site_id, payment_id, funnel_token_hash, claimed_at) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(textEnv(env, 'TRACKING_TENANT_ID', 'default'), textEnv(env, 'TRACKING_SITE_ID', 'default'), paymentId, flowBinding, new Date().toISOString())
      .run();
    if ((claimed.meta?.changes ?? 0) !== 1) continue;
    const customData: Record<string, unknown> = {};
    for (const key of ['content_ids', 'content_type', 'contents', 'currency', 'num_items', 'value']) {
      if ((commerce as Record<string, unknown>)[key] !== undefined) customData[key] = (commerce as Record<string, unknown>)[key];
    }
    claims.push({ event_name: 'Purchase', event_id: row.event_id, custom_data: customData });
  }
  return jsonResponse({ claims }, 200);
}

function operatorMetadata(input: Record<string, unknown>): {
  actor: string;
  reason: string;
  requestId: string;
  idempotencyKey: string;
  secondApprover: string | null;
} | null {
  const actor = input.actor;
  const reason = input.reason;
  const requestId = input.request_id;
  const idempotencyKey = input.idempotency_key;
  const secondApprover = input.second_approver;
  if (
    typeof actor !== 'string' ||
    !/^[A-Za-z0-9@._:-]{3,128}$/.test(actor) ||
    typeof reason !== 'string' ||
    reason.trim().length < 8 ||
    reason.length > 256 ||
    typeof requestId !== 'string' ||
    !/^[A-Za-z0-9:_-]{8,128}$/.test(requestId) ||
    typeof idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey) ||
    (secondApprover !== undefined &&
      (typeof secondApprover !== 'string' ||
        !/^[A-Za-z0-9@._:-]{3,128}$/.test(secondApprover) ||
        secondApprover === actor))
  )
    return null;
  return {
    actor,
    reason: reason.trim(),
    requestId,
    idempotencyKey,
    secondApprover: typeof secondApprover === 'string' ? secondApprover : null,
  };
}

async function operatorRoute(request: Request, env: CollectorEnv): Promise<Response> {
  const configured = textEnv(env, 'TRACKING_OPERATOR_TOKEN');
  if (!configured || request.headers.get('authorization') !== `Bearer ${configured}`)
    return jsonError('not_authorized', 401, request, env);
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return jsonError('invalid_request', 400, request, env);
  const input = body as Record<string, unknown>;
  const metadata = operatorMetadata(input);
  if (!metadata) return jsonError('invalid_operator_audit', 400, request, env);
  const path = new URL(request.url).pathname;
  if (path === '/internal/operator/kill-switch') {
    if (typeof input.enabled !== 'boolean') return jsonError('invalid_request', 400, request, env);
    const tenantId = textEnv(env, 'TRACKING_TENANT_ID', 'default');
    const siteId = textEnv(env, 'TRACKING_SITE_ID', 'default');
    const now = new Date().toISOString();
    const funnelId =
      typeof input.funnel_id === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(input.funnel_id)
        ? input.funnel_id
        : null;
    const destination =
      input.destination === 'meta' || input.destination === 'tinybird' ? input.destination : null;
    const controlKey =
      funnelId || destination ? `scope:${funnelId ?? '*'}:${destination ?? '*'}` : 'global';
    const auditAbsent = `NOT EXISTS (
      SELECT 1 FROM tracking_operator_audits
      WHERE tenant_id = ? AND site_id = ? AND idempotency_key = ?)`;
    const statements = [
      env.TRACKING_DB.prepare(
        `INSERT INTO tracking_runtime_controls
         (control_key, tenant_id, site_id, paused, actor, reason, request_id,
          second_approver, updated_at, funnel_id, destination)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${auditAbsent}
         ON CONFLICT(control_key) DO UPDATE SET paused = excluded.paused,
           actor = excluded.actor, reason = excluded.reason, request_id = excluded.request_id,
           second_approver = excluded.second_approver, updated_at = excluded.updated_at`
      ).bind(
        controlKey,
        tenantId,
        siteId,
        input.enabled ? 1 : 0,
        metadata.actor,
        metadata.reason,
        metadata.requestId,
        metadata.secondApprover,
        now,
        funnelId,
        destination,
        tenantId,
        siteId,
        metadata.idempotencyKey
      ),
    ];
    if (!input.enabled) {
      statements.push(
        env.TRACKING_DB.prepare(
          `UPDATE tracking_deliveries SET state = 'retryable', outcome = NULL,
           last_error = NULL, updated_at = ?
           WHERE tenant_id = ? AND site_id = ? AND state = 'paused'
             AND (? IS NULL OR destination = ?)
             AND (? IS NULL OR event_key IN (
               SELECT event_key FROM tracking_events
               WHERE json_extract(envelope_json, '$.identity.funnel_id') = ?))
             AND ${auditAbsent}`
        ).bind(
          now,
          tenantId,
          siteId,
          destination,
          destination,
          funnelId,
          funnelId,
          tenantId,
          siteId,
          metadata.idempotencyKey
        ),
        env.TRACKING_DB.prepare(
          `UPDATE tracking_outbox SET state = 'retryable', next_attempt_at = ?,
           last_error = NULL, updated_at = ?
           WHERE state = 'paused' AND event_key IN (
             SELECT event_key FROM tracking_deliveries
             WHERE tenant_id = ? AND site_id = ? AND state = 'retryable'
               AND (? IS NULL OR destination = ?))
             AND ${auditAbsent}`
        ).bind(
          now,
          now,
          tenantId,
          siteId,
          destination,
          destination,
          tenantId,
          siteId,
          metadata.idempotencyKey
        )
      );
    }
    statements.push(
      env.TRACKING_DB.prepare(
        `INSERT INTO tracking_operator_audits
         (audit_id, tenant_id, site_id, operation, actor, reason, request_id,
          idempotency_key, second_approver, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, site_id, idempotency_key) DO NOTHING`
      ).bind(
        crypto.randomUUID(),
        tenantId,
        siteId,
        input.enabled ? 'kill_switch_pause' : 'kill_switch_resume',
        metadata.actor,
        metadata.reason,
        metadata.requestId,
        metadata.idempotencyKey,
        metadata.secondApprover,
        now
      )
    );
    const results = await env.TRACKING_DB.batch(statements);
    if (results.some((result) => !result.success))
      return jsonError('operator_write_failed', 503, request, env);
    return jsonResponse({ accepted: true, enabled: input.enabled });
  }
  if (path === '/internal/operator/replay') {
    const eventKey =
      typeof input.event_key === 'string' && /^[a-f0-9]{64}$/.test(input.event_key)
        ? input.event_key
        : '';
    const destination =
      input.destination === 'meta' || input.destination === 'tinybird' ? input.destination : '';
    if (!eventKey || !destination) return jsonError('invalid_request', 400, request, env);
    if (!env.EVENTS_QUEUE) return jsonError('tracking_unavailable', 503, request, env);
    const tenantId = textEnv(env, 'TRACKING_TENANT_ID', 'default');
    const siteId = textEnv(env, 'TRACKING_SITE_ID', 'default');
    const delivery = await env.TRACKING_DB.prepare(
      `SELECT d.state, e.event_name, e.occurred_at, e.privacy_subject_id,
              json_extract(e.envelope_json, '$.identity.funnel_id') AS funnel_id
       FROM tracking_deliveries d JOIN tracking_events e ON e.event_key = d.event_key
       WHERE d.event_key = ? AND d.destination = ? AND d.tenant_id = ? AND d.site_id = ?`
    )
      .bind(eventKey, destination, tenantId, siteId)
      .first<{
        state: string;
        event_name: string;
        occurred_at: string;
        privacy_subject_id: string | null;
        funnel_id: string | null;
      }>();
    if (!delivery) return jsonError('delivery_not_found', 404, request, env);
    if (delivery.state !== 'outcome_unknown' && delivery.state !== 'replay_pending')
      return jsonError('delivery_not_replayable', 409, request, env);
    if (delivery.event_name === 'Purchase' && !metadata.secondApprover)
      return jsonError('second_approver_required', 409, request, env);
    if (delivery.privacy_subject_id) {
      const tombstone = await env.TRACKING_DB.prepare(
        `SELECT 1 AS found FROM tracking_suppression_tombstones
         WHERE tenant_id = ? AND site_id = ? AND visitor_id = ? LIMIT 1`
      )
        .bind(tenantId, siteId, delivery.privacy_subject_id)
        .first();
      if (tombstone) return jsonError('privacy_tombstone', 409, request, env);
    }
    const retentionDays = Math.max(1, Number(env.TRACKING_RETENTION_DAYS) || 395);
    if (Date.parse(delivery.occurred_at) < Date.now() - retentionDays * 86_400_000)
      return jsonError('event_expired', 410, request, env);
    const paused = await env.TRACKING_DB.prepare(
      `SELECT 1 AS found FROM tracking_runtime_controls
       WHERE tenant_id = ? AND site_id = ? AND paused = 1
         AND (destination IS NULL OR destination = ?)
         AND (funnel_id IS NULL OR funnel_id = ?) LIMIT 1`
    )
      .bind(tenantId, siteId, destination, delivery.funnel_id)
      .first();
    if (paused) return jsonError('delivery_paused', 409, request, env);
    const now = new Date().toISOString();
    const auditAbsent = `NOT EXISTS (
      SELECT 1 FROM tracking_operator_audits
      WHERE tenant_id = ? AND site_id = ? AND idempotency_key = ?)`;
    const results = await env.TRACKING_DB.batch([
      env.TRACKING_DB.prepare(
        `UPDATE tracking_deliveries
         SET state = 'replay_pending', outcome = 'audited_replay', last_error = NULL,
             lease_owner = NULL, lease_deadline = NULL, lease_until = NULL, updated_at = ?
         WHERE event_key = ? AND destination = ? AND state = 'outcome_unknown'
           AND ${auditAbsent}`
      ).bind(now, eventKey, destination, tenantId, siteId, metadata.idempotencyKey),
      env.TRACKING_DB.prepare(
        `UPDATE tracking_outbox SET state = 'retryable', next_attempt_at = ?,
           last_error = NULL, updated_at = ? WHERE event_key = ? AND ${auditAbsent}`
      ).bind(now, now, eventKey, tenantId, siteId, metadata.idempotencyKey),
      env.TRACKING_DB.prepare(
        `INSERT INTO tracking_operator_audits
         (audit_id, tenant_id, site_id, operation, actor, reason, request_id,
          idempotency_key, second_approver, event_key, destination, created_at)
         VALUES (?, ?, ?, 'replay_claim', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, site_id, idempotency_key) DO NOTHING`
      ).bind(
        crypto.randomUUID(),
        tenantId,
        siteId,
        metadata.actor,
        metadata.reason,
        metadata.requestId,
        metadata.idempotencyKey,
        metadata.secondApprover,
        eventKey,
        destination,
        now
      ),
    ]);
    if (results.some((result) => !result.success))
      return jsonError('operator_write_failed', 503, request, env);
    const claimed = Number(results[0]?.meta?.changes ?? 0) === 1;
    if (claimed) {
      try {
        await env.EVENTS_QUEUE.send({ event_key: eventKey, destination, schema_version: '1' });
      } catch (error) {
        console.warn(redactError(error));
        const recovery = await env.TRACKING_DB.batch([
          env.TRACKING_DB.prepare(
            `UPDATE tracking_deliveries
             SET state = 'retryable', last_error = 'replay_enqueue_failed', updated_at = ?
             WHERE event_key = ? AND destination = ? AND state = 'replay_pending'`
          ).bind(now, eventKey, destination),
          env.TRACKING_DB.prepare(
            `UPDATE tracking_outbox
             SET state = 'retryable', next_attempt_at = ?, last_error = 'replay_enqueue_failed',
                 updated_at = ? WHERE event_key = ?`
          ).bind(now, now, eventKey),
        ]);
        if (recovery.some((result) => !result.success))
          return jsonError('operator_write_failed', 503, request, env);
        return jsonError('replay_enqueue_failed', 503, request, env);
      }
    }
    return jsonResponse({ accepted: true, claimed, event_key: eventKey, destination });
  }
  return jsonError('not_found', 404, request, env);
}

export async function handleCollectorFetch(
  request: Request,
  env: CollectorEnv,
  ctx: ExecutionContextLike
): Promise<Response> {
  if (!budget(env, request)) return jsonError('rate_limited', 429, request, env);
  const path = new URL(request.url).pathname;
  if (path === '/healthz' && request.method === 'GET')
    return exactHost(request, env) ? healthResponse() : jsonError('not_allowed', 403, request, env);
  if (!exactHost(request, env)) return jsonError('not_allowed', 403, request, env);
  if (request.method === 'OPTIONS') {
    return exactOrigin(request, env)
      ? new Response(null, { status: 204, headers: cors(request, env) })
      : jsonError('not_allowed', 403, request, env);
  }
  try {
    if (path === '/v1/bootstrap' && request.method === 'GET') return await bootstrap(request, env);
    if (path === '/v1/events' && request.method === 'POST')
      return await browserEvents(request, env, ctx);
    if (path === '/v1/privacy' && request.method === 'POST')
      return await privacyMutation(request, env);
    if (path === '/v1/privacy/requests' && request.method === 'POST')
      return await privacyRequest(request, env);
    if (path === '/v1/source-events' && request.method === 'POST')
      return await sourceEvents(request, env);
    if (path === '/internal/context-exchange' && request.method === 'POST')
      return await contextExchange(request, env);
    if (path === '/internal/browser-claims' && request.method === 'POST')
      return await browserClaims(request, env);
    if (path.startsWith('/internal/operator/') && request.method === 'POST')
      return await operatorRoute(request, env);
    if (path.startsWith('/internal/')) return jsonError('not_found', 404, request, env);
    return jsonError('not_found', 404, request, env);
  } catch (error) {
    console.warn(redactError(error));
    const invalid = error instanceof TypeError || error instanceof SyntaxError;
    const code = invalid ? 'invalid_request' : 'tracking_unavailable';
    return jsonError(code, invalid ? 400 : 503, request, env);
  }
}

export function resetCollectorBudgets(): void {
  counters.clear();
}

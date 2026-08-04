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
} from './privacy.ts';
import { persistCanonicalEvent, type QueueLike } from './outbox.ts';
import { healthResponse, jsonResponse, redactError } from './observability.ts';

export type CollectorEnv = Record<string, unknown> & {
  TRACKING_DB: D1Database;
  EVENTS_QUEUE?: QueueLike;
  TRACKING_CONTEXT_SIGN?: TrackingContextSigner;
  TRACKING_CONTEXT_VERIFY?: TrackingContextVerifier;
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
};
type TrackingContextVerifier = (contextHash: string) => EventContext | null | Promise<EventContext | null>;
type TrackingContextSigner = (context: EventContext) => string | Promise<string>;

function base64url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

function projectedEvent(
  event: CanonicalEvent,
  state: { decisions: Parameters<typeof projectPermittedFields>[1] }
): CanonicalEvent {
  validateTrackingArtifacts(trackingControls);
  return projectPermittedFields(event, state.decisions, trackingFieldPolicy);
}

export function sourceRuntimeReady(
  source: SourceSystem,
  runtimes: unknown[] = sourceRuntimeManifest.runtimes
): boolean {
  const runtime = runtimes.find(
    (item) => item && typeof item === 'object' && (item as { source?: unknown }).source === source
  ) as
    | Record<string, unknown>
    | undefined;
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
): Promise<boolean> {
  if (!contextHash || !/^[a-f0-9]{64}$/i.test(contextHash)) return false;
  const verifier = env.TRACKING_CONTEXT_VERIFY;
  if (typeof verifier !== 'function') return false;
  const context = await verifier(contextHash);
  if (!context) return false;
  const rolloutContext = rolloutState.context;
  const policyVersion = String(privacyPolicy.policy_version);
  if (
    context.subject_deleted ||
    context.tenant_id !== event.tenant_id ||
    context.site_id !== event.site_id ||
    context.funnel_id !== rolloutContext.funnel ||
    context.funnel_id !== rolloutContext.bound_funnel ||
    !context.subject_id ||
    context.policy_version !== policyVersion ||
    event.privacy.policy_version !== policyVersion
  )
    return false;
  return true;
}
const PUBLIC_BROWSER_EVENTS = new Set<EventName>(['PageView']);
const AUTHORITATIVE_EVENTS = new Set<EventName>(['Lead', 'InitiateCheckout', 'Purchase']);
const SOURCE_SYSTEMS = new Set<SourceSystem>(['pages', 'app_idea', 'blueprint']);

type Counter = { window: number; count: number };
const counters = new Map<string, Counter>();
const destinationSpend = new Map<string, Counter>();

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
  const state = await loadPrivacyState(request, env, visitor ?? undefined, privacySubject ?? undefined);
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
  const context = state.resolved && trackingAllowed
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
  if (!(await verifyEventContext(env, candidate, request.headers.get('x-tracking-context-hash'))))
    return jsonError('invalid_context', 403, request, env);
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
    await persistCanonicalEvent(env, projectedEvent(candidate, state), state);
    return jsonResponse({ accepted: true, suppressed: true }, 202, cors(request, env));
  }
  await persistCanonicalEvent(env, projectedEvent(candidate, state), state);
  return jsonResponse({ accepted: true, suppressed: false }, 202, cors(request, env));
}

function sourceKey(env: Record<string, unknown>, source: SourceSystem): unknown {
  return env[`TRACKING_${source.toUpperCase()}_BRIDGE_KEY_CURRENT`];
}

async function importHmacKey(value: unknown): Promise<CryptoKey | null> {
  if (value && typeof value === 'object' && 'type' in value) return value as CryptoKey;
  if (typeof value !== 'string' || value.length < 16 || value.length > 4096) return null;
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

export function sourceEnvelopeToCanonical(
  value: unknown,
  source: SourceSystem,
  env: CollectorEnv
): CanonicalEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid_source_envelope');
  const input = value as Record<string, unknown>;
  const allowedInputKeys = new Set([
    'schema_version',
    'event_id',
    'event_name',
    'occurred_at',
    'context_hash',
    'identity',
    'commerce',
    'privacy',
  ]);
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key)))
    throw new TypeError('invalid_source_envelope');
  const eventName = input.event_name;
  if (!AUTHORITATIVE_EVENTS.has(eventName as EventName))
    throw new TypeError('invalid_authoritative_event');
  if (input.schema_version !== '1' || typeof input.event_id !== 'string')
    throw new TypeError('invalid_source_envelope');
  if (typeof input.occurred_at !== 'string') throw new TypeError('invalid_source_envelope');

  const rawIdentity =
    input.identity && typeof input.identity === 'object' && !Array.isArray(input.identity)
      ? (input.identity as Record<string, unknown>)
      : {};
  const identity: Record<string, string> = {};
  for (const key of ['lead_id', 'funnel_id', 'checkout_id', 'order_id', 'payment_id', 'external_id']) {
    if (typeof rawIdentity[key] === 'string' && rawIdentity[key]) identity[key] = rawIdentity[key] as string;
  }
  const rawPrivacy =
    input.privacy && typeof input.privacy === 'object' && !Array.isArray(input.privacy)
      ? (input.privacy as Record<string, unknown>)
      : {};
  const privacy: Record<string, string | boolean> = {
    gpc: rawPrivacy.gpc === true,
    opted_out: rawPrivacy.opted_out === true,
  };
  privacy.policy_version =
    typeof rawPrivacy.policy_version === 'string'
      ? rawPrivacy.policy_version.slice(0, 128)
      : String(privacyPolicy.policy_version);
  if (typeof rawPrivacy.region === 'string') privacy.region = rawPrivacy.region.slice(0, 32);
  const rawCommerce =
    input.commerce && typeof input.commerce === 'object' && !Array.isArray(input.commerce)
      ? input.commerce
      : {};
  return validateCanonicalEvent({
    schema_version: '1',
    tenant_id: textEnv(env, 'TRACKING_TENANT_ID', 'default'),
    site_id: textEnv(env, 'TRACKING_SITE_ID', 'default'),
    event_id: input.event_id,
    event_name: eventName,
    source: 'server',
    source_system: source,
    occurred_at: input.occurred_at,
    visitor: {},
    session: {},
    page: {},
    attribution: {},
    identity,
    commerce: rawCommerce,
    privacy,
  });
}

async function sourceEvents(request: Request, env: CollectorEnv): Promise<Response> {
  // Server-to-server bridges authenticate the exact body with an independent key;
  // a browser Origin header is neither required nor trusted on this route.
  if (!exactHost(request, env)) return jsonError('not_allowed', 403, request, env);
  const source = request.headers.get('x-tracking-source') as SourceSystem | null;
  if (!source || !SOURCE_SYSTEMS.has(source)) return jsonError('invalid_source', 401, request, env);
  if (!sourceRuntimeReady(source)) return jsonError('source_runtime_not_ready', 403, request, env);
  const timestamp = request.headers.get('x-tracking-timestamp') ?? '';
  const nonce = request.headers.get('x-tracking-nonce') ?? '';
  const signature = request.headers.get('x-tracking-signature') ?? '';
  const numericTimestamp = Number(timestamp);
  if (
    !/^\d{10}$/.test(timestamp) ||
    !/^[-A-Za-z0-9_]{8,128}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    Math.abs(Date.now() / 1000 - numericTimestamp) > 300
  )
    return jsonError('invalid_signature', 401, request, env);
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > EVENT_MAX_BYTES)
    return jsonError('body_too_large', 413, request, env);
  const key = await importHmacKey(sourceKey(env, source));
  if (!key) return jsonError('source_not_configured', 503, request, env);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(signature.match(/.{2}/g)!.map((pair) => parseInt(pair, 16))),
    new TextEncoder().encode(`${timestamp}.${nonce}.${bodyText}`)
  );
  if (!valid) return jsonError('invalid_signature', 401, request, env);
  const nonceResult = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(source_system, nonce) DO NOTHING`
  )
    .bind(nonce, source, new Date(Date.now() + 300_000).toISOString(), new Date().toISOString())
    .run();
  if ((nonceResult.meta?.changes ?? 0) !== 1)
    return jsonError('replayed_request', 409, request, env);
  const body = JSON.parse(bodyText) as unknown;
  if (!safeJson(body)) return jsonError('body_limits_exceeded', 400, request, env);
  const event = sourceEnvelopeToCanonical(body, source, env);
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
  const contextHash =
    body && typeof body === 'object' && !Array.isArray(body) &&
      typeof (body as Record<string, unknown>).context_hash === 'string'
      ? (body as Record<string, string>).context_hash
      : null;
  if (!(await verifyEventContext(env, event, contextHash)))
    return jsonError('invalid_context', 403, request, env);
  const state = await loadPrivacyState(request, env, event.visitor.visitor_id);
  const result = await persistCanonicalEvent(env, projectedEvent(event, state), state);
  return jsonResponse(
    { accepted: true, event_key: result.eventKey, suppressed: result.suppressed },
    202,
    cors(request, env)
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
  const state = await loadPrivacyState(request, env, visitor ?? undefined, privacySubject ?? undefined);
  return jsonResponse(
    {
      accepted: true,
      choice_id: body.choiceId,
      resolved: state.resolved,
      policy_version: state.policyVersion,
      purposes: state.decisions.filter((decision) => decision.allowed).map((decision) => decision.purpose),
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
  const requestId = crypto.randomUUID();
  await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_deletion_requests (request_id, tenant_id, subject_key, request_type, state, verification_state, created_at, audit_json) VALUES (?, ?, ?, ?, 'received', 'pending', ?, ?)`
  )
    .bind(
      requestId,
      textEnv(env, 'TRACKING_TENANT_ID', 'default'),
      subjectKey,
      requestType,
      new Date().toISOString(),
      JSON.stringify({ source: 'worker', purpose: 'privacy_request' })
    )
    .run();
  return jsonResponse({ request_id: requestId, state: 'received' }, 202, cors(request, env));
}

async function verifyInternalBody(
  request: Request,
  env: CollectorEnv,
  bodyText: string,
  keyValue: unknown,
  sourceSystem: string
): Promise<boolean> {
  const timestamp = request.headers.get('x-tracking-context-timestamp') ?? '';
  const nonce = request.headers.get('x-tracking-context-nonce') ?? '';
  const signature = request.headers.get('x-tracking-context-signature') ?? '';
  if (
    !/^\d{10}$/.test(timestamp) ||
    !/^[-A-Za-z0-9_]{8,128}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const key = await importHmacKey(keyValue);
  if (!key) return false;
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(signature.match(/.{2}/g)!.map((pair) => parseInt(pair, 16))),
    new TextEncoder().encode(`${timestamp}.${nonce}.${bodyText}`)
  );
  if (!valid) return false;
  const result = await env.TRACKING_DB.prepare(
    `INSERT INTO tracking_nonces (nonce, source_system, expires_at, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(source_system, nonce) DO NOTHING`
  )
    .bind(
      nonce,
      sourceSystem,
      new Date(Date.now() + 300_000).toISOString(),
      new Date().toISOString()
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function browserClaims(request: Request, env: CollectorEnv): Promise<Response> {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405, request, env);
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > EVENT_MAX_BYTES)
    return jsonError('body_too_large', 413, request, env);
  if (
    !(await verifyInternalBody(
      request,
      env,
      bodyText,
      env.TRACKING_CONTEXT_SIGNING_KEY_CURRENT ?? env.TRACKING_PAGES_BRIDGE_KEY_CURRENT,
      'pages_context'
    ))
  )
    return jsonError('not_authorized', 401, request, env);
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  const paymentIds = Array.isArray(body.payment_ids)
    ? body.payment_ids
        .filter(
          (value): value is string =>
            typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value)
        )
        .slice(0, 50)
    : [];
  if (!paymentIds.length) return jsonResponse({ claims: [] }, 200);
  const placeholders = paymentIds.map(() => '?').join(', ');
  const rows = await env.TRACKING_DB.prepare(
    `SELECT payment_id FROM tracking_purchase_browser_claims
       WHERE tenant_id = ? AND site_id = ? AND payment_id IN (${placeholders})`
  )
    .bind(
      textEnv(env, 'TRACKING_TENANT_ID', 'default'),
      textEnv(env, 'TRACKING_SITE_ID', 'default'),
      ...paymentIds
    )
    .all<{ payment_id: string }>();
  // Only safe commerce identifiers cross the Worker boundary. Buyer context is never returned.
  return jsonResponse(
    { claims: (rows.results ?? []).map((row) => ({ payment_id: row.payment_id })) },
    200
  );
}

async function operatorRoute(request: Request, env: CollectorEnv): Promise<Response> {
  const configured = textEnv(env, 'TRACKING_OPERATOR_TOKEN');
  if (!configured || request.headers.get('authorization') !== `Bearer ${configured}`)
    return jsonError('not_authorized', 401, request, env);
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return jsonError('invalid_request', 400, request, env);
  const input = body as Record<string, unknown>;
  const path = new URL(request.url).pathname;
  if (path === '/internal/operator/kill-switch') {
    if (typeof input.enabled !== 'boolean') return jsonError('invalid_request', 400, request, env);
    env.TRACKING_KILL_SWITCH = input.enabled ? 'true' : 'false';
    await env.TRACKING_DB.prepare(
      `INSERT INTO tracking_scope_audits
         (audit_id, tenant_id, site_id, source_system, result, reason, created_at)
         VALUES (?, ?, ?, 'operator', 'accepted', ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        textEnv(env, 'TRACKING_TENANT_ID', 'default'),
        textEnv(env, 'TRACKING_SITE_ID', 'default'),
        input.enabled ? 'kill_switch_enabled' : 'kill_switch_disabled',
        new Date().toISOString()
      )
      .run();
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
    await env.EVENTS_QUEUE.send({ event_key: eventKey, destination, schema_version: '1' });
    return jsonResponse({ accepted: true, event_key: eventKey, destination });
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
  destinationSpend.clear();
}

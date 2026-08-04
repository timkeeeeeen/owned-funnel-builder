import type { D1Database } from '../../../functions/_lib/runtime.ts';
import {
  resolvePrivacy,
  type PrivacyDecision,
  type PrivacyPurpose,
} from '../../../functions/_lib/tracking-privacy.ts';
import { redactError } from './observability.ts';

export type PrivacyState = {
  decisions: PrivacyDecision[];
  gpc: boolean;
  observedAt: string;
  policyVersion: string;
  region: string;
};

type PrivacyRow = {
  purpose: PrivacyPurpose;
  choice: string;
  policy_version: string;
  effective_at: string;
  source: 'ui' | 'gpc' | 'operator';
  region_source: string;
};

const purposeSet = new Set<PrivacyPurpose>([
  'necessary',
  'analytics',
  'advertising',
  'identity_enrichment',
  'sale_share',
]);

function envString(env: Record<string, unknown>, key: string, fallback: string): string {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback;
}

export async function loadPrivacyState(
  request: Request,
  env: Record<string, unknown>,
  visitorId?: string
): Promise<PrivacyState> {
  const database = env.TRACKING_DB as D1Database | undefined;
  const tenantId = envString(env, 'TRACKING_TENANT_ID', 'default');
  const siteId = envString(env, 'TRACKING_SITE_ID', 'default');
  const policyVersion = envString(env, 'TRACKING_POLICY_VERSION', '1');
  const region = envString(env, 'TRACKING_REGION', 'US');
  let rows: PrivacyRow[] = [];
  let storageFailure = false;
  if (database) {
    try {
      const result = await database
        .prepare(
          `SELECT purpose, choice, policy_version, effective_at, source, region_source
           FROM tracking_privacy_choices
           WHERE tenant_id = ? AND site_id = ? AND (visitor_id = ? OR visitor_id IS NULL)
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY effective_at ASC LIMIT 200`
        )
        .bind(tenantId, siteId, visitorId ?? null, new Date().toISOString())
        .all<PrivacyRow>();
      rows = result.results ?? [];
    } catch (error) {
      // A missing optional privacy table must fail closed, not make an event destination unsafe.
      console.warn(redactError(error));
      storageFailure = true;
    }
  }
  const stored = rows
    .filter((row) => purposeSet.has(row.purpose))
    .map((row) => ({
      purpose: row.purpose,
      allowed: row.choice === 'allow',
      policyVersion: row.policy_version,
      effectiveAt: row.effective_at,
      source: row.source,
      region: row.region_source,
    }));
  const failClosed =
    storageFailure || env.TRACKING_FAIL_CLOSED === true || env.TRACKING_FAIL_CLOSED === 'true';
  const decisions = resolvePrivacy(request, stored, { region, failClosed, policyVersion });
  return {
    decisions,
    gpc: request.headers.get('sec-gpc') === '1',
    observedAt: new Date().toISOString(),
    policyVersion,
    region,
  };
}

export function allows(state: PrivacyState, purpose: PrivacyPurpose): boolean {
  return state.decisions.some((decision) => decision.purpose === purpose && decision.allowed);
}

export function privacySnapshot(state: PrivacyState): Record<string, string | boolean> {
  return {
    policy_version: state.policyVersion,
    region: state.region,
    gpc: state.gpc,
    opted_out: !allows(state, 'advertising'),
  };
}

export async function recordPrivacyChoice(
  env: Record<string, unknown>,
  input: {
    visitorId?: string;
    purpose: PrivacyPurpose;
    allowed: boolean;
    source: 'ui' | 'gpc' | 'operator';
    region: string;
    policyVersion: string;
    supersedesChoiceKey?: string;
    expiresAt?: string;
  }
): Promise<string> {
  if (!purposeSet.has(input.purpose)) throw new TypeError('Unsupported privacy purpose');
  const database = env.TRACKING_DB as D1Database | undefined;
  if (!database) throw new Error('tracking_database_unavailable');
  const choiceKey = crypto.randomUUID();
  const now = new Date().toISOString();
  const tenantId = envString(env, 'TRACKING_TENANT_ID', 'default');
  const siteId = envString(env, 'TRACKING_SITE_ID', 'default');
  await database
    .prepare(
      `INSERT INTO tracking_privacy_choices
       (choice_key, tenant_id, site_id, visitor_id, purpose, choice, policy_version,
        region_source, source, supersedes_choice_key, effective_at, observed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      choiceKey,
      tenantId,
      siteId,
      input.visitorId ?? null,
      input.purpose,
      input.allowed ? 'allow' : 'deny',
      input.policyVersion,
      input.region,
      input.source,
      input.supersedesChoiceKey ?? null,
      now,
      now,
      input.expiresAt ?? null
    )
    .run();
  return choiceKey;
}

export async function recordGpcObservation(
  env: Record<string, unknown>,
  visitorId?: string
): Promise<void> {
  // GPC is an observed browser signal, not a user choice. The immutable audit row uses source=gpc.
  try {
    const database = env.TRACKING_DB as D1Database | undefined;
    const tenantId = envString(env, 'TRACKING_TENANT_ID', 'default');
    const siteId = envString(env, 'TRACKING_SITE_ID', 'default');
    if (database && visitorId) {
      const recent = await database
        .prepare(
          `SELECT choice_key FROM tracking_privacy_choices
           WHERE tenant_id = ? AND site_id = ? AND visitor_id = ?
             AND source = 'gpc' AND effective_at >= ? LIMIT 1`
        )
        .bind(tenantId, siteId, visitorId, new Date(Date.now() - 86_400_000).toISOString())
        .first();
      if (recent) return;
    }
    await recordPrivacyChoice(env, {
      visitorId,
      purpose: 'sale_share',
      allowed: false,
      source: 'gpc',
      region: envString(env, 'TRACKING_REGION', 'US'),
      policyVersion: envString(env, 'TRACKING_POLICY_VERSION', '1'),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
  } catch (error) {
    console.warn(redactError(error));
  }
}

export function privacyBody(value: unknown): {
  purpose: PrivacyPurpose;
  allowed: boolean;
  visitor_id?: string;
  choice_id?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid_privacy_body');
  const body = value as Record<string, unknown>;
  if (typeof body.purpose !== 'string' || !purposeSet.has(body.purpose as PrivacyPurpose))
    throw new TypeError('invalid_privacy_purpose');
  if (typeof body.allowed !== 'boolean') throw new TypeError('invalid_privacy_choice');
  if (
    body.visitor_id !== undefined &&
    (typeof body.visitor_id !== 'string' || body.visitor_id.length > 128)
  )
    throw new TypeError('invalid_privacy_visitor');
  if (
    body.choice_id !== undefined &&
    (typeof body.choice_id !== 'string' || body.choice_id.length > 128)
  )
    throw new TypeError('invalid_privacy_choice_id');
  return {
    purpose: body.purpose as PrivacyPurpose,
    allowed: body.allowed,
    ...(typeof body.visitor_id === 'string' ? { visitor_id: body.visitor_id } : {}),
    ...(typeof body.choice_id === 'string' ? { choice_id: body.choice_id } : {}),
  };
}

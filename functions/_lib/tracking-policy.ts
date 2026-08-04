import type { CanonicalEvent, DestinationName, SourceSystem } from './tracking-contract.ts';
import type { PrivacyDecision, PrivacyPurpose } from './tracking-privacy.ts';

export type TrackingFieldRule = {
  field: string;
  purposes: PrivacyPurpose[];
  sources: SourceSystem[];
  destinations: DestinationName[];
  ttl_seconds: number;
  redaction: 'omit' | 'hmac' | 'bucket';
  provenance: 'browser' | 'source' | 'server';
};

export type TrackingProjectionOptions = { hmac?: (value: string) => string };

type Controls = {
  privacyPolicy: Record<string, unknown>;
  fieldPolicy: Record<string, unknown>;
  trustedHosts: Record<string, unknown>;
  sourceRuntimeManifest: Record<string, unknown>;
  rolloutState: Record<string, unknown>;
  providerCapabilities: Record<string, unknown>;
};

const purposes = new Set<PrivacyPurpose>([
  'necessary',
  'analytics',
  'advertising',
  'identity_enrichment',
  'sale_share',
]);
const sources = new Set<SourceSystem>(['pages', 'app_idea', 'blueprint', 'event_worker']);
const destinations = new Set<DestinationName>(['meta', 'tinybird']);
const requiredMeta = new Set(['schema', 'version', 'owner', 'policy_version']);

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function metadata(value: unknown, name: string): Record<string, unknown> {
  const item = object(value, name);
  for (const key of requiredMeta) {
    if (typeof item[key] !== 'string' || !item[key]) throw new TypeError(`${name}.${key} required`);
  }
  return item;
}

function rules(value: unknown): TrackingFieldRule[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('field policy rules required');
  return value.map((raw, index) => {
    const rule = object(raw, `fieldPolicy.rules[${index}]`);
    if (typeof rule.field !== 'string' || !rule.field || rule.field.startsWith('source.'))
      throw new TypeError('invalid field rule');
    if (!Array.isArray(rule.purposes) || !rule.purposes.length || !rule.purposes.every((p) => purposes.has(p as PrivacyPurpose)))
      throw new TypeError('invalid field purposes');
    if (!Array.isArray(rule.sources) || !rule.sources.length || !rule.sources.every((s) => sources.has(s as SourceSystem)))
      throw new TypeError('invalid field sources');
    if (!Array.isArray(rule.destinations) || !rule.destinations.length || !rule.destinations.every((d) => destinations.has(d as DestinationName)))
      throw new TypeError('invalid field destinations');
    if (!Number.isInteger(rule.ttl_seconds) || Number(rule.ttl_seconds) <= 0)
      throw new TypeError('invalid field TTL');
    if (!['omit', 'hmac', 'bucket'].includes(String(rule.redaction)))
      throw new TypeError('invalid field redaction');
    if (!['browser', 'source', 'server'].includes(String(rule.provenance)))
      throw new TypeError('invalid field provenance');
    return rule as unknown as TrackingFieldRule;
  });
}

function sourceRuntime(value: unknown): Record<string, unknown> {
  const runtime = object(value, 'sourceRuntimeManifest.runtime');
  if (!sources.has(runtime.source as SourceSystem)) throw new TypeError('invalid runtime source');
  if (typeof runtime.source_sha !== 'string' || !runtime.source_sha) throw new TypeError('source SHA required');
  if (!['shadow', 'pilot', 'enabled'].includes(String(runtime.status))) throw new TypeError('invalid runtime status');
  if (runtime.status !== 'shadow') {
    if (!/^[a-f0-9]{40,64}$/i.test(runtime.source_sha)) throw new TypeError('exact source SHA required');
    if (runtime.context_verifier !== 'signed' || typeof runtime.outbox_reconciliation_owner !== 'string' || !runtime.outbox_reconciliation_owner || runtime.dodo_ownership_readback !== 'verified') throw new TypeError('runtime launch dependencies required');
  }
  return runtime;
}

function providerCapabilities(value: unknown, required: Set<DestinationName>): void {
  const providers = metadata(value, 'providerCapabilities').providers;
  if (!Array.isArray(providers) || !providers.length) throw new TypeError('provider capabilities required');
  const covered = new Set<DestinationName>();
  for (const raw of providers) {
    const provider = object(raw, 'providerCapabilities.provider');
    const destination = provider.destination as DestinationName;
    if (!destinations.has(destination) || typeof provider.enabled !== 'boolean') throw new TypeError('invalid provider capability');
    covered.add(destination);
    const readback = object(provider.readback, 'providerCapabilities.provider.readback');
    if (!['unverified', 'verified'].includes(String(readback.status))) throw new TypeError('invalid provider readback');
    if (
      provider.enabled &&
      (readback.status !== 'verified' ||
        !['timestamp', 'reviewed_sha', 'operator', 'exact_api_token_scope', 'deletion_ttl', 'replica_backup_log_retention', 'dpa_subprocessor_owner'].every(
          (field) => typeof readback[field] === 'string' && readback[field]
        ))
    )
      throw new TypeError('verified provider readback required');
  }
  for (const destination of required) if (!covered.has(destination)) throw new TypeError('provider capability missing');
}

function rolloutState(value: unknown, runtimes: Record<string, unknown>[]): void {
  const rollout = metadata(value, 'rolloutState');
  const states = object(rollout.funnels, 'rolloutState.funnels');
  const funnelSources = object(rollout.funnel_sources, 'rolloutState.funnel_sources');
  const pilot = rollout.pilot_funnel;
  if (typeof pilot !== 'string' || !pilot || !Object.keys(states).length || !(pilot in states)) throw new TypeError('rollout pilot required');
  for (const [funnel, state] of Object.entries(states)) {
    const source = funnelSources[funnel];
    if (!['shadow', 'pilot', 'enabled'].includes(String(state)) || !sources.has(source as SourceSystem)) throw new TypeError('invalid rollout state');
    if (
      source === 'pages' &&
      ((funnel === pilot && state !== 'shadow' && !runtimes.some((item) => item.source === 'pages' && item.status !== 'shadow')) ||
        (funnel !== pilot && state !== 'shadow' && states[pilot] !== 'enabled'))
    )
      throw new TypeError('selected Pages pilot required');
    if ((source === 'app_idea' || source === 'blueprint') && state !== 'shadow' && !runtimes.some((item) => item.source === source && item.status !== 'shadow')) throw new TypeError('source rollout dependencies required');
  }
}

export function validateTrackingArtifacts(input: unknown): void {
  const controls = object(input, 'controls') as unknown as Controls;
  metadata(controls.privacyPolicy, 'privacyPolicy');
  const fieldPolicy = metadata(controls.fieldPolicy, 'fieldPolicy');
  metadata(controls.trustedHosts, 'trustedHosts');
  const sourceManifest = metadata(controls.sourceRuntimeManifest, 'sourceRuntimeManifest');
  const policyRules = rules(fieldPolicy.rules);

  const hosts = object(controls.trustedHosts, 'trustedHosts').hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) throw new TypeError('trusted hosts required');
  for (const raw of hosts) {
    const host = object(raw, 'trustedHosts.host');
    if (typeof host.host !== 'string' || /(?:pages\.dev|workers\.dev)$/.test(host.host))
      throw new TypeError('untrusted host');
  }

  const runtimes = object(sourceManifest, 'sourceRuntimeManifest').runtimes;
  if (!Array.isArray(runtimes) || runtimes.length === 0) throw new TypeError('source runtimes required');
  const parsedRuntimes = runtimes.map(sourceRuntime);
  providerCapabilities(controls.providerCapabilities, new Set(policyRules.flatMap((rule) => rule.destinations)));
  rolloutState(controls.rolloutState, parsedRuntimes);

  const context = object(controls.rolloutState, 'rolloutState').context;
  if (context !== undefined) {
    const state = object(context, 'rolloutState.context');
    if (state.funnel !== state.bound_funnel || state.subject_deleted === true)
      throw new TypeError('invalid rollout context');
    if (state.policy_version !== fieldPolicy.policy_version)
      throw new TypeError('rollout policy mismatch');
  }
}

export function validateTrackingLaunchReadiness(input: unknown): void {
  validateTrackingArtifacts(input);
  const controls = object(input, 'controls') as unknown as Controls;
  for (const raw of object(controls.sourceRuntimeManifest, 'sourceRuntimeManifest').runtimes as unknown[]) {
    if (sourceRuntime(raw).status === 'shadow') throw new TypeError('source runtime remains shadow-only');
  }
  for (const raw of object(controls.providerCapabilities, 'providerCapabilities').providers as unknown[]) {
    if (object(raw, 'providerCapabilities.provider').enabled !== true) throw new TypeError('provider destination is not enabled');
  }
}

function allowed(rule: TrackingFieldRule, event: CanonicalEvent, decisions: PrivacyDecision[]): boolean {
  return (
    rule.sources.includes(event.source_system) &&
    rule.purposes.some((purpose) => decisions.some((decision) => decision.purpose === purpose && decision.allowed))
  );
}

function sensitive(path: string): boolean {
  return /(?:fbclid|fbp|fbc|ip|user_agent|email|phone|token|external_id)/i.test(path);
}

function identityAuthority(section: string): boolean {
  return section === 'visitor' || section === 'session' || section === 'identity';
}

function bucket(value: string | number | boolean): string | number {
  if (typeof value === 'number') return Math.floor(value / 10) * 10;
  if (typeof value !== 'string') return 'other';
  if (['US', 'CA', 'MX'].includes(value.toUpperCase())) return 'North America';
  if (['GB', 'DE', 'ES', 'FR', 'IT', 'NL', 'SE'].includes(value.toUpperCase())) return 'Europe';
  return 'other';
}

export function projectPermittedFields(
  event: CanonicalEvent,
  decisions: PrivacyDecision[],
  policy: TrackingFieldRule[],
  options: TrackingProjectionOptions = {}
): CanonicalEvent {
  const output = structuredClone(event) as CanonicalEvent;
  for (const section of ['visitor', 'session', 'page', 'attribution', 'identity', 'device', 'geo'] as const) {
    const values = output[section] as Record<string, string | number | boolean> | undefined;
    if (!values) continue;
    for (const key of Object.keys(values)) {
      const rule = policy.find((candidate) => candidate.field === `${section}.${key}`);
      if (!rule || identityAuthority(section) || !allowed(rule, event, decisions) || (sensitive(`${section}.${key}`) && rule.redaction !== 'hmac')) {
        delete values[key];
      } else if (rule.redaction === 'omit') {
        delete values[key];
      } else if (rule.redaction === 'bucket') {
        values[key] = bucket(values[key]);
      } else {
        const digest = options.hmac?.(String(values[key]));
        if (!digest || !/^[a-f0-9]{64}$/i.test(digest) || digest === values[key]) delete values[key];
        else values[key] = digest;
      }
    }
  }
  return output;
}

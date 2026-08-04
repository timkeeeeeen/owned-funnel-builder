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

type Controls = {
  privacyPolicy: Record<string, unknown>;
  fieldPolicy: Record<string, unknown>;
  trustedHosts: Record<string, unknown>;
  sourceRuntimeManifest: Record<string, unknown>;
  rolloutState: Record<string, unknown>;
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
    if (!Array.isArray(rule.purposes) || !rule.purposes.every((p) => purposes.has(p as PrivacyPurpose)))
      throw new TypeError('invalid field purposes');
    if (!Array.isArray(rule.sources) || !rule.sources.every((s) => sources.has(s as SourceSystem)))
      throw new TypeError('invalid field sources');
    if (!Array.isArray(rule.destinations) || !rule.destinations.every((d) => destinations.has(d as DestinationName)))
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

export function validateTrackingArtifacts(input: unknown): void {
  const controls = object(input, 'controls') as unknown as Controls;
  metadata(controls.privacyPolicy, 'privacyPolicy');
  const fieldPolicy = metadata(controls.fieldPolicy, 'fieldPolicy');
  metadata(controls.trustedHosts, 'trustedHosts');
  const sourceManifest = metadata(controls.sourceRuntimeManifest, 'sourceRuntimeManifest');
  const rollout = metadata(controls.rolloutState, 'rolloutState');
  rules(fieldPolicy.rules);

  const hosts = object(controls.trustedHosts, 'trustedHosts').hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) throw new TypeError('trusted hosts required');
  for (const raw of hosts) {
    const host = object(raw, 'trustedHosts.host');
    if (typeof host.host !== 'string' || /(?:pages\.dev|workers\.dev)$/.test(host.host))
      throw new TypeError('untrusted host');
  }

  const runtimes = object(sourceManifest, 'sourceRuntimeManifest').runtimes;
  if (!Array.isArray(runtimes) || runtimes.length === 0) throw new TypeError('source runtimes required');
  for (const raw of runtimes) {
    const runtime = object(raw, 'sourceRuntimeManifest.runtime');
    if (typeof runtime.source_sha !== 'string' || runtime.source_sha === 'UNPINNED')
      throw new TypeError('source SHA required');
  }

  const context = rollout.context;
  if (context !== undefined) {
    const state = object(context, 'rolloutState.context');
    if (state.funnel !== state.bound_funnel || state.subject_deleted === true)
      throw new TypeError('invalid rollout context');
    if (state.policy_version !== fieldPolicy.policy_version)
      throw new TypeError('rollout policy mismatch');
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

export function projectPermittedFields(
  event: CanonicalEvent,
  decisions: PrivacyDecision[],
  policy: TrackingFieldRule[]
): CanonicalEvent {
  const output = structuredClone(event) as CanonicalEvent;
  for (const section of ['visitor', 'session', 'page', 'attribution', 'identity', 'device', 'geo'] as const) {
    const values = output[section] as Record<string, string | number | boolean>;
    for (const key of Object.keys(values)) {
      const rule = policy.find((candidate) => candidate.field === `${section}.${key}`);
      if ((rule && !allowed(rule, event, decisions)) || (!rule && sensitive(`${section}.${key}`))) {
        delete values[key];
      }
    }
  }
  return output;
}

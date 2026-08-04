import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  projectPermittedFields,
  validateTrackingArtifacts,
  validateTrackingLaunchReadiness,
  type TrackingFieldRule,
} from '../../functions/_lib/tracking-policy.ts';
import type { CanonicalEvent } from '../../functions/_lib/tracking-contract.ts';
import type { PrivacyDecision } from '../../functions/_lib/tracking-privacy.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifact = async (path: string) =>
  JSON.parse(await readFile(new URL(path, `file://${root}/`), 'utf8')) as Record<string, unknown>;
const decisions = (allowed: PrivacyDecision['purpose'][]): PrivacyDecision[] =>
  ['necessary', 'analytics', 'advertising', 'identity_enrichment', 'sale_share'].map((purpose) => ({
    purpose: purpose as PrivacyDecision['purpose'],
    allowed: allowed.includes(purpose as PrivacyDecision['purpose']),
    policyVersion: '2026-08-04',
  }));

const event = (): CanonicalEvent =>
  ({
    schema_version: '1',
    tenant_id: 'tenant',
    site_id: 'site',
    event_id: 'event',
    event_name: 'PageView',
    source: 'browser',
    source_system: 'pages',
    occurred_at: '2026-08-04T00:00:00.000Z',
    visitor: { id: 'visitor' },
    session: { id: 'session' },
    page: { path: '/offer' },
    attribution: { fbclid: 'click', fbp: 'fbp', fbc: 'fbc' },
    identity: {},
    commerce: {},
    privacy: { policy_version: '2026-08-04' },
    device: { user_agent: 'Mozilla' },
    geo: { country: 'US' },
  }) as CanonicalEvent;

test('checked-in tracking controls have accountable versioned schemas', async () => {
  const controls = await Promise.all(
    [
      'config/privacy-policy.json',
      'config/tracking-field-policy.json',
      'config/trusted-hosts.json',
      'config/source-runtime-manifest.json',
      'config/rollout-state.json',
      'config/provider-capabilities.json',
    ].map(artifact)
  );
  for (const control of controls) {
    assert.equal(typeof control.schema, 'string');
    assert.equal(typeof control.version, 'string');
    assert.equal(typeof control.owner, 'string');
    assert.equal(typeof control.policy_version, 'string');
  }
  validateTrackingArtifacts(Object.fromEntries([
    ['privacyPolicy', controls[0]],
    ['fieldPolicy', controls[1]],
    ['trustedHosts', controls[2]],
    ['sourceRuntimeManifest', controls[3]],
    ['rolloutState', controls[4]],
    ['providerCapabilities', controls[5]],
  ]));
});

test('field policy fails closed for unknown and identity-authority fields', () => {
  const policy: TrackingFieldRule[] = [
    {
      field: 'geo.country',
      purposes: ['analytics'],
      sources: ['pages'],
      destinations: ['tinybird'],
      ttl_seconds: 2_160_000,
      redaction: 'bucket',
      provenance: 'browser',
    },
    ...['attribution.fbclid', 'attribution.fbp', 'attribution.fbc', 'device.ip', 'device.user_agent'].map(
      (field) => ({
        field,
        purposes: ['advertising'] as PrivacyDecision['purpose'][],
        sources: ['pages'] as const,
        destinations: ['meta'] as const,
        ttl_seconds: 604_800,
        redaction: 'omit' as const,
        provenance: 'browser' as const,
      })
    ),
  ];
  const unsafe = event() as CanonicalEvent & {
    device: Record<string, string | number>;
    visitor: Record<string, string>;
    session: Record<string, string>;
    attribution: Record<string, string>;
  };
  unsafe.device.ip = '192.0.2.1';
  unsafe.visitor.authority = 'browser-visitor';
  unsafe.session.authority = 'browser-session';
  unsafe.attribution.unknown = 'unlisted';

  const projected = projectPermittedFields(unsafe, decisions(['necessary', 'analytics']), policy);

  assert.deepEqual(projected.attribution, {});
  assert.deepEqual(projected.device, {});
  assert.deepEqual(projected.geo, { country: 'North America' });
  assert.deepEqual(projected.page, {});
  assert.deepEqual(projected.visitor, {});
  assert.deepEqual(projected.session, {});
});

test('field redaction omits raw values and only retains approved hmac or buckets', () => {
  const base = {
    purposes: ['analytics'] as PrivacyDecision['purpose'][],
    sources: ['pages'] as const,
    destinations: ['tinybird'] as const,
    ttl_seconds: 60,
    provenance: 'browser' as const,
  };
  const policy: TrackingFieldRule[] = [
    { ...base, field: 'page.path', redaction: 'omit' },
    { ...base, field: 'attribution.utm_source', redaction: 'hmac' },
    { ...base, field: 'geo.country', redaction: 'bucket', provenance: 'server' },
  ];
  const input = event() as CanonicalEvent & { attribution: Record<string, string> };
  input.attribution = { utm_source: 'newsletter' };
  const projected = projectPermittedFields(input, decisions(['analytics']), policy, {
    hmac: () => 'a'.repeat(64),
  });

  assert.deepEqual(projected.page, {});
  assert.deepEqual(projected.attribution, { utm_source: 'a'.repeat(64) });
  assert.deepEqual(projected.geo, { country: 'North America' });
  assert.deepEqual(
    projectPermittedFields(input, decisions(['analytics']), policy).attribution,
    {}
  );
});

test('projection preserves only the validated funnel routing key', () => {
  const input = event() as CanonicalEvent;
  input.identity = { funnel_id: 'owned-funnel-builder', lead_id: 'lead_private' };
  const projected = projectPermittedFields(input, decisions(['analytics']), []);
  assert.deepEqual(projected.identity, { funnel_id: 'owned-funnel-builder' });
  input.identity = { funnel_id: 'not valid/' };
  assert.deepEqual(projectPermittedFields(input, decisions(['analytics']), []).identity, {});
});

test('control validation rejects incomplete safety fields and empty field scopes', async () => {
  const [privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities] = await Promise.all(
    [
      'config/privacy-policy.json',
      'config/tracking-field-policy.json',
      'config/trusted-hosts.json',
      'config/source-runtime-manifest.json',
      'config/rollout-state.json',
      'config/provider-capabilities.json',
    ].map(artifact)
  );
  const controls = { privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities };

  for (const unsafe of [
    { ...controls, fieldPolicy: { ...fieldPolicy, rules: [{ field: 'source.unlisted' }] } },
    { ...controls, fieldPolicy: { ...fieldPolicy, rules: [{ ...((fieldPolicy.rules as unknown[])[0] as object), purposes: [] }] } },
    { ...controls, trustedHosts: { ...trustedHosts, hosts: [{ host: 'events.workers.dev' }] } },
    {
      ...controls,
      rolloutState: {
        ...rolloutState,
        context: { funnel: 'a', bound_funnel: 'b', subject_deleted: false, policy_version: 'old' },
      },
    },
  ]) {
    assert.throws(() => validateTrackingArtifacts(unsafe));
  }
});

test('launch readiness requires exact source SHAs and verified provider readback', async () => {
  const [privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities] = await Promise.all(
    [
      'config/privacy-policy.json',
      'config/tracking-field-policy.json',
      'config/trusted-hosts.json',
      'config/source-runtime-manifest.json',
      'config/rollout-state.json',
      'config/provider-capabilities.json',
    ].map(artifact)
  );
  const controls = { privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities };
  validateTrackingArtifacts(controls);
  assert.throws(() => validateTrackingLaunchReadiness(controls));
  assert.throws(() => validateTrackingArtifacts({
    ...controls,
    providerCapabilities: {
      ...providerCapabilities,
      providers: [{ destination: 'tinybird', enabled: true, readback: { status: 'unverified' } }],
    },
  }));
  assert.throws(() => validateTrackingArtifacts({
    ...controls,
    providerCapabilities: {
      ...providerCapabilities,
      providers: [
        {
          destination: 'tinybird',
          enabled: true,
          readback: { status: 'verified', timestamp: '2026-08-04T00:00:00.000Z' },
        },
        ...(providerCapabilities.providers as unknown[]).filter(
          (provider) => (provider as { destination?: string }).destination === 'meta'
        ),
      ],
    },
  }));
  assert.throws(() => validateTrackingArtifacts({
    ...controls,
    sourceRuntimeManifest: {
      ...sourceRuntimeManifest,
      runtimes: [{ source: 'pages', source_sha: 'UNVERIFIED', status: 'pilot' }],
    },
  }));
});

test('rollout blocks Pages advancement without its selected pilot and source dependencies', async () => {
  const [privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities] = await Promise.all(
    [
      'config/privacy-policy.json',
      'config/tracking-field-policy.json',
      'config/trusted-hosts.json',
      'config/source-runtime-manifest.json',
      'config/rollout-state.json',
      'config/provider-capabilities.json',
    ].map(artifact)
  );
  const controls = { privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState, providerCapabilities };
  assert.throws(() => validateTrackingArtifacts({
    ...controls,
    rolloutState: { ...rolloutState, funnels: { ...(rolloutState.funnels as object), 'vibe-code-anything': 'pilot' } },
  }));
  assert.throws(() => validateTrackingArtifacts({
    ...controls,
    rolloutState: { ...rolloutState, funnels: { ...(rolloutState.funnels as object), 'app-idea-evaluator': 'pilot' } },
  }));
  const readyPages = {
    source: 'pages',
    source_sha: 'a'.repeat(40),
    status: 'enabled',
    context_verifier: 'signed',
    outbox_reconciliation_owner: 'maestro-platform',
    dodo_ownership_readback: 'verified',
  };
  assert.doesNotThrow(() => validateTrackingArtifacts({
    ...controls,
    sourceRuntimeManifest: {
      ...sourceRuntimeManifest,
      runtimes: [readyPages, ...(sourceRuntimeManifest.runtimes as unknown[]).filter(
        (runtime) => (runtime as { source?: string }).source !== 'pages'
      )],
    },
    rolloutState: {
      ...rolloutState,
      funnels: {
        ...(rolloutState.funnels as object),
        'owned-funnel-builder': 'enabled',
        'vibe-code-anything': 'pilot',
      },
    },
  }));
});

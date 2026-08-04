import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  projectPermittedFields,
  validateTrackingArtifacts,
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
  ]));
});

test('field policy removes advertising context before canonical persistence', () => {
  const policy: TrackingFieldRule[] = [
    {
      field: 'page.path',
      purposes: ['analytics'],
      sources: ['pages'],
      destinations: ['tinybird'],
      ttl_seconds: 2_160_000,
      redaction: 'omit',
      provenance: 'browser',
    },
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
  const unsafe = event() as CanonicalEvent & { device: Record<string, string | number> };
  unsafe.device.ip = '192.0.2.1';

  const projected = projectPermittedFields(unsafe, decisions(['necessary', 'analytics']), policy);

  assert.deepEqual(projected.attribution, {});
  assert.deepEqual(projected.device, {});
  assert.deepEqual(projected.geo, { country: 'US' });
  assert.deepEqual(projected.page, { path: '/offer' });
});

test('control validation fails closed for unsafe launch inputs', async () => {
  const [privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState] = await Promise.all(
    [
      'config/privacy-policy.json',
      'config/tracking-field-policy.json',
      'config/trusted-hosts.json',
      'config/source-runtime-manifest.json',
      'config/rollout-state.json',
    ].map(artifact)
  );
  const controls = { privacyPolicy, fieldPolicy, trustedHosts, sourceRuntimeManifest, rolloutState };

  for (const unsafe of [
    { ...controls, fieldPolicy: { ...fieldPolicy, rules: [{ field: 'source.unlisted' }] } },
    { ...controls, trustedHosts: { ...trustedHosts, hosts: [{ host: 'events.workers.dev' }] } },
    { ...controls, sourceRuntimeManifest: { ...sourceRuntimeManifest, runtimes: [{ source_sha: 'UNPINNED' }] } },
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

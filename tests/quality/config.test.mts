import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  configFingerprint,
  discoverBuiltRoutes,
  parseQualityConfig,
  resolveQualityRoutes,
} from '../../tooling/quality/config.mts';

test('parses a checkout-aware route and supplies useful capture defaults', () => {
  const config = parseQualityConfig({
    routes: [
      {
        route: '/offer/',
        primaryCta: {
          kind: 'checkout',
          activate: true,
          readySelector: 'dialog[open]',
        },
      },
    ],
  });
  assert.deepEqual(config.routes?.[0], {
    route: '/offer',
    profiles: ['desktop', 'tablet', 'mobile'],
    captures: ['first-fold', 'full-page'],
    primaryCta: {
      kind: 'checkout',
      activate: true,
      readySelector: 'dialog[open]',
    },
  });
});

test('rejects unclear configuration in plain language', () => {
  assert.throws(() => parseQualityConfig({ routes: [{ route: 'offer' }] }), /must begin with/);
  assert.throws(
    () =>
      parseQualityConfig({
        routes: [{ route: '/offer', primaryCta: { kind: 'mystery' } }],
      }),
    /internal, external, or checkout/
  );
});

test('discovers built routes without product-specific assumptions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-routes-'));
  await mkdir(join(root, 'offer', 'bonus'), { recursive: true });
  await writeFile(join(root, 'index.html'), 'home');
  await writeFile(join(root, 'offer', 'index.html'), 'offer');
  await writeFile(join(root, 'offer', 'bonus', 'index.html'), 'bonus');
  await writeFile(join(root, '404.html'), 'missing');
  assert.deepEqual(
    (await discoverBuiltRoutes(root, ['/offer/bonus'])).map((route) => route.route),
    ['/', '/offer']
  );
});

test('configured routes win over discovery and duplicate routes fail', async () => {
  const routes = [{ route: '/chosen' }];
  assert.deepEqual(await resolveQualityRoutes({ routes }, '/does/not/matter'), routes);
  await assert.rejects(
    resolveQualityRoutes({ routes: [...routes, ...routes] }, '/does/not/matter'),
    /Duplicate route/
  );
});

test('configuration fingerprint is stable across route ordering', () => {
  const first = [{ route: '/a' }, { route: '/b' }];
  const second = [...first].reverse();
  assert.equal(configFingerprint(first), configFingerprint(second));
  assert.match(configFingerprint(first), /^[a-f\d]{64}$/);
});

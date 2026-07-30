import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { configFingerprint } from '../../tooling/quality/config.mts';
import {
  QUALITY_SCHEMA_VERSION,
  QUALITY_TOOL_VERSION,
  type CaptureManifest,
  type QualityRouteConfig,
  type SmokeReceipt,
} from '../../tooling/quality/contracts.mts';
import { computeRouteBuildFingerprint, sha256 } from '../../tooling/quality/fingerprint.mts';
import { verifyEvidenceFreshness } from '../../tooling/quality/freshness.mts';

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('evidence passes only while its route, screenshots, and browser receipt are current', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-freshness-'));
  const dist = join(root, 'dist');
  const evidence = join(root, 'evidence');
  const offer = join(dist, 'offer');
  await mkdir(offer, { recursive: true });
  await mkdir(join(evidence, 'offer'), { recursive: true });
  await writeFile(join(offer, 'index.html'), '<main><h1>Offer</h1></main>');

  const routes: QualityRouteConfig[] = [
    { route: '/offer', profiles: ['mobile'], captures: ['first-fold'] },
  ];
  const buildFingerprint = computeRouteBuildFingerprint(dist, '/offer').fingerprint;
  const configHash = configFingerprint(routes);
  const screenshot = png(390, 844);
  const screenshotPath = join(evidence, 'offer', 'mobile-first-fold.png');
  await writeFile(screenshotPath, screenshot);
  const smoke: SmokeReceipt = {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    toolVersion: QUALITY_TOOL_VERSION,
    createdAt: new Date().toISOString(),
    buildFingerprint: sha256(`/offer\0${buildFingerprint}`),
    configFingerprint: configHash,
    routes: [
      {
        route: '/offer',
        profile: 'mobile',
        title: 'Offer',
        horizontalOverflow: 0,
        pageErrors: [],
        consoleErrors: [],
        resourceErrors: [],
        accessibilityViolations: [],
        passed: true,
      },
    ],
    passed: true,
  };
  const smokePath = join(evidence, 'smoke-receipt.json');
  await writeFile(smokePath, `${JSON.stringify(smoke)}\n`);
  const manifest: CaptureManifest = {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    toolVersion: QUALITY_TOOL_VERSION,
    capturedAt: new Date().toISOString(),
    playwrightVersion: 'test',
    chromiumVersion: 'test',
    configFingerprint: configHash,
    distDirectory: relative(process.cwd(), dist),
    smokeReceiptPath: relative(process.cwd(), smokePath),
    environment: {
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    },
    routes: [
      {
        route: '/offer',
        buildFingerprint,
        captures: [
          {
            route: '/offer',
            profile: 'mobile',
            kind: 'first-fold',
            path: relative(process.cwd(), screenshotPath),
            width: 390,
            height: 844,
            byteSize: screenshot.length,
            sha256: sha256(screenshot),
          },
        ],
      },
    ],
  };
  const manifestPath = join(evidence, 'capture-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  assert.deepEqual(await verifyEvidenceFreshness({ manifestPath, distDirectory: dist, routes }), {
    passed: true,
    problems: [],
  });

  await writeFile(join(offer, 'index.html'), '<main><h1>Changed</h1></main>');
  const stale = await verifyEvidenceFreshness({ manifestPath, distDirectory: dist, routes });
  assert.equal(stale.passed, false);
  assert.match(
    stale.problems.map((problem) => problem.message).join('\n'),
    /changed after screenshots/
  );
});

test('missing required viewport evidence fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-freshness-missing-'));
  const manifestPath = join(root, 'missing.json');
  const result = await verifyEvidenceFreshness({
    manifestPath,
    distDirectory: join(root, 'dist'),
    routes: [{ route: '/offer', profiles: ['mobile'], captures: ['first-fold'] }],
  });
  assert.equal(result.passed, false);
  assert.match(result.problems[0]?.message ?? '', /cannot be trusted/);
});

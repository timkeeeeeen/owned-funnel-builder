import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeRouteBuildFingerprint } from '../../tooling/quality/fingerprint.mts';

test('route fingerprints follow local dependencies and ignore unrelated pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-fingerprint-'));
  await mkdir(join(root, 'offer'), { recursive: true });
  await mkdir(join(root, 'other'), { recursive: true });
  await mkdir(join(root, '_astro'), { recursive: true });
  await writeFile(
    join(root, 'offer', 'index.html'),
    '<link rel="stylesheet" href="/_astro/offer.css"><main>Offer</main>'
  );
  await writeFile(join(root, 'other', 'index.html'), '<main>Other</main>');
  await writeFile(join(root, '_astro', 'offer.css'), 'main{color:blue}');
  const initial = computeRouteBuildFingerprint(root, '/offer');
  await writeFile(join(root, 'other', 'index.html'), '<main>Changed</main>');
  assert.equal(computeRouteBuildFingerprint(root, '/offer').fingerprint, initial.fingerprint);
  await writeFile(join(root, '_astro', 'offer.css'), 'main{color:green}');
  assert.notEqual(computeRouteBuildFingerprint(root, '/offer').fingerprint, initial.fingerprint);
});

test('missing built routes fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-fingerprint-'));
  assert.throws(() => computeRouteBuildFingerprint(root, '/missing'), /No built HTML/);
});

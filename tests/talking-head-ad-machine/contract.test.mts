import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

test('core, bump, and upsell prices stay aligned with the offer', async () => {
  const offer = await readJson('src/content/offers/talking-head-ad-machine.json');
  const funnel = await readJson('src/content/funnels/talking-head-ad-machine.json');

  assert.equal(offer.priceAmount, 27);
  assert.equal(offer.currentPrice, '$27');
  assert.equal(funnel.base.priceAmount, 27);
  assert.equal(funnel.bump.priceAmount, 9);
  assert.equal(offer.checkout.bump.price, '$9');
  assert.equal(funnel.upsells.length, 1);
  assert.equal(funnel.upsells[0].key, 'ad-test-lab');
  assert.equal(funnel.upsells[0].priceAmount, 37);
  assert.equal(funnel.upsells[0].price, '$37');
});

test('the offer and checkout remain held until fulfillment acceptance passes', async () => {
  const offer = await readJson('src/content/offers/talking-head-ad-machine.json');
  const page = await readFile(resolve(root, 'src/pages/talking-head-ad-machine/index.astro'), 'utf8');

  assert.equal(offer.published, false);
  assert.equal(offer.checkout.enabled, false);
  assert.match(page, /Checkout held for final test-mode fulfillment/);
  assert.match(page, /aria-disabled=\{!checkoutReady/);
  assert.match(page, /noindex=\{!offer\.published\}/);
});

test('the public proof package exists and carries the synthetic disclosure', async () => {
  const requiredAssets = [
    'public/og-talking-head-ad-machine.jpg',
    'public/talking-head-ad-machine/raw-demo.mp4',
    'public/talking-head-ad-machine/finished-demo.mp4',
    'public/talking-head-ad-machine/synthetic-presenter.jpg',
    'public/talking-head-ad-machine/captions.vtt',
  ];

  for (const asset of requiredAssets) {
    const path = resolve(root, asset);
    await access(path);
    assert.ok((await stat(path)).size > 0, `${asset} must not be empty`);
  }

  const offer = await readJson('src/content/offers/talking-head-ad-machine.json');
  const comparison = await readFile(
    resolve(root, 'src/components/offers/TalkingHeadComparison.astro'),
    'utf8',
  );

  assert.equal(offer.ogImage, '/og-talking-head-ad-machine.jpg');
  assert.match(offer.sections.proofDescription, /synthetic presenter/i);
  assert.match(comparison, /fictional presenter image and system voice are synthetic/i);
  assert.match(comparison, /not a customer testimonial or an ad-performance claim/i);
});

test('completion copy sends the buyer through the supported first-run path', async () => {
  const funnel = await readJson('src/content/funnels/talking-head-ad-machine.json');

  assert.equal(funnel.completion.title, 'Download the ZIP. Open START-HERE. Run the demo.');
  assert.match(funnel.completion.description, /receipt and purchased files/i);
  assert.match(funnel.base.deliveryBody, /open START-HERE\.md/i);
  assert.match(funnel.base.deliveryBody, /run the included demo/i);
});

test('Dodo preparation uses the v0.2 Mac and Windows release archives', async () => {
  const prepare = await readFile(resolve(root, 'scripts/prepare-deliverables.mjs'), 'utf8');
  const configure = await readFile(resolve(root, 'scripts/configure-dodo.mjs'), 'utf8');
  const expected = [
    'talking-head-ad-machine-macos-arm64-v0.2.0.zip',
    'talking-head-ad-machine-macos-x64-v0.2.0.zip',
    'talking-head-ad-machine-windows-x64-v0.2.0.zip',
    'hook-recording-pack-v0.1.0.zip',
    'ad-test-lab-v0.1.0.zip',
  ];

  assert.match(prepare, /release-manifest\.json/);
  assert.match(prepare, /actualSha256 !== artifact\.sha256/);
  for (const name of expected) {
    assert.match(prepare, new RegExp(name.replaceAll('.', '\\.')));
  }
  assert.match(prepare, /talking-head-ad-machine-macos-v0\.2\.0\.zip/);
  assert.match(configure, /talking-head-ad-machine-macos-v0\.2\.0\.zip/);
  assert.match(configure, /talking-head-ad-machine-windows-x64-v0\.2\.0\.zip/);
  assert.match(configure, /Array\.isArray\(deliveryEntry\)/);
  assert.match(prepare, /accepted Apple Silicon and Intel Mac artifacts are not byte-identical/);
});

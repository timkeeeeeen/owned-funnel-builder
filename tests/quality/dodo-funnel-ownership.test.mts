import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

type ProductOwner = { environment: 'preview' | 'live'; product_id: string; product_key: string; funnel_slug: string; owner_runtime: 'pages' | 'app_idea' | 'blueprint'; enabled: boolean };
const manifest = JSON.parse(await readFile('config/dodo-funnel-ownership.json', 'utf8')) as { owners: ProductOwner[]; readback: { status: string } };
const ownerFor = ({ environment, product_id }: { environment: string; product_id: string }): ProductOwner => {
  const owner = manifest.owners.find((row) => row.environment === environment && row.product_id === product_id && row.enabled);
  if (!owner) throw new Error('unknown_or_non_owned_product');
  return owner;
};

test('Dodo ownership is fail-closed until a readback supplies product owners', () => {
  assert.equal(manifest.readback.status, 'unverified');
  assert.throws(() => ownerFor({ environment: 'live', product_id: 'unknown' }));
  for (const environment of ['preview', 'live']) {
    const rows = manifest.owners.filter((row) => row.environment === environment);
    assert.equal(new Set(rows.map((row) => row.product_id)).size, rows.length);
  }
});

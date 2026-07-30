import assert from 'node:assert/strict';
import test from 'node:test';

import { pngDimensions } from '../../tooling/quality/png.mts';

test('reads PNG dimensions and rejects non-images', () => {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(390, 16);
  buffer.writeUInt32BE(844, 20);
  assert.deepEqual(pngDimensions(buffer), { width: 390, height: 844 });
  assert.throws(() => pngDimensions(Buffer.from('not png')), /valid PNG/);
});

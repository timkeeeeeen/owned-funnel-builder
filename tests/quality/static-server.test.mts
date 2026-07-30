import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startStaticServer } from '../../tooling/quality/static-server.mts';

test('the preview server supports static-site routing and rejects unsafe methods', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-server-'));
  await writeFile(join(root, 'index.html'), '<h1>Safe</h1>');
  await writeFile(join(root, 'style.css'), 'body{}');
  const server = await startStaticServer(root);
  try {
    const head = await fetch(server.origin, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const css = await fetch(`${server.origin}/style.css`);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    const missing = await fetch(`${server.origin}/missing`);
    assert.equal(missing.status, 404);
    const post = await fetch(server.origin, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await server.close();
    await server.close();
  }
});

test('the preview server never follows a file symlink outside the built site', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quality-server-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'quality-outside-'));
  const outside = join(outsideRoot, 'secret.txt');
  await writeFile(join(root, 'index.html'), 'safe');
  await writeFile(outside, 'secret');
  await symlink(outside, join(root, 'secret.txt'));
  const server = await startStaticServer(root);
  try {
    assert.equal((await fetch(`${server.origin}/secret.txt`)).status, 404);
  } finally {
    await server.close();
  }
});

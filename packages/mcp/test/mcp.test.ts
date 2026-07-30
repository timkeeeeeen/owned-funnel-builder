import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listOffers, updateOffer } from '../src/offers.js';
import { redactOutput, safeProjectPath } from '../src/project.js';
import { createServer } from '../src/server.js';
import { integrationStatus } from '../src/services.js';

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'funnel-mcp-'));
  await mkdir(join(root, 'content/offers'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"scripts":{"build":"true"}}\n');
  await writeFile(join(root, 'astro.config.mjs'), 'export default {};\n');
  await writeFile(join(root, 'content/offers/example.yaml'), 'slug: example\nheadline: Old words\ncheckout:\n  price: 29\n');
  return root;
}

test('lists and atomically updates structured offers', async () => {
  const root = await fixture();
  try {
    const listed = await listOffers(root);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.slug, 'example');
    await updateOffer(root, 'example', { headline: 'New words', checkout: { price: 49 } });
    const source = await readFile(join(root, 'content/offers/example.yaml'), 'utf8');
    assert.match(source, /headline: New words/);
    assert.match(source, /price: 49/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses paths and symlinks that escape the project', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'funnel-outside-'));
  try {
    await assert.rejects(() => safeProjectPath(root, '../outside.txt'), /outside/);
    await symlink(outside, join(root, 'content/escape'));
    await assert.rejects(() => safeProjectPath(root, 'content/escape/private.txt'), /outside/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('configuration status never returns secret values', async () => {
  const root = await fixture();
  try {
    const secret = 'should-never-be-returned-123456789';
    await writeFile(join(root, '.dev.vars'), `DODO_PAYMENTS_API_KEY=${secret}\nDODO_PAYMENTS_ENVIRONMENT=test\nRESEND_API_KEY=${secret}\n`);
    const status = await integrationStatus(root);
    const serialized = JSON.stringify(status);
    assert.equal(status.dodo.ready, true);
    assert.equal(serialized.includes(secret), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('redacts credentials from command diagnostics', () => {
  const result = redactOutput('token=super-secret-value api_key: abcdefghijklmnopqrstuvwxyz Bearer a.b.c');
  assert.equal(result.includes('super-secret-value'), false);
  assert.equal(result.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(result.includes('a.b.c'), false);
});

test('rejects unsafe object keys and slug changes', async () => {
  const root = await fixture();
  try {
    await assert.rejects(() => updateOffer(root, 'example', { slug: 'elsewhere' }), /separate operation/);
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    await assert.rejects(() => updateOffer(root, 'example', unsafe), /not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('serves the high-level tools through the official MCP protocol', async () => {
  const root = await fixture();
  const previous = process.env.FUNNEL_PROJECT_ROOT;
  process.env.FUNNEL_PROJECT_ROOT = root;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'package-test', version: '1.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ['configuration_status', 'list_offers', 'plan_publish', 'preview_instructions', 'project_status', 'read_offer', 'update_offer', 'validate_funnel', 'verify_release'].sort()
    );
    const result = await client.callTool({ name: 'list_offers', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.structuredContent), /example/);
  } finally {
    await client.close();
    await server.close();
    if (previous === undefined) delete process.env.FUNNEL_PROJECT_ROOT;
    else process.env.FUNNEL_PROJECT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

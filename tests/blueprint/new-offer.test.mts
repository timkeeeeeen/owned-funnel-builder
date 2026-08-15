import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function dryRun(...args: string[]) {
  return execFileAsync(process.execPath, ['scripts/new-offer.mjs', ...args, '--dry-run'], {
    encoding: 'utf8',
  });
}

test('new-offer dry run defaults to the default template', async () => {
  const { stdout, stderr } = await dryRun(
    'default-template-offer',
    'Default Template Offer',
    'Ship the shortcut'
  );

  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).template, 'default');
});

test('new-offer dry run accepts the video-lead template', async () => {
  const { stdout, stderr } = await dryRun(
    'video-template-offer',
    'Video Template Offer',
    'Show the shortcut',
    '--template',
    'video-lead'
  );

  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).template, 'video-lead');
});

test('new-offer rejects an unknown template and shows the supported usage', async () => {
  await assert.rejects(
    dryRun(
      'invalid-template-offer',
      'Invalid Template Offer',
      'Reject the template',
      '--template',
      'missing'
    ),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr ?? '', /Unknown offer template: missing/);
      assert.match(failure.stderr ?? '', /\[--template <default\|video-lead>\] \[--dry-run\]/);
      return true;
    }
  );
});

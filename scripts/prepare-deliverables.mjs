import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const outputDirectory = '.funnel-state/deliverables';
await mkdir(outputDirectory, { recursive: true });

await execute(
  'git',
  ['archive', '--format=zip', `--output=${outputDirectory}/owned-funnel-builder.zip`, 'HEAD'],
  { cwd: process.cwd() }
);

await execute(
  'git',
  [
    'archive',
    '--format=zip',
    `--output=${process.cwd()}/${outputDirectory}/maestro-saas-ui-template.zip`,
    'maestro-template-v0.2.0-alpha.2',
  ],
  { cwd: '/Users/lappy/maestro-template-saas-ui-dogfood' }
);

console.log('Prepared the two source packages without including local secrets or dependencies.');

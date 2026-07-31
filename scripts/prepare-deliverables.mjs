import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

const talkingHeadDist = resolve(
  process.env.TALKING_HEAD_AD_MACHINE_DIST ?? '../talking-head-ad-machine/dist'
);
const talkingHeadManifest = JSON.parse(
  await readFile(resolve(talkingHeadDist, 'release-manifest.json'), 'utf8')
);
const talkingHeadArtifacts = [
  'talking-head-ad-machine-macos-arm64-v0.2.0.zip',
  'talking-head-ad-machine-macos-x64-v0.2.0.zip',
  'hook-recording-pack-v0.1.0.zip',
  'ad-test-lab-v0.1.0.zip',
];
const talkingHeadChecksums = new Map();

for (const name of talkingHeadArtifacts) {
  const artifact = talkingHeadManifest.artifacts.find((item) => item.name === name);
  if (!artifact) throw new Error(`The Talking-Head release manifest is missing ${name}.`);

  const source = resolve(talkingHeadDist, name);
  const bytes = await readFile(source);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== artifact.sha256) {
    throw new Error(`The Talking-Head release checksum failed for ${name}.`);
  }
  talkingHeadChecksums.set(name, actualSha256);
  await copyFile(source, resolve(outputDirectory, name));
}

const armName = 'talking-head-ad-machine-macos-arm64-v0.2.0.zip';
const intelName = 'talking-head-ad-machine-macos-x64-v0.2.0.zip';
if (talkingHeadChecksums.get(armName) !== talkingHeadChecksums.get(intelName)) {
  throw new Error('The accepted Apple Silicon and Intel Mac artifacts are not byte-identical.');
}
await copyFile(
  resolve(talkingHeadDist, armName),
  resolve(outputDirectory, 'talking-head-ad-machine-macos-v0.2.0.zip')
);

console.log(
  'Prepared the source packages, four verified Talking-Head release artifacts, and one accepted universal Mac delivery ZIP without including local secrets or dependencies.'
);

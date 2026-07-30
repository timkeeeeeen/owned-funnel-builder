import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { integrationStatus } from './services.js';
import { listOffers } from './offers.js';
import { pathExists, readPackageScripts, runProjectCommand, type CommandResult } from './project.js';

const BASIC_SCRIPTS = ['typecheck', 'check:kpis'];
const FULL_SCRIPTS = ['format:check', 'lint', 'typecheck', 'check:kpis', 'build'];

export async function validateProject(root: string, level: 'basic' | 'full') {
  const scripts = await readPackageScripts(root);
  const requested = level === 'full' ? FULL_SCRIPTS : BASIC_SCRIPTS;
  const results: CommandResult[] = [];
  for (const script of requested) {
    if (!scripts[script]) continue;
    results.push(await runProjectCommand(root, 'npm', ['run', '--if-present', script], script === 'build' ? 240_000 : 120_000));
  }
  const offers = await listOffers(root);
  const invalidOffers = offers.filter((offer) => !offer.editable && offer.format !== 'typescript');
  return {
    ok: results.every((result) => result.ok) && invalidOffers.length === 0,
    level,
    checks: results,
    offersFound: offers.length,
    invalidOfferFiles: invalidOffers.map(({ path, note }) => ({ path, note })),
    skipped: requested.filter((script) => !scripts[script]),
  };
}

export async function projectStatus(root: string) {
  const [git, offers, integrations, scripts] = await Promise.all([
    runProjectCommand(root, 'git', ['status', '--short', '--branch'], 15_000),
    listOffers(root),
    integrationStatus(root),
    readPackageScripts(root),
  ]);
  return {
    projectRoot: root,
    git: git.summary,
    offerCount: offers.length,
    offers: offers.map(({ slug, path, editable }) => ({ slug, path, editable })),
    integrations,
    capabilities: {
      preview: Boolean(scripts.dev || scripts.start),
      build: Boolean(scripts.build),
      deploy: Boolean(scripts.deploy),
      keystatic: (await pathExists(join(root, 'keystatic.config.ts'))) || (await pathExists(join(root, 'keystatic.config.mjs'))),
      skills: await pathExists(join(root, 'skills')),
    },
  };
}

export async function publishPlan(root: string, production: boolean) {
  const scripts = await readPackageScripts(root);
  const integrations = await integrationStatus(root);
  const steps = [
    'Review the landing page and every checkout step on a phone-sized screen.',
    'Run the full validation suite.',
    'Confirm Dodo is in the intended test or live environment without displaying the key.',
    'Confirm the order bump starts unselected and both decline links remain visible.',
    'Publish to Cloudflare, then verify the exact public URL and checkout CTA.',
  ];
  return {
    dryRun: true,
    production,
    readyToAttempt: integrations.cloudflare.ready && integrations.dodo.ready && Boolean(scripts.build),
    blockers: [
      ...(!integrations.cloudflare.ready ? ['Cloudflare project or D1 settings are incomplete.'] : []),
      ...(!integrations.dodo.ready ? ['Dodo checkout settings are incomplete.'] : []),
      ...(!scripts.build ? ['The project has no build command.'] : []),
    ],
    steps,
    commands: {
      validate: 'npm run build',
      publish: scripts.deploy ? 'npm run deploy' : 'Ask the publish-cloudflare skill to create a safe project-specific deploy command.',
    },
    note: 'Nothing was published. This tool only prepared the plan.',
  };
}

export async function verifyRelease(root: string, url?: string) {
  const validation = await validateProject(root, 'full');
  const git = await runProjectCommand(root, 'git', ['status', '--short', '--branch'], 15_000);
  let live: { url: string; ok: boolean; status?: number; note: string } | null = null;
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Release verification requires an https:// URL.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(parsed, { signal: controller.signal, redirect: 'follow' });
      const body = (await response.text()).slice(0, 250_000);
      live = {
        url: parsed.toString(),
        ok: response.ok && /<html[\s>]/i.test(body),
        status: response.status,
        note: response.ok ? 'The public URL returned an HTML page.' : 'The public URL did not return a successful response.',
      };
    } catch {
      live = { url: parsed.toString(), ok: false, note: 'The public URL could not be reached.' };
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    ok: validation.ok && (!live || live.ok),
    validation,
    git: git.summary,
    live,
    limitations: [
      'This does not place a real paid order.',
      'A human or browser-capable agent must visually inspect the landing page, checkout, bump, upsells, and completion page.',
    ],
  };
}

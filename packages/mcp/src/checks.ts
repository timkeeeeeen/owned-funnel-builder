import { isIP } from 'node:net';
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
    assertPublicReleaseUrl(parsed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      let target = parsed;
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        response = await fetch(target, { signal: controller.signal, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location) break;
        target = new URL(location, target);
        assertPublicReleaseUrl(target);
      }
      if (!response) throw new Error('The public URL did not return a response.');
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

function assertPublicReleaseUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Release verification requires a public https:// URL without embedded credentials.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Release verification only connects to a public website.');
  }
  if (isIP(hostname) === 4) {
    const octets = hostname.split('.').map(Number);
    const [first = 0, second = 0] = octets;
    if (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    ) {
      throw new Error('Release verification only connects to a public website.');
    }
  }
  if (isIP(hostname) === 6 && /^(?:::|::1$|f[cd]|fe[89ab])/i.test(hostname)) {
    throw new Error('Release verification only connects to a public website.');
  }
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from './project.js';

const SECRET_FILES = ['.dev.vars', '.env', '.env.local', '.env.production'];

type PaymentProvider = 'dodo' | 'stripe';

function paymentProvider(value: unknown): PaymentProvider | null {
  return value === 'dodo' || value === 'stripe' ? value : null;
}

async function configuredSettings(
  root: string
): Promise<{ names: Set<string>; provider: PaymentProvider }> {
  const found = new Set<string>();
  let selectedProvider: PaymentProvider | null = null;
  for (const name of SECRET_FILES) {
    const path = join(root, name);
    if (!(await pathExists(path))) continue;
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) found.add(match[1] ?? '');
    if (!selectedProvider) {
      const match = source.match(
        /^\s*PAYMENTS_PROVIDER\s*=\s*["']?(dodo|stripe)["']?\s*(?:#.*)?$/im
      );
      selectedProvider = paymentProvider(match?.[1]);
    }
  }
  for (const name of Object.keys(process.env)) {
    if (process.env[name]) found.add(name);
  }
  selectedProvider = paymentProvider(process.env.PAYMENTS_PROVIDER) ?? selectedProvider;
  return { names: found, provider: selectedProvider ?? 'dodo' };
}

function variableStatus(names: Set<string>, required: string[]) {
  return Object.fromEntries(required.map((name) => [name, names.has(name)]));
}

async function cloudflareFileStatus(
  root: string
): Promise<{ configFile: string | null; d1Binding: boolean; projectName: boolean }> {
  for (const name of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    const path = join(root, name);
    if (!(await pathExists(path))) continue;
    const source = await readFile(path, 'utf8');
    return {
      configFile: name,
      d1Binding: /d1_databases|\[\[d1_databases\]\]/.test(source),
      projectName: /(?:"name"\s*:|^\s*name\s*=)/m.test(source),
    };
  }
  return { configFile: null, d1Binding: false, projectName: false };
}

export async function integrationStatus(root: string) {
  const { names, provider } = await configuredSettings(root);
  const cloudflare = await cloudflareFileStatus(root);
  const dodoVariables = variableStatus(names, [
    'DODO_PAYMENTS_API_KEY',
    'DODO_PAYMENTS_ENVIRONMENT',
  ]);
  const stripeVariables = variableStatus(names, [
    'STRIPE_SECRET_KEY',
    'STRIPE_PAYMENTS_ENVIRONMENT',
    'STRIPE_WEBHOOK_SECRET',
  ]);
  const emailVariables = variableStatus(names, [
    'POSTMARK_SERVER_TOKEN',
    'EMAIL_TRANSACTIONAL_FROM',
    'EMAIL_MARKETING_FROM',
  ]);
  const cloudflareAuth = names.has('CLOUDFLARE_API_TOKEN') || names.has('CLOUDFLARE_ACCOUNT_ID');
  const dodoReady = Object.values(dodoVariables).every(Boolean);
  const stripeReady = Object.values(stripeVariables).every(Boolean);
  const emailReady = Object.values(emailVariables).every(Boolean);
  const selectedPaymentsReady = provider === 'stripe' ? stripeReady && emailReady : dodoReady;

  return {
    payments: {
      provider,
      ready: selectedPaymentsReady,
      nextStep:
        provider === 'stripe'
          ? stripeReady
            ? emailReady
              ? 'Stripe and its required Postmark email settings are present. Run test-mode validation before accepting money.'
              : 'Stripe is selected. Connect Postmark before enabling checkout so every buyer receives access.'
            : 'Stripe is selected. Connect it with the Stripe setup skill; credentials are never displayed here.'
          : dodoReady
            ? 'Dodo settings are present. Run test-mode validation before accepting money.'
            : 'Dodo is selected. Connect it with the Dodo setup skill; credentials are never displayed here.',
    },
    dodo: {
      ready: dodoReady,
      variables: dodoVariables,
      nextStep: dodoReady
        ? 'Dodo settings are present. Run validation before accepting money.'
        : 'Connect Dodo with the setup skill. Credentials are never displayed here.',
    },
    stripe: {
      ready: stripeReady,
      variables: stripeVariables,
      requiresEmail: true,
      nextStep: stripeReady
        ? 'Stripe settings are present. Verify Postmark and run test-mode validation before accepting money.'
        : 'Connect Stripe with the setup skill. Credentials are never displayed here.',
    },
    email: {
      ready: emailReady,
      variables: emailVariables,
      nextStep: emailReady
        ? 'Postmark settings are present. Send a test delivery before launch.'
        : provider === 'stripe'
          ? 'Connect Postmark before enabling Stripe so buyers receive product access.'
          : 'Connect Postmark for branded product delivery and opted-in broadcasts.',
    },
    cloudflare: {
      ready: Boolean(cloudflare.configFile && cloudflare.projectName && cloudflare.d1Binding),
      ...cloudflare,
      authenticationAvailable: cloudflareAuth,
      nextStep: cloudflare.configFile
        ? 'Cloudflare project settings were found. Authenticate when you are ready to publish.'
        : 'Run the Cloudflare setup skill before publishing.',
    },
    privacy:
      'Only the selected provider, setting names, and yes/no status are reported. Secret values were not returned.',
  };
}

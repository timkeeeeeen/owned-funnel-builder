import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from './project.js';

const SECRET_FILES = ['.dev.vars', '.env', '.env.local', '.env.production'];

async function configuredNames(root: string): Promise<Set<string>> {
  const found = new Set<string>();
  for (const name of SECRET_FILES) {
    const path = join(root, name);
    if (!(await pathExists(path))) continue;
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) found.add(match[1] ?? '');
  }
  for (const name of Object.keys(process.env)) {
    if (process.env[name]) found.add(name);
  }
  return found;
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
  const names = await configuredNames(root);
  const cloudflare = await cloudflareFileStatus(root);
  const dodoVariables = variableStatus(names, [
    'DODO_PAYMENTS_API_KEY',
    'DODO_PAYMENTS_ENVIRONMENT',
  ]);
  const resendVariables = variableStatus(names, ['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
  const cloudflareAuth = names.has('CLOUDFLARE_API_TOKEN') || names.has('CLOUDFLARE_ACCOUNT_ID');

  return {
    dodo: {
      ready: Object.values(dodoVariables).every(Boolean),
      variables: dodoVariables,
      nextStep: Object.values(dodoVariables).every(Boolean)
        ? 'Dodo settings are present. Run validation before accepting money.'
        : 'Connect Dodo with the setup skill. Credentials are never displayed here.',
    },
    resend: {
      ready: Object.values(resendVariables).every(Boolean),
      variables: resendVariables,
      nextStep: Object.values(resendVariables).every(Boolean)
        ? 'Resend settings are present. Send a test delivery before launch.'
        : 'Connect Resend if you want automatic product-delivery emails.',
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
      'Only setting names and yes/no status are reported. Secret values were not read or returned.',
  };
}

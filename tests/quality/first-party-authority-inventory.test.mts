import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidencePath = new URL(
  'docs/launch/first-party-event-pipeline-evidence.md',
  `file://${repositoryRoot}/`
);

type AuthorityRow = {
  environment: string;
  funnel: string;
  publicRoute: string;
  sourceSystem: string;
  checkoutOwner: string;
  paymentOwner: string;
  fulfillmentOwner: string;
  dodoProductId: string;
  baseSha: string;
  status: string;
};

type AuthorityCatalog = {
  eventNames: string[];
  pagesProductKeys: string[];
  blueprintClientPaths: string[];
  noStripeForLaunch: boolean;
  rows: AuthorityRow[];
};

async function readCatalog(): Promise<AuthorityCatalog> {
  const evidence = await readFile(evidencePath, 'utf8');
  const match = evidence.match(/<!-- authority-catalog\n([\s\S]*?)\n-->/);
  assert.ok(match, 'evidence must include its machine-readable authority catalog');
  return JSON.parse(match[1]) as AuthorityCatalog;
}

test('authority evidence pins the launch event, source, and ownership contracts', async () => {
  const [catalog, evidence] = await Promise.all([readCatalog(), readFile(evidencePath, 'utf8')]);
  const { eventNames, pagesProductKeys, blueprintClientPaths, noStripeForLaunch, rows } = catalog;

  assert.deepEqual(eventNames, ['PageView', 'Lead', 'InitiateCheckout', 'Purchase']);
  assert.deepEqual(
    rows.map((row) => row.sourceSystem),
    ['pages', 'pages', 'pages', 'app_idea', 'blueprint']
  );
  assert.deepEqual(pagesProductKeys, [
    'owned-funnel-builder',
    'talking-head-ad-machine',
    'vibe-code-anything',
  ]);
  assert.deepEqual(blueprintClientPaths, [
    'capabilities/billing/blueprintCheckoutStarts:start',
    'capabilities/billing/blueprintPurchases:getCheckoutStatus',
  ]);
  assert.equal(noStripeForLaunch, true);
  assert.match(evidence, /Stripe is not a launch payment owner/);
  assert.match(
    evidence,
    /\| preview\/live \| App-Idea Evaluator \| ROUTE_UNVERIFIED \| app_idea \| RUNTIME_UNVERIFIED \| RUNTIME_UNVERIFIED \| RUNTIME_UNVERIFIED \|/
  );
  assert.match(
    evidence,
    /\| preview\/live \| Maestro \$5 Blueprint \| \/authority-snapshot\/AUDIENCE \| blueprint \| RUNTIME_UNVERIFIED \| RUNTIME_UNVERIFIED \| RUNTIME_UNVERIFIED \|/
  );

  assert.deepEqual(
    new Set(rows.map((row) => row.sourceSystem)),
    new Set(['pages', 'app_idea', 'blueprint'])
  );
  const observedProductRows = rows.filter((row) => row.dodoProductId !== 'UNVERIFIED');
  assert.deepEqual(
    observedProductRows.map((row) => row.dodoProductId),
    pagesProductKeys
  );
  assert.equal(new Set(observedProductRows.map((row) => row.dodoProductId)).size, observedProductRows.length);
  assert.ok(rows.every((row) => ['pages', 'RUNTIME_UNVERIFIED'].includes(row.paymentOwner)));
});

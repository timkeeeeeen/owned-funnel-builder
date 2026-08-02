import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('../../', import.meta.url).pathname;

async function applyMigration(database: DatabaseSync, filename: string): Promise<void> {
  database.exec(await readFile(join(root, 'migrations', filename), 'utf8'));
}

test('0006 and 0007 preserve representative funnel data and add retry state', async () => {
  const database = new DatabaseSync(':memory:');
  for (const filename of [
    '0001_checkout_leads.sql',
    '0002_checkout_funnel.sql',
    '0003_generic_funnels_and_fulfillment.sql',
    '0004_saved_payment_method.sql',
    '0005_admaxxer_attribution.sql',
  ]) {
    await applyMigration(database, filename);
  }

  const now = '2026-08-02T00:00:00.000Z';
  const product = database.prepare(
    `INSERT INTO offer_products (
       product_key, dodo_product_id, name, price_amount, currency, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'USD', ?, ?)`
  );
  for (let index = 0; index < 11; index += 1) {
    product.run(`product-${index}`, `dodo-${index}`, `Product ${index}`, 100 + index, now, now);
  }
  database
    .prepare(
      `INSERT INTO checkout_leads (
       id, email, offer_slug, placement, consent_version, status, created_at, updated_at
     ) VALUES ('lead-1', 'buyer@example.com', 'owned-funnel-builder', 'hero', 'v1', 'captured', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO funnel_runs (
       id, lead_id, offer_slug, token_hash, created_at, updated_at
     ) VALUES ('funnel-1', 'lead-1', 'owned-funnel-builder', 'hash-1', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO fulfillments (
       id, payment_id, product_key, lead_id, status, created_at, updated_at
     ) VALUES ('fulfillment-1', 'payment-1', 'product-0', 'lead-1', 'sent', ?, ?)`
    )
    .run(now, now);

  await applyMigration(database, '0006_stripe_provider.sql');
  await applyMigration(database, '0007_webhook_retry_and_revocations.sql');

  const count = (table: string): number =>
    (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  assert.equal(count('offer_products'), 11);
  assert.equal(count('checkout_leads'), 1);
  assert.equal(count('fulfillments'), 1);
  const provider = database
    .prepare('SELECT payment_provider FROM checkout_leads WHERE id = ?')
    .get('lead-1') as { payment_provider: string };
  assert.equal(
    provider.payment_provider,
    'dodo'
  );
  const webhookColumns = database.prepare('PRAGMA table_info(webhook_events)').all();
  assert.ok(webhookColumns.some((column) => column.name === 'attempt_started_at'));
  const revocationColumns = database.prepare('PRAGMA table_info(payment_revocations)').all();
  assert.ok(revocationColumns.some((column) => column.name === 'provider_event_id'));
});

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('../../', import.meta.url).pathname;

async function migrations(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
}

async function applyMigration(
  database: DatabaseSync,
  directory: string,
  filename: string
): Promise<void> {
  database.exec(await readFile(join(directory, filename), 'utf8'));
}

test('business migrations preserve representative funnel data and apply both 0007 migrations', async () => {
  const database = new DatabaseSync(':memory:');
  const directory = join(root, 'migrations');
  const files = await migrations(directory);
  assert.deepEqual(
    files.filter((file) => file.startsWith('0007_')),
    ['0007_provider_neutral_email.sql', '0007_webhook_retry_and_revocations.sql']
  );
  for (const filename of files.filter((filename) => filename < '0006')) {
    await applyMigration(database, directory, filename);
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
       id, email, offer_slug, placement, consent_version, status, dodo_payment_id, created_at, updated_at
     ) VALUES ('lead-1', 'buyer@example.com', 'owned-funnel-builder', 'hero', 'v1', 'captured', 'payment-1', ?, ?)`
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

  for (const filename of files.filter((filename) => filename >= '0006')) {
    await applyMigration(database, directory, filename);
  }

  const count = (table: string): number =>
    (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  assert.equal(count('offer_products'), 11);
  assert.equal(count('checkout_leads'), 1);
  assert.equal(count('funnel_runs'), 1);
  assert.equal(count('fulfillments'), 1);
  const provider = database
    .prepare('SELECT payment_provider FROM checkout_leads WHERE id = ?')
    .get('lead-1') as { payment_provider: string };
  assert.equal(provider.payment_provider, 'dodo');
  assert.equal(
    (
      database.prepare('SELECT dodo_payment_id FROM checkout_leads WHERE id = ?').get('lead-1') as {
        dodo_payment_id: string;
      }
    ).dodo_payment_id,
    'payment-1'
  );
  const webhookColumns = database.prepare('PRAGMA table_info(webhook_events)').all();
  assert.ok(webhookColumns.some((column) => column.name === 'attempt_started_at'));
  const revocationColumns = database.prepare('PRAGMA table_info(payment_revocations)').all();
  assert.ok(revocationColumns.some((column) => column.name === 'provider_event_id'));
  assert.ok(database.prepare('SELECT * FROM source_tracking_outbox').all());
});

test('tracking migration creates only tracking tables', async () => {
  const database = new DatabaseSync(':memory:');
  const directory = join(root, 'workers', 'events', 'migrations');
  for (const filename of await migrations(directory)) {
    await applyMigration(database, directory, filename);
  }

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  assert.ok(tables.some(({ name }) => name === 'tracking_events'));
  assert.ok(tables.every(({ name }) => name === 'sqlite_sequence' || name.startsWith('tracking_')));
  assert.throws(() => database.prepare('SELECT * FROM checkout_leads').all());

  const eventColumns = database.prepare('PRAGMA table_info(tracking_events)').all();
  assert.ok(eventColumns.some(({ name }) => name === 'canonical_payload_hash'));
  assert.ok(eventColumns.some(({ name }) => name === 'privacy_subject_id'));
  const deliveryColumns = database.prepare('PRAGMA table_info(tracking_deliveries)').all();
  for (const name of [
    'destination_payload_hash',
    'transform_version',
    'transform_metadata_json',
    'lease_owner',
    'fencing_token',
    'lease_deadline',
  ]) {
    assert.ok(
      deliveryColumns.some((column) => column.name === name),
      `missing ${name}`
    );
  }
  assert.ok(tables.some(({ name }) => name === 'tracking_runtime_controls'));
  assert.ok(tables.some(({ name }) => name === 'tracking_operator_audits'));
  assert.ok(tables.some(({ name }) => name === 'tracking_runtime_release_state'));
  assert.ok(tables.some(({ name }) => name === 'tracking_delivery_budgets'));
  assert.ok(tables.some(({ name }) => name === 'tracking_runtime_metrics'));
  assert.ok(tables.some(({ name }) => name === 'tracking_ingress_capabilities'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  D1IdentityClaimStore,
  InMemoryIdentityClaimStore,
  deriveAliasKey,
  deriveAliasKeysForRotation,
  resolveIdentityClaim,
} from '../../functions/_lib/tracking-identity.ts';
import type { D1Database, D1PreparedStatement, D1RunResult } from '../../functions/_lib/runtime.ts';

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

const aliasInput = {
  tenantId: 'tenant-a',
  identifierType: 'email',
  issuerNamespace: 'checkout',
  normalizationVersion: 'email-v1',
  canonicalValue: 'buyer@example.com',
};

class SqliteStatement implements D1PreparedStatement {
  private values: Array<string | number | null> = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string
  ) {}
  bind(...values: Array<string | number | null>): D1PreparedStatement {
    this.values = values;
    return this;
  }
  async run(): Promise<D1RunResult> {
    const result = this.database.prepare(this.query).run(...this.values) as { changes?: number };
    return { success: true, meta: { changes: result.changes ?? 0 } };
  }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    return { results: this.database.prepare(this.query).all(...this.values) as T[] };
  }
}

class SqliteD1 implements D1Database {
  private queue = Promise.resolve();
  constructor(readonly database = new DatabaseSync(':memory:')) {
    database.exec(`
      CREATE TABLE tracking_people (person_id TEXT NOT NULL, tenant_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, person_id));
      CREATE TABLE tracking_aliases (
        alias_key TEXT NOT NULL, tenant_id TEXT NOT NULL, identifier_type TEXT NOT NULL,
        issuer_namespace TEXT NOT NULL, normalization_version TEXT NOT NULL, keyed_digest TEXT NOT NULL,
        hmac_key_id TEXT NOT NULL, person_id TEXT, verification_class TEXT NOT NULL,
        provenance_json TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, alias_key),
        UNIQUE (tenant_id, identifier_type, issuer_namespace, normalization_version, keyed_digest, hmac_key_id)
      );
      CREATE TABLE tracking_person_redirects (tenant_id TEXT NOT NULL, from_person_id TEXT NOT NULL, to_person_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, from_person_id));
      CREATE TABLE tracking_identity_conflicts (
        conflict_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, alias_key TEXT NOT NULL,
        left_person_id TEXT, right_person_id TEXT, state TEXT NOT NULL, details_json TEXT NOT NULL,
        created_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE tracking_suppression_tombstones (
        suppression_key TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL,
        alias_key TEXT, hmac_key_id TEXT, visitor_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }
  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query);
  }
  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    const batch = this.queue.then(() => this.runBatch(statements));
    this.queue = batch.then(
      () => undefined,
      () => undefined
    );
    return batch;
  }
  private async runBatch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    this.database.exec('BEGIN');
    try {
      const results: D1RunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

class D1View implements D1Database {
  constructor(private readonly database: SqliteD1) {}
  prepare(query: string): D1PreparedStatement {
    return this.database.prepare(query);
  }
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    return this.database.batch(statements);
  }
}

test('derives domain-separated aliases and supports current/previous key lookup during rotation', async () => {
  const current = await hmacKey('current-identity-key');
  const previous = await hmacKey('previous-identity-key');
  const alias = await deriveAliasKey(aliasInput, current);
  const phoneAlias = await deriveAliasKey({ ...aliasInput, identifierType: 'phone' }, current);
  const normalizedAlias = await deriveAliasKey(
    { ...aliasInput, normalizationVersion: 'email-v2' },
    current
  );
  const rotating = await deriveAliasKeysForRotation(aliasInput, {
    current: { id: 'new', key: current },
    previous: { id: 'old', key: previous },
  });

  assert.notEqual(alias, phoneAlias);
  assert.notEqual(alias, normalizedAlias);
  assert.deepEqual(
    rotating.map(({ id }) => id),
    ['new', 'old']
  );
  assert.equal(
    (await deriveAliasKeysForRotation(aliasInput, { current: { id: 'new', key: current } })).length,
    1
  );
});

test('quarantines revoked and asserted conflicts without silently merging people', async () => {
  const store = new InMemoryIdentityClaimStore();
  store.revoke('revoked-alias');
  assert.deepEqual(
    await resolveIdentityClaim(
      { tenantId: 'tenant-a', aliasKey: 'revoked-alias', verificationClass: 'verified' },
      store
    ),
    { personId: null, state: 'conflict' }
  );
  await store.seed('shared-alias', 'person-a', 'verified');
  assert.deepEqual(
    await resolveIdentityClaim(
      {
        tenantId: 'tenant-a',
        aliasKey: 'shared-alias',
        verificationClass: 'asserted',
        personId: 'person-b',
      },
      store
    ),
    { personId: null, state: 'conflict' }
  );
  assert.equal(store.conflicts.length, 2);
});

test('concurrent verified claims choose a stable winner and record a redirect', async () => {
  const store = new InMemoryIdentityClaimStore();
  await store.seed('shared-alias', 'person-b', 'verified');
  const [first, second] = await Promise.all([
    resolveIdentityClaim(
      {
        tenantId: 'tenant-a',
        aliasKey: 'shared-alias',
        verificationClass: 'verified',
        personId: 'person-a',
      },
      store
    ),
    resolveIdentityClaim(
      {
        tenantId: 'tenant-a',
        aliasKey: 'shared-alias',
        verificationClass: 'verified',
        personId: 'person-a',
      },
      store
    ),
  ]);

  assert.equal(first.personId, 'person-a');
  assert.equal(second.personId, 'person-a');
  assert.equal(store.redirects.get('person-b'), 'person-a');
});

test('D1 claims persist tenant-scoped aliases, conflicts, redirects, and key rotation', async () => {
  const database = new SqliteD1();
  const store = new D1IdentityClaimStore(database, {
    currentHmacKeyId: 'current',
    now: () => '2026-08-04T00:00:00.000Z',
  });
  const created = await store.resolve({
    tenantId: 'tenant-a',
    aliasKey: 'alias-a',
    verificationClass: 'verified',
    identifierType: 'email',
  });
  assert.equal(created.state, 'created');
  assert.equal(
    database.database
      .prepare('SELECT hmac_key_id FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?')
      .get('tenant-a', 'alias-a').hmac_key_id,
    'current'
  );

  database.database
    .prepare('INSERT INTO tracking_people VALUES (?, ?, ?, ?)')
    .run('person-b', 'tenant-a', '2026-08-04', '2026-08-04');
  database.database
    .prepare(
      'UPDATE tracking_aliases SET person_id = ?, hmac_key_id = ? WHERE tenant_id = ? AND alias_key = ?'
    )
    .run('person-b', 'previous', 'tenant-a', 'alias-a');
  const winner = await store.resolveWithRotation(
    {
      tenantId: 'tenant-a',
      aliasKey: 'alias-current',
      personId: 'person-a',
      verificationClass: 'verified',
      identifierType: 'email',
      issuerNamespace: 'unknown',
      normalizationVersion: 'v1',
    },
    [
      { aliasKey: 'alias-current', hmacKeyId: 'current' },
      { aliasKey: 'alias-a', hmacKeyId: 'previous' },
    ]
  );
  assert.deepEqual(winner, { personId: 'person-a', state: 'linked' });
  assert.equal(
    database.database
      .prepare(
        'SELECT to_person_id FROM tracking_person_redirects WHERE tenant_id = ? AND from_person_id = ?'
      )
      .get('tenant-a', 'person-b').to_person_id,
    'person-a'
  );
  assert.equal(
    database.database
      .prepare('SELECT hmac_key_id FROM tracking_aliases WHERE alias_key = ?')
      .get('alias-a').hmac_key_id,
    'previous'
  );
  assert.equal(
    database.database
      .prepare('SELECT person_id FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?')
      .get('tenant-a', 'alias-current').person_id,
    'person-a'
  );

  const conflict = await store.resolve({
    tenantId: 'tenant-a',
    aliasKey: 'alias-a',
    personId: 'person-z',
    verificationClass: 'asserted',
  });
  assert.deepEqual(conflict, { personId: null, state: 'conflict' });
  assert.equal(
    database.database
      .prepare('SELECT tenant_id FROM tracking_identity_conflicts ORDER BY created_at DESC LIMIT 1')
      .get().tenant_id,
    'tenant-a'
  );

  const isolated = await store.resolve({
    tenantId: 'tenant-b',
    aliasKey: 'alias-a',
    verificationClass: 'verified',
  });
  assert.equal(isolated.state, 'created');
  assert.equal(
    database.database
      .prepare('SELECT count(*) AS count FROM tracking_aliases WHERE alias_key = ?')
      .get('alias-a').count,
    2
  );

  const retired = await store.retireAliasesForKey(
    'tenant-a',
    'shop',
    'previous',
    'rotation_complete'
  );
  assert.equal(retired, 1);
  assert.equal(
    database.database
      .prepare(
        'SELECT count(*) AS count FROM tracking_aliases WHERE tenant_id = ? AND hmac_key_id = ?'
      )
      .get('tenant-a', 'previous').count,
    0
  );
  assert.equal(
    database.database
      .prepare(
        'SELECT hmac_key_id FROM tracking_suppression_tombstones WHERE tenant_id = ? AND alias_key = ?'
      )
      .get('tenant-a', 'alias-a').hmac_key_id,
    'previous'
  );
  assert.deepEqual(
    await store.resolve({
      tenantId: 'tenant-a',
      aliasKey: 'alias-a',
      verificationClass: 'verified',
    }),
    { personId: null, state: 'conflict' }
  );
  assert.equal(
    database.database
      .prepare(
        'SELECT count(*) AS count FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?'
      )
      .get('tenant-a', 'alias-a').count,
    0
  );
});

test('D1 CAS creates a redirect for a multi-store alias race', async () => {
  const database = new SqliteD1();
  const left = new D1IdentityClaimStore(new D1View(database), { currentHmacKeyId: 'current' });
  const right = new D1IdentityClaimStore(new D1View(database), { currentHmacKeyId: 'current' });
  const [first, second] = await Promise.all([
    left.resolve({
      tenantId: 'tenant-a',
      aliasKey: 'racing-alias',
      personId: 'person-b',
      verificationClass: 'verified',
    }),
    right.resolve({
      tenantId: 'tenant-a',
      aliasKey: 'racing-alias',
      personId: 'person-a',
      verificationClass: 'verified',
    }),
  ]);
  assert.equal(first.personId, 'person-b');
  assert.equal(second.personId, 'person-a');
  assert.equal(
    database.database
      .prepare('SELECT person_id FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?')
      .get('tenant-a', 'racing-alias').person_id,
    'person-a'
  );
  assert.equal(
    database.database
      .prepare(
        'SELECT to_person_id FROM tracking_person_redirects WHERE tenant_id = ? AND from_person_id = ?'
      )
      .get('tenant-a', 'person-b').to_person_id,
    'person-a'
  );
});

test('D1 leaves every old-key alias intact until current-key backfill is complete', async () => {
  const database = new SqliteD1();
  const store = new D1IdentityClaimStore(database, { currentHmacKeyId: 'current' });
  await store.resolve({
    tenantId: 'tenant-a',
    aliasKey: 'previous-only',
    hmacKeyId: 'previous',
    personId: 'person-a',
    verificationClass: 'verified',
    identifierType: 'email',
    issuerNamespace: 'checkout',
    normalizationVersion: 'v1',
  });

  assert.equal(await store.retireAliasesForKey('tenant-a', 'shop', 'previous', 'rotation'), 0);
  assert.equal(await store.retireAliasesForKey('tenant-a', 'shop', 'current', 'rotation'), 0);
  assert.equal(
    database.database
      .prepare(
        'SELECT count(*) AS count FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?'
      )
      .get('tenant-a', 'previous-only').count,
    1
  );
  assert.equal(
    database.database
      .prepare('SELECT count(*) AS count FROM tracking_suppression_tombstones WHERE tenant_id = ?')
      .get('tenant-a').count,
    0
  );
});

test('D1 retirement requires a current alias with the exact keyed digest', async () => {
  const database = new SqliteD1();
  const store = new D1IdentityClaimStore(database, { currentHmacKeyId: 'current' });
  await store.resolve({
    tenantId: 'tenant-a',
    aliasKey: 'old-alias',
    hmacKeyId: 'previous',
    keyedDigest: 'digest-a',
    personId: 'person-a',
    verificationClass: 'verified',
    identifierType: 'email',
    issuerNamespace: 'checkout',
    normalizationVersion: 'v1',
  });
  await store.resolve({
    tenantId: 'tenant-a',
    aliasKey: 'wrong-current-alias',
    keyedDigest: 'digest-b',
    personId: 'person-a',
    verificationClass: 'verified',
    identifierType: 'email',
    issuerNamespace: 'checkout',
    normalizationVersion: 'v1',
  });

  assert.equal(await store.retireAliasesForKey('tenant-a', 'shop', 'previous', 'rotation'), 0);
  assert.equal(
    database.database
      .prepare(
        'SELECT count(*) AS count FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ?'
      )
      .get('tenant-a', 'old-alias').count,
    1
  );
});

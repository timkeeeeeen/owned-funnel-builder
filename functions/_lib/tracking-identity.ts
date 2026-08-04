import type { D1Database, D1PreparedStatement, D1RunResult } from './runtime.ts';

export type IdentityClaim = {
  tenantId: string;
  aliasKey: string;
  verificationClass: 'asserted' | 'verified' | 'authoritative';
  personId?: string;
  identifierType?: string;
  issuerNamespace?: string;
  normalizationVersion?: string;
  hmacKeyId?: string;
  provenance?: Record<string, string>;
};

export type IdentityClaimResult = {
  personId: string | null;
  state: 'linked' | 'created' | 'conflict';
};

export type IdentityClaimStore = {
  transaction<T>(fn: (tx: IdentityClaimStore) => Promise<T>): Promise<T>;
  resolve(input: IdentityClaim): Promise<IdentityClaimResult>;
};

type AliasInput = {
  tenantId: string;
  identifierType: string;
  issuerNamespace: string;
  normalizationVersion: string;
  canonicalValue: string;
};

function base64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function aliasMessage(input: AliasInput): string {
  return [
    'maestro.tracking.alias.v1',
    input.tenantId,
    input.identifierType,
    input.issuerNamespace,
    input.normalizationVersion,
    input.canonicalValue,
  ]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}

export async function deriveAliasKey(input: AliasInput, key: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(aliasMessage(input))
  );
  return `v1.${base64url(new Uint8Array(signature))}`;
}

export async function deriveAliasKeysForRotation(
  input: AliasInput,
  keys: { current: { id: string; key: CryptoKey }; previous?: { id: string; key: CryptoKey } }
): Promise<Array<{ id: string; aliasKey: string }>> {
  const keyring = keys.previous ? [keys.current, keys.previous] : [keys.current];
  return Promise.all(
    keyring.map(async ({ id, key }) => ({ id, aliasKey: await deriveAliasKey(input, key) }))
  );
}

type AliasRecord = { personId: string; verificationClass: IdentityClaim['verificationClass'] };

/** Test double for the Worker D1 claim transaction; production injects its D1-backed store. */
export class InMemoryIdentityClaimStore implements IdentityClaimStore {
  readonly conflicts: Array<{
    aliasKey: string;
    leftPersonId: string | null;
    rightPersonId: string | null;
  }> = [];
  readonly redirects = new Map<string, string>();
  private readonly aliases = new Map<string, AliasRecord>();
  private readonly revoked = new Set<string>();
  private queue = Promise.resolve();

  async seed(
    aliasKey: string,
    personId: string,
    verificationClass: IdentityClaim['verificationClass']
  ): Promise<void> {
    this.aliases.set(aliasKey, { personId, verificationClass });
  }

  revoke(aliasKey: string): void {
    this.revoked.add(aliasKey);
  }

  transaction<T>(fn: (tx: IdentityClaimStore) => Promise<T>): Promise<T> {
    const transaction = this.queue.then(() => fn(this));
    this.queue = transaction.then(
      () => undefined,
      () => undefined
    );
    return transaction;
  }

  async resolve(input: IdentityClaim): Promise<IdentityClaimResult> {
    return this.resolveOne(input);
  }

  private resolveOne(input: IdentityClaim): IdentityClaimResult {
    const existing = this.aliases.get(input.aliasKey);
    if (this.revoked.has(input.aliasKey))
      return this.conflict(input.aliasKey, existing?.personId ?? null, input.personId ?? null);
    if (!existing) {
      if (input.verificationClass === 'asserted' && !input.personId)
        return this.conflict(input.aliasKey, null, null);
      const personId = input.personId ?? crypto.randomUUID();
      this.aliases.set(input.aliasKey, { personId, verificationClass: input.verificationClass });
      return { personId, state: input.personId ? 'linked' : 'created' };
    }
    if (!input.personId || input.personId === existing.personId)
      return { personId: existing.personId, state: 'linked' };
    if (input.verificationClass === 'asserted' || existing.verificationClass === 'asserted')
      return this.conflict(input.aliasKey, existing.personId, input.personId);
    const [winner, loser] = [existing.personId, input.personId].sort();
    this.aliases.set(input.aliasKey, {
      personId: winner!,
      verificationClass: input.verificationClass,
    });
    this.redirects.set(loser!, winner!);
    return { personId: winner!, state: 'linked' };
  }

  private conflict(
    aliasKey: string,
    leftPersonId: string | null,
    rightPersonId: string | null
  ): IdentityClaimResult {
    this.conflicts.push({ aliasKey, leftPersonId, rightPersonId });
    return { personId: null, state: 'conflict' };
  }
}

type AliasRow = {
  alias_key: string;
  tenant_id: string;
  hmac_key_id: string;
  person_id: string | null;
  verification_class: IdentityClaim['verificationClass'];
  revoked_at: string | null;
  identifier_type: string;
  issuer_namespace: string;
  normalization_version: string;
};

type D1IdentityOptions = {
  currentHmacKeyId: string;
  now?: () => string;
};

const aliasLocks = new WeakMap<object, Map<string, Promise<void>>>();

function identityConflictId(): string {
  return crypto.randomUUID();
}

/**
 * D1-backed claim resolver. The per-alias mutex covers one isolate only; D1
 * affected-row CAS remains the correctness boundary across isolates.
 */
export class D1IdentityClaimStore implements IdentityClaimStore {
  private readonly now: () => string;
  private readonly currentHmacKeyId: string;

  constructor(
    private readonly database: D1Database,
    options: D1IdentityOptions
  ) {
    this.currentHmacKeyId = options.currentHmacKeyId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** D1 `batch()` is the atomic boundary used by each resolve operation. */
  transaction<T>(fn: (tx: IdentityClaimStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async resolve(input: IdentityClaim): Promise<IdentityClaimResult> {
    return this.withAliasLock(input, () => this.resolveLocked(input));
  }

  private async resolveLocked(input: IdentityClaim): Promise<IdentityClaimResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await this.tombstoned(input.tenantId, input.aliasKey)) {
        return this.quarantine(input, null, input.personId);
      }
      const alias = await this.alias(input.tenantId, input.aliasKey);
      if (!alias) {
        try {
          const created = await this.create(input);
          if (created) return created;
        } catch (error) {
          if (attempt === 2) throw error;
        }
        continue;
      }
      if (alias.revoked_at) return this.quarantine(input, alias.person_id, input.personId);
      if (alias.tenant_id !== input.tenantId)
        return this.quarantine(input, alias.person_id, input.personId);
      if (!alias.person_id) {
        if (!input.personId) return this.quarantine(input, null, null);
        if (await this.personBelongsToOtherTenant(input.tenantId, input.personId)) {
          return this.quarantine(input, null, input.personId);
        }
        const [updated] = await this.database.batch([
          this.statement(
            `UPDATE tracking_aliases
             SET person_id = ?, verification_class = ?, hmac_key_id = ?, updated_at = ?
             WHERE tenant_id = ? AND alias_key = ? AND person_id IS NULL AND revoked_at IS NULL`,
            [
              input.personId,
              input.verificationClass,
              input.hmacKeyId ?? this.currentHmacKeyId,
              this.now(),
              input.tenantId,
              input.aliasKey,
            ]
          ),
        ]);
        if (changed(updated)) return { personId: input.personId, state: 'linked' };
        continue;
      }
      if (!input.personId || input.personId === alias.person_id)
        return { personId: alias.person_id, state: 'linked' };
      if (
        input.verificationClass === 'asserted' ||
        alias.verification_class === 'asserted' ||
        (await this.personBelongsToOtherTenant(input.tenantId, input.personId))
      ) {
        return this.quarantine(input, alias.person_id, input.personId);
      }
      const winner = [alias.person_id, input.personId].sort()[0]!;
      const loser = winner === alias.person_id ? input.personId : alias.person_id;
      const [, updated] = await this.database.batch([
        this.statement(
          'INSERT INTO tracking_people (person_id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, person_id) DO NOTHING',
          [winner, input.tenantId, this.now(), this.now()]
        ),
        this.statement(
          `UPDATE tracking_aliases
           SET person_id = ?, verification_class = ?, hmac_key_id = ?, updated_at = ?
           WHERE tenant_id = ? AND alias_key = ? AND person_id = ? AND verification_class = ? AND revoked_at IS NULL`,
          [
            winner,
            input.verificationClass,
            input.hmacKeyId ?? this.currentHmacKeyId,
            this.now(),
            input.tenantId,
            input.aliasKey,
            alias.person_id,
            alias.verification_class,
          ]
        ),
      ]);
      if (changed(updated)) {
        await this.redirect(input.tenantId, input.aliasKey, loser, winner);
        const current = await this.alias(input.tenantId, input.aliasKey);
        if (current?.person_id) return { personId: current.person_id, state: 'linked' };
      }
    }
    const current = await this.alias(input.tenantId, input.aliasKey);
    if (
      current?.person_id &&
      !current.revoked_at &&
      !(await this.tombstoned(input.tenantId, input.aliasKey))
    ) {
      return { personId: current.person_id, state: 'linked' };
    }
    return this.quarantine(input, current?.person_id ?? null, input.personId);
  }

  async resolveWithRotation(
    input: IdentityClaim,
    aliases: Array<{ aliasKey: string; hmacKeyId: string }>
  ): Promise<IdentityClaimResult> {
    const current = aliases[0];
    for (const candidate of aliases) {
      const candidateRow = await this.alias(input.tenantId, candidate.aliasKey);
      if (candidateRow) {
        const result = await this.resolve({
          ...input,
          aliasKey: candidate.aliasKey,
          hmacKeyId: candidate.hmacKeyId,
        });
        if (!result.personId || !current || candidate.aliasKey === current.aliasKey) return result;
        const currentResult = await this.resolve({
          ...input,
          aliasKey: current.aliasKey,
          hmacKeyId: current.hmacKeyId,
          personId: result.personId,
          identifierType: candidateRow.identifier_type,
          issuerNamespace: candidateRow.issuer_namespace,
          normalizationVersion: candidateRow.normalization_version,
        });
        return currentResult.state === 'conflict' ? currentResult : result;
      }
    }
    return this.resolve({ ...input, hmacKeyId: current?.hmacKeyId ?? input.hmacKeyId });
  }

  private async alias(tenantId: string, aliasKey: string): Promise<AliasRow | null> {
    return this.database
      .prepare(
        `SELECT alias_key, tenant_id, hmac_key_id, person_id, verification_class, revoked_at,
                identifier_type, issuer_namespace, normalization_version
         FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ? LIMIT 1`
      )
      .bind(tenantId, aliasKey)
      .first<AliasRow>();
  }

  private async create(input: IdentityClaim): Promise<IdentityClaimResult | null> {
    if (input.verificationClass === 'asserted' && !input.personId)
      return this.quarantine(input, null, null);
    const personId = input.personId ?? `${input.tenantId}:${crypto.randomUUID()}`;
    if (input.personId) {
      if (await this.personBelongsToOtherTenant(input.tenantId, input.personId)) {
        return this.quarantine(input, null, input.personId);
      }
    }
    const now = this.now();
    const [, alias] = await this.database.batch([
      this.statement(
        'INSERT INTO tracking_people (person_id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, person_id) DO NOTHING',
        [personId, input.tenantId, now, now]
      ),
      this.statement(
        `INSERT INTO tracking_aliases
          (alias_key, tenant_id, identifier_type, issuer_namespace, normalization_version,
           keyed_digest, hmac_key_id, person_id, verification_class, provenance_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, alias_key) DO NOTHING`,
        [
          input.aliasKey,
          input.tenantId,
          input.identifierType ?? 'unknown',
          input.issuerNamespace ?? 'unknown',
          input.normalizationVersion ?? 'v1',
          input.aliasKey,
          input.hmacKeyId ?? this.currentHmacKeyId,
          personId,
          input.verificationClass,
          JSON.stringify(input.provenance ?? {}),
          now,
          now,
        ]
      ),
    ]);
    return changed(alias) ? { personId, state: input.personId ? 'linked' : 'created' } : null;
  }

  private async personBelongsToOtherTenant(tenantId: string, personId: string): Promise<boolean> {
    const rows = await this.database
      .prepare('SELECT tenant_id FROM tracking_people WHERE person_id = ?')
      .bind(personId)
      .all<{ tenant_id: string }>();
    return (rows.results ?? []).some((row) => row.tenant_id !== tenantId);
  }

  private async tombstoned(tenantId: string, aliasKey: string): Promise<boolean> {
    return !!(await this.database
      .prepare(
        'SELECT suppression_key FROM tracking_suppression_tombstones WHERE tenant_id = ? AND alias_key = ? LIMIT 1'
      )
      .bind(tenantId, aliasKey)
      .first());
  }

  private async redirect(
    tenantId: string,
    aliasKey: string,
    loser: string,
    winner: string
  ): Promise<void> {
    await this.database.batch([
      this.statement(
        `UPDATE tracking_person_redirects SET to_person_id = ?
         WHERE tenant_id = ? AND to_person_id = ?
           AND EXISTS (SELECT 1 FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ? AND person_id = ?)`,
        [winner, tenantId, loser, tenantId, aliasKey, winner]
      ),
      this.statement(
        `INSERT INTO tracking_person_redirects (tenant_id, from_person_id, to_person_id, reason, created_at)
         SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (SELECT 1 FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ? AND person_id = ?)
         ON CONFLICT(tenant_id, from_person_id) DO UPDATE SET to_person_id = excluded.to_person_id`,
        [tenantId, loser, winner, 'identity_alias_stable_winner', tenantId, aliasKey, winner]
      ),
    ]);
  }

  private async quarantine(
    input: IdentityClaim,
    leftPersonId: string | null,
    rightPersonId: string | null
  ): Promise<IdentityClaimResult> {
    await this.database.batch([
      this.statement(
        `INSERT INTO tracking_identity_conflicts
          (conflict_id, tenant_id, alias_key, left_person_id, right_person_id, state, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?)`,
        [
          identityConflictId(),
          input.tenantId,
          input.aliasKey,
          leftPersonId ?? null,
          rightPersonId ?? null,
          JSON.stringify({ verificationClass: input.verificationClass }),
          this.now(),
        ]
      ),
    ]);
    return { personId: null, state: 'conflict' };
  }

  private statement(query: string, values: Array<string | number | null>): D1PreparedStatement {
    return this.database.prepare(query).bind(...values);
  }

  async retireAliasesForKey(
    tenantId: string,
    siteId: string,
    hmacKeyId: string,
    reason: string
  ): Promise<number> {
    const aliases = await this.database
      .prepare(
        `SELECT alias_key, person_id, identifier_type, issuer_namespace, normalization_version
         FROM tracking_aliases WHERE tenant_id = ? AND hmac_key_id = ?`
      )
      .bind(tenantId, hmacKeyId)
      .all<AliasRow>();
    const rows = aliases.results ?? [];
    if (!rows.length) return 0;
    for (const row of rows) {
      if (!row.person_id || !(await this.backfilled(tenantId, row))) return 0;
    }
    const now = this.now();
    const results = await this.database.batch(
      rows.flatMap(({ alias_key }) => [
        this.statement(
          `INSERT INTO tracking_suppression_tombstones
            (suppression_key, tenant_id, site_id, alias_key, hmac_key_id, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [identityConflictId(), tenantId, siteId, alias_key, hmacKeyId, reason, now]
        ),
        this.statement(
          'DELETE FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ? AND hmac_key_id = ?',
          [tenantId, alias_key, hmacKeyId]
        ),
      ])
    );
    return results.filter((_, index) => index % 2 === 1).filter(changed).length;
  }

  private async backfilled(tenantId: string, old: AliasRow): Promise<boolean> {
    return !!(await this.database
      .prepare(
        `SELECT alias_key FROM tracking_aliases
         WHERE tenant_id = ? AND hmac_key_id = ? AND person_id = ?
           AND identifier_type = ? AND issuer_namespace = ? AND normalization_version = ?
         LIMIT 1`
      )
      .bind(
        tenantId,
        this.currentHmacKeyId,
        old.person_id,
        old.identifier_type,
        old.issuer_namespace,
        old.normalization_version
      )
      .first());
  }

  private async withAliasLock<T>(input: IdentityClaim, fn: () => Promise<T>): Promise<T> {
    let locks = aliasLocks.get(this.database);
    if (!locks) aliasLocks.set(this.database, (locks = new Map()));
    const key = `${input.tenantId}\u0000${input.aliasKey}`;
    const prior = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const queued = prior.then(() => current);
    locks.set(key, queued);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === queued) locks.delete(key);
    }
  }
}

function changed(result: D1RunResult | undefined): boolean {
  return (result?.meta?.changes ?? 0) > 0;
}

export class IdentityStoreUnavailableError extends Error {
  constructor() {
    super('Identity claim store is not configured');
  }
}

export function resolveIdentityClaim(
  input: IdentityClaim,
  store?: IdentityClaimStore
): Promise<IdentityClaimResult> {
  if (!store) return Promise.reject(new IdentityStoreUnavailableError());
  return store.transaction((tx) => tx.resolve(input));
}

import type { D1Database, D1PreparedStatement } from './runtime.ts';

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
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(aliasMessage(input)));
  return `v1.${base64url(new Uint8Array(signature))}`;
}

export async function deriveAliasKeysForRotation(
  input: AliasInput,
  keys: { current: { id: string; key: CryptoKey }; previous?: { id: string; key: CryptoKey } }
): Promise<Array<{ id: string; aliasKey: string }>> {
  const keyring = keys.previous ? [keys.current, keys.previous] : [keys.current];
  return Promise.all(keyring.map(async ({ id, key }) => ({ id, aliasKey: await deriveAliasKey(input, key) })));
}

type AliasRecord = { personId: string; verificationClass: IdentityClaim['verificationClass'] };

/** Test double for the Worker D1 claim transaction; production injects its D1-backed store. */
export class InMemoryIdentityClaimStore implements IdentityClaimStore {
  readonly conflicts: Array<{ aliasKey: string; leftPersonId: string | null; rightPersonId: string | null }> = [];
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
    if (this.revoked.has(input.aliasKey)) return this.conflict(input.aliasKey, existing?.personId ?? null, input.personId ?? null);
    if (!existing) {
      if (input.verificationClass === 'asserted' && !input.personId)
        return this.conflict(input.aliasKey, null, null);
      const personId = input.personId ?? crypto.randomUUID();
      this.aliases.set(input.aliasKey, { personId, verificationClass: input.verificationClass });
      return { personId, state: input.personId ? 'linked' : 'created' };
    }
    if (!input.personId || input.personId === existing.personId) return { personId: existing.personId, state: 'linked' };
    if (input.verificationClass === 'asserted' || existing.verificationClass === 'asserted')
      return this.conflict(input.aliasKey, existing.personId, input.personId);
    const [winner, loser] = [existing.personId, input.personId].sort();
    this.aliases.set(input.aliasKey, { personId: winner!, verificationClass: input.verificationClass });
    this.redirects.set(loser!, winner!);
    return { personId: winner!, state: 'linked' };
  }

  private conflict(aliasKey: string, leftPersonId: string | null, rightPersonId: string | null): IdentityClaimResult {
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
};

type D1IdentityOptions = {
  currentHmacKeyId: string;
  now?: () => string;
};

function identityConflictId(): string {
  return crypto.randomUUID();
}

/**
 * D1-backed claim resolver. Every read and write carries tenant_id; batches are
 * D1's atomic transaction boundary, and a unique-race retry makes concurrent
 * first claims converge on the same row.
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const alias = await this.alias(input.tenantId, input.aliasKey);
      if (!alias) {
        try {
          return await this.create(input);
        } catch (error) {
          if (attempt === 1) throw error;
          continue;
        }
      }
      if (alias.revoked_at) return this.quarantine(input, alias.person_id, input.personId);
      if (alias.tenant_id !== input.tenantId) return this.quarantine(input, alias.person_id, input.personId);
      if (!alias.person_id) {
        if (!input.personId) return this.quarantine(input, null, null);
        if (await this.personBelongsToOtherTenant(input.tenantId, input.personId)) {
          return this.quarantine(input, null, input.personId);
        }
        await this.database.batch([
          this.statement(
            `UPDATE tracking_aliases
             SET person_id = ?, verification_class = ?, hmac_key_id = ?, updated_at = ?
             WHERE tenant_id = ? AND alias_key = ? AND person_id IS NULL`,
            [input.personId, input.verificationClass, input.hmacKeyId ?? this.currentHmacKeyId, this.now(), input.tenantId, input.aliasKey]
          ),
        ]);
        return { personId: input.personId, state: 'linked' };
      }
      if (!input.personId || input.personId === alias.person_id) return { personId: alias.person_id, state: 'linked' };
      if (
        input.verificationClass === 'asserted' ||
        alias.verification_class === 'asserted' ||
        (await this.personBelongsToOtherTenant(input.tenantId, input.personId))
      ) {
        return this.quarantine(input, alias.person_id, input.personId);
      }
      const winner = [alias.person_id, input.personId].sort()[0]!;
      const loser = winner === alias.person_id ? input.personId : alias.person_id;
      await this.database.batch([
        this.statement(
          'INSERT INTO tracking_people (person_id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, person_id) DO NOTHING',
          [winner, input.tenantId, this.now(), this.now()]
        ),
        this.statement(
          'INSERT INTO tracking_person_redirects (tenant_id, from_person_id, to_person_id, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, from_person_id) DO UPDATE SET to_person_id = excluded.to_person_id',
          [input.tenantId, loser, winner, 'identity_alias_stable_winner', this.now()]
        ),
        this.statement(
          `UPDATE tracking_aliases
           SET person_id = ?, verification_class = ?, hmac_key_id = ?, updated_at = ?
           WHERE tenant_id = ? AND alias_key = ?`,
          [winner, input.verificationClass, input.hmacKeyId ?? this.currentHmacKeyId, this.now(), input.tenantId, input.aliasKey]
        ),
      ]);
      return { personId: winner, state: 'linked' };
    }
    return this.quarantine(input, null, input.personId);
  }

  async resolveWithRotation(
    input: IdentityClaim,
    aliases: Array<{ aliasKey: string; hmacKeyId: string }>
  ): Promise<IdentityClaimResult> {
    const current = aliases[0];
    for (const candidate of aliases) {
      if (await this.alias(input.tenantId, candidate.aliasKey)) {
        const result = await this.resolve({ ...input, aliasKey: candidate.aliasKey, hmacKeyId: candidate.hmacKeyId });
        if (!result.personId || !current || candidate.aliasKey === current.aliasKey) return result;
        const currentResult = await this.resolve({
          ...input,
          aliasKey: current.aliasKey,
          hmacKeyId: current.hmacKeyId,
          personId: result.personId,
        });
        return currentResult.state === 'conflict' ? currentResult : result;
      }
    }
    return this.resolve({ ...input, hmacKeyId: current?.hmacKeyId ?? input.hmacKeyId });
  }

  private async alias(tenantId: string, aliasKey: string): Promise<AliasRow | null> {
    return this.database
      .prepare(
        `SELECT alias_key, tenant_id, hmac_key_id, person_id, verification_class, revoked_at
         FROM tracking_aliases WHERE tenant_id = ? AND alias_key = ? LIMIT 1`
      )
      .bind(tenantId, aliasKey)
      .first<AliasRow>();
  }

  private async create(input: IdentityClaim): Promise<IdentityClaimResult> {
    if (input.verificationClass === 'asserted' && !input.personId) return this.quarantine(input, null, null);
    const personId = input.personId ?? `${input.tenantId}:${crypto.randomUUID()}`;
    if (input.personId) {
      if (await this.personBelongsToOtherTenant(input.tenantId, input.personId)) {
        return this.quarantine(input, null, input.personId);
      }
    }
    const now = this.now();
    await this.database.batch([
      this.statement(
        'INSERT INTO tracking_people (person_id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, person_id) DO NOTHING',
        [personId, input.tenantId, now, now]
      ),
      this.statement(
        `INSERT INTO tracking_aliases
          (alias_key, tenant_id, identifier_type, issuer_namespace, normalization_version,
           keyed_digest, hmac_key_id, person_id, verification_class, provenance_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    return { personId, state: input.personId ? 'linked' : 'created' };
  }

  private async personBelongsToOtherTenant(tenantId: string, personId: string): Promise<boolean> {
    const rows = await this.database
      .prepare('SELECT tenant_id FROM tracking_people WHERE person_id = ?')
      .bind(personId)
      .all<{ tenant_id: string }>();
    return (rows.results ?? []).some((row) => row.tenant_id !== tenantId);
  }

  private async quarantine(input: IdentityClaim, leftPersonId: string | null, rightPersonId: string | null): Promise<IdentityClaimResult> {
    await this.database.batch([
      this.statement(
        `INSERT INTO tracking_identity_conflicts
          (conflict_id, tenant_id, alias_key, left_person_id, right_person_id, state, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?)`,
        [identityConflictId(), input.tenantId, input.aliasKey, leftPersonId, rightPersonId, JSON.stringify({ verificationClass: input.verificationClass }), this.now()]
      ),
    ]);
    return { personId: null, state: 'conflict' };
  }

  private statement(query: string, values: Array<string | number | null>): D1PreparedStatement {
    return this.database.prepare(query).bind(...values);
  }
}

export class IdentityStoreUnavailableError extends Error {
  constructor() {
    super('Identity claim store is not configured');
  }
}

export function resolveIdentityClaim(input: IdentityClaim, store?: IdentityClaimStore): Promise<IdentityClaimResult> {
  if (!store) return Promise.reject(new IdentityStoreUnavailableError());
  return store.transaction((tx) => tx.resolve(input));
}

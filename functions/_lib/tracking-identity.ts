export type IdentityClaim = {
  tenantId: string;
  aliasKey: string;
  verificationClass: 'asserted' | 'verified' | 'authoritative';
  personId?: string;
};

export type IdentityClaimResult = {
  personId: string | null;
  state: 'linked' | 'created' | 'conflict';
};

export type IdentityClaimStore = { resolve(input: IdentityClaim): Promise<IdentityClaimResult> };

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

  resolve(input: IdentityClaim): Promise<IdentityClaimResult> {
    const resolved = this.queue.then(() => this.resolveOne(input));
    this.queue = resolved.then(
      () => undefined,
      () => undefined
    );
    return resolved;
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

const unavailableStore: IdentityClaimStore = {
  resolve: async () => ({ personId: null, state: 'conflict' }),
};

export function resolveIdentityClaim(input: IdentityClaim & { store?: IdentityClaimStore }): Promise<IdentityClaimResult> {
  const { store = unavailableStore, ...claim } = input;
  return store.resolve(claim);
}

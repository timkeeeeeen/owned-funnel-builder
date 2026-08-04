import { D1IdentityClaimStore } from '../../../functions/_lib/tracking-identity.ts';
import type { D1Database } from '../../../functions/_lib/runtime.ts';
import { TRACKING_SECURITY_CONTRACT } from '../../../functions/_lib/tracking-security-contract.ts';

export type WorkerTrackingSecurityBindings = {
  TRACKING_DB: D1Database;
  TRACKING_IDENTITY_HMAC_KEY_ID: string;
};

/** Pages receives imported verification keys only; tracking D1 remains Worker-only. */
export type PagesTrackingSecurityBindings = {
  readonly TRACKING_COOKIE_VERIFY_KEYS: Readonly<Record<string, CryptoKey>>;
  readonly TRACKING_DB?: never;
};

export const PAGES_TRACKING_SECURITY_BINDINGS: PagesTrackingSecurityBindings = {
  TRACKING_COOKIE_VERIFY_KEYS: {},
};

/** Task 6 mounts public Worker routes; this Task 3 module only supplies their D1 adapter. */
export const TASK_6_ROUTE_INTEGRATION_BOUNDARY = 'Task 6 owns public route wiring';

export function createWorkerIdentityClaimStore(
  bindings: WorkerTrackingSecurityBindings
): D1IdentityClaimStore {
  if (
    !bindings.TRACKING_IDENTITY_HMAC_KEY_ID ||
    TRACKING_SECURITY_CONTRACT.cookieVersion !== 'v2'
  ) {
    throw new TypeError('Invalid tracking security bindings');
  }
  return new D1IdentityClaimStore(bindings.TRACKING_DB, {
    currentHmacKeyId: bindings.TRACKING_IDENTITY_HMAC_KEY_ID,
  });
}

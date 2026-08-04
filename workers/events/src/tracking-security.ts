import { D1IdentityClaimStore } from '../../../functions/_lib/tracking-identity.ts';
import type { D1Database } from '../../../functions/_lib/runtime.ts';
import { TRACKING_SECURITY_CONTRACT } from '../../../functions/_lib/tracking-security-contract.ts';

export type WorkerTrackingSecurityBindings = {
  TRACKING_DB: D1Database;
  TRACKING_IDENTITY_HMAC_KEY_ID: string;
};

/** Pages receives verification material only; tracking D1 remains Worker-only. */
export const PAGES_TRACKING_SECURITY_BINDINGS = {
  TRACKING_COOKIE_VERIFY_KEYS: 'verify-only',
} as const;

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

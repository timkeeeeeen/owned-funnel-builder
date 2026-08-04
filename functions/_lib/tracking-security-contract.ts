import type { PrivacyPurpose } from './tracking-privacy.ts';

export const TRACKING_SECURITY_CONTRACT = {
  version: '1',
  cookieVersion: 'v2',
  cookieDomain: 'shop.maestrogtm.com',
  cookieNames: ['ma_vid', 'ma_sid', 'ma_privacy'] as const,
  privacyPurposes: [
    'necessary',
    'analytics',
    'advertising',
    'identity_enrichment',
    'sale_share',
  ] as const,
  corsMethods: ['GET', 'POST', 'OPTIONS'] as const,
  corsHeaders: ['content-type', 'x-csrf-nonce'] as const,
  authoritativeEvents: ['Lead', 'InitiateCheckout', 'Purchase'] as const,
  browserEvents: ['PageView'] as const,
  forbidsRawIdentityInBrowser: true,
  forbidsTrackingDbInPages: true,
} as const;

export type TrackingSecurityPurpose = PrivacyPurpose;

export function isTrackingPurpose(value: string): value is TrackingSecurityPurpose {
  return (TRACKING_SECURITY_CONTRACT.privacyPurposes as readonly string[]).includes(value);
}

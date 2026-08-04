export type PrivacyPurpose =
  'necessary' | 'analytics' | 'advertising' | 'identity_enrichment' | 'sale_share';

export type PrivacyDecision = { purpose: PrivacyPurpose; allowed: boolean; policyVersion: string };

export type StoredPrivacyChoice = {
  purpose: PrivacyPurpose;
  allowed: boolean;
  policyVersion: string;
  effectiveAt: string;
  source: 'ui' | 'gpc' | 'operator';
  region: string;
};

const PURPOSES: PrivacyPurpose[] = [
  'necessary',
  'analytics',
  'advertising',
  'identity_enrichment',
  'sale_share',
];
const GPC_HEADER = 'sec-gpc';
const GPC_PURPOSES = new Set<PrivacyPurpose>(['advertising', 'identity_enrichment', 'sale_share']);
const KNOWN_REGIONS = new Set(['US', 'EEA', 'UK', 'CA', 'AU', 'NZ', 'CH']);

function currentChoices(
  stored: StoredPrivacyChoice[],
  region: string
): Map<PrivacyPurpose, StoredPrivacyChoice> {
  const latest = new Map<PrivacyPurpose, StoredPrivacyChoice>();
  for (const choice of stored) {
    if (choice.region !== region || Number.isNaN(Date.parse(choice.effectiveAt))) continue;
    const prior = latest.get(choice.purpose);
    if (!prior || Date.parse(choice.effectiveAt) >= Date.parse(prior.effectiveAt))
      latest.set(choice.purpose, choice);
  }
  return latest;
}

export function resolvePrivacy(
  request: Request,
  stored: StoredPrivacyChoice[],
  policy: { region: string; failClosed: boolean; policyVersion: string }
): PrivacyDecision[] {
  const choices = currentChoices(stored, policy.region);
  const gpc = request.headers.get(GPC_HEADER) === '1';
  const failClosed = policy.failClosed || !KNOWN_REGIONS.has(policy.region);
  return PURPOSES.map((purpose) => {
    const choice = choices.get(purpose);
    const staleGrant = choice?.allowed && choice.policyVersion !== policy.policyVersion;
    const allowed =
      purpose === 'necessary'
        ? true
        : choice && !choice.allowed
          ? false
          : gpc && GPC_PURPOSES.has(purpose)
            ? false
            : failClosed
              ? choice?.allowed === true && !staleGrant
              : true;
    return { purpose, allowed, policyVersion: policy.policyVersion };
  });
}

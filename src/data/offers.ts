export interface OfferItem {
  title: string;
  description: string;
}

export interface OfferProof {
  value: string;
  label: string;
  detail: string;
}

export interface OfferFaq {
  question: string;
  answer: string;
}

export interface OfferVideoSection {
  eyebrow: string;
  title: string;
  description: string;
  embedUrl: string;
  fallbackTitle: string;
  fallbackBody: string;
}

export interface OfferPreviewSection {
  eyebrow: string;
  title: string;
  description: string;
  workspaceLabel: string;
  productLabel: string;
  productDescription: string;
  navItems: string[];
  activeNavItem: string;
  activeEyebrow: string;
  activeTitle: string;
  activeDescription: string;
  statusLabel: string;
  stages: string[];
  panels: OfferItem[];
}

export interface OfferConversationLine {
  speaker: string;
  text: string;
}

export interface OfferAssistantSection {
  eyebrow: string;
  title: string;
  description: string;
  skills: OfferItem[];
  conversation: OfferConversationLine[];
}

export interface OfferFitSection {
  eyebrow: string;
  title: string;
  description: string;
  forYou: string[];
  notForYou: string[];
}

export interface OfferExample extends OfferItem {
  label: string;
}

export interface OfferExamplesSection {
  eyebrow: string;
  title: string;
  description: string;
  items: OfferExample[];
}

export interface OfferGateItem {
  label: string;
  question: string;
  description: string;
  catches: string;
}

export interface OfferGatesSection {
  eyebrow: string;
  title: string;
  description: string;
  items: OfferGateItem[];
}

export interface OfferCheckoutSection {
  provider: 'provider-checkout' | 'dodo-inline';
  enabled: boolean;
  eyebrow: string;
  title: string;
  description: string;
  emailLabel: string;
  emailPlaceholder: string;
  buttonLabel: string;
  summaryDescription: string;
  guaranteeLabel: string;
  paymentTrustLabel: string;
  consentCopy: string;
  consentVersion: string;
  bump?: {
    title: string;
    description: string;
    price: string;
    items: string[];
  };
}

export interface OfferHeroStep {
  label: string;
  title: string;
}

export interface OfferHeroPreview {
  ariaLabel: string;
  windowLabel: string;
  promptLabel: string;
  prompt: string;
  description: string;
  steps: OfferHeroStep[];
}

export interface OfferSectionCopy {
  highlights: string[];
  problemEyebrow: string;
  outcomesEyebrow: string;
  outcomesTitle: string;
  includedEyebrow: string;
  includedTitle: string;
  bonusesEyebrow: string;
  bonusesTitle: string;
  proofEyebrow: string;
  proofTitle: string;
  proofDescription: string;
  proofLinkLabel: string;
  guaranteeBadge: string;
  guaranteeEyebrow: string;
  pricingEyebrow: string;
  pricingTitle: string;
  pricingDescription: string;
  priceLabel: string;
  priceNote: string;
  priceIncludes: string[];
  faqEyebrow: string;
  faqTitle: string;
}

export interface Offer {
  published: boolean;
  slug: string;
  productName: string;
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  subheadline: string;
  metaTitle: string;
  metaDescription: string;
  ogImage: string;
  audience: string;
  checkoutUrl: string;
  checkout?: OfferCheckoutSection;
  heroPreview: OfferHeroPreview;
  sections: OfferSectionCopy;
  demoUrl: string;
  currentPrice: string;
  regularPrice: string;
  priceAmount: number;
  currency: string;
  ctaLabel: string;
  ctaNote: string;
  painTitle: string;
  painBody: string;
  withoutLabel: string;
  withoutTitle: string;
  withLabel: string;
  withTitle: string;
  without: string[];
  with: string[];
  outcomes: OfferItem[];
  video?: OfferVideoSection;
  productPreview?: OfferPreviewSection;
  assistant?: OfferAssistantSection;
  included: OfferItem[];
  gates?: OfferGatesSection;
  fit?: OfferFitSection;
  examples?: OfferExamplesSection;
  bonuses: OfferItem[];
  proof: OfferProof[];
  guaranteeTitle: string;
  guaranteeBody: string;
  faqs: OfferFaq[];
  finalTitle: string;
  finalBody: string;
}

const offerModules = import.meta.glob<{ default: Offer }>('../content/offers/*.json', {
  eager: true,
});

function applyEnvironmentOverrides(offer: Offer): Offer {
  const checkoutUrl = import.meta.env.PUBLIC_CHECKOUT_URL ?? offer.checkoutUrl;
  const checkoutEnabled =
    (import.meta.env.PUBLIC_MANAGED_CHECKOUT_ENABLED ??
      import.meta.env.PUBLIC_DODO_CHECKOUT_ENABLED) !== 'false';

  return {
    ...offer,
    checkoutUrl,
    checkout: offer.checkout
      ? {
          ...offer.checkout,
          enabled: offer.checkout.enabled && checkoutEnabled,
        }
      : undefined,
  };
}

export const offers: Offer[] = Object.values(offerModules)
  .map((module) => applyEnvironmentOverrides(module.default))
  .sort((left, right) => left.slug.localeCompare(right.slug));

export const publishedOffers = offers.filter((offer) => offer.published);

export function getOffer(slug: string): Offer | undefined {
  return offers.find((offer) => offer.slug === slug);
}

export interface FunnelProduct {
  productKey: string;
  name: string;
  priceAmount: number;
  currency: string;
  deliverySubject: string;
  deliveryBody: string;
  accessUrl: string;
}

export interface FunnelBump extends FunnelProduct {
  key: string;
}

export interface FunnelUpsell extends FunnelProduct {
  key: string;
  stepLabel: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  price: string;
  regularPrice: string;
  items: string[];
  acceptLabel: string;
  declineLabel: string;
}

export interface FunnelDefinition {
  offerSlug: string;
  supportEmail: string;
  base: FunnelProduct;
  bump?: FunnelBump;
  upsells: FunnelUpsell[];
  completion: {
    title: string;
    description: string;
    backLabel: string;
  };
}

const modules = import.meta.glob<{ default: FunnelDefinition }>('../content/funnels/*.json', {
  eager: true,
});

export const funnels = Object.values(modules).map((module) => module.default);

export function getFunnel(offerSlug: string): FunnelDefinition | undefined {
  return funnels.find((funnel) => funnel.offerSlug === offerSlug);
}

export const OFFER_TEMPLATES = ['default', 'video-lead'] as const;
export type OfferTemplate = (typeof OFFER_TEMPLATES)[number];

export function resolveOfferTemplate(value?: string): OfferTemplate {
  const template = value ?? 'default';
  if (!OFFER_TEMPLATES.includes(template as OfferTemplate)) {
    throw new Error(`Unknown offer template: ${template}`);
  }
  return template as OfferTemplate;
}

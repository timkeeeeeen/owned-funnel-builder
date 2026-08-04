# Video Lead Funnel Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unpublished Owned Funnel Builder comparison funnel that keeps the current offer copy and checkout while rendering through a new Perspective-inspired `video-lead` template.

**Architecture:** Offer JSON selects a template by a validated string key. The existing dynamic offer route resolves that key through a two-entry Astro component registry; the new component owns only landing-page composition and delegates analytics and checkout to the current shared components. A checkout-funnel alias lets the comparison route reuse the original products without duplicating payment configuration.

**Tech Stack:** Astro 7, TypeScript, Tailwind CSS 4, Keystatic, Node test runner, Playwright quality tooling.

## Global Constraints

- Keep the original `/owned-funnel-builder/` route visually and behaviorally unchanged.
- Keep all buyer-facing copy from the Owned Funnel Builder offer; do not copy Perspective branding, claims, testimonials, media, URL, or provenance.
- Use a plain white canvas, near-black text, bright blue actions, pale-gray bands/cards, one black bonus band, simple Geist typography, and one restrained blue-to-pink media accent.
- Use scoped semantic OKLCH variables; do not change global colors for existing funnels.
- Reuse the shared analytics and checkout components; do not change provider, payment, fulfillment, or publishing behavior.
- Do not touch the pre-existing edits in `astro.config.editor.mjs` or `src/components/offers/OfferCheckoutDialog.astro`.
- Add no dependency and no generic block-renderer or plugin abstraction.

---

### Task 1: Validated Template Selection

**Files:**
- Create: `src/data/offerTemplates.ts`
- Create: `tests/blueprint/offer-templates.test.mts`
- Modify: `src/data/offers.ts`
- Modify: `src/pages/[slug].astro`
- Modify: `keystatic.config.ts`

**Interfaces:**
- Produces: `OfferTemplate = 'default' | 'video-lead'`.
- Produces: `resolveOfferTemplate(value?: string): OfferTemplate`, returning `default` for an absent value and throwing for an unknown value.
- Extends: `Offer.template?: OfferTemplate` and `Offer.checkoutFunnelSlug?: string`.

- [ ] **Step 1: Write the failing resolver test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOfferTemplate } from '../../src/data/offerTemplates.ts';

test('offer templates default safely and reject unknown names', () => {
  assert.equal(resolveOfferTemplate(), 'default');
  assert.equal(resolveOfferTemplate('video-lead'), 'video-lead');
  assert.throws(() => resolveOfferTemplate('missing'), /Unknown offer template: missing/);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: FAIL because `src/data/offerTemplates.ts` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

```ts
export const OFFER_TEMPLATES = ['default', 'video-lead'] as const;
export type OfferTemplate = (typeof OFFER_TEMPLATES)[number];

export function resolveOfferTemplate(value?: string): OfferTemplate {
  const template = value ?? 'default';
  if (!OFFER_TEMPLATES.includes(template as OfferTemplate)) {
    throw new Error(`Unknown offer template: ${template}`);
  }
  return template as OfferTemplate;
}
```

- [ ] **Step 4: Extend the offer type and visual editor**

Add these fields to `Offer`:

```ts
template?: OfferTemplate;
checkoutFunnelSlug?: string;
```

Import `OfferTemplate` from `@/data/offerTemplates`. Add a Keystatic select immediately after `published`:

```ts
template: fields.select({
  label: 'Page template',
  options: [
    { label: 'Default', value: 'default' },
    { label: 'Video lead', value: 'video-lead' },
  ],
  defaultValue: 'default',
}),
```

Add an optional text field immediately after the page slug:

```ts
checkoutFunnelSlug: fields.text({
  label: 'Checkout funnel to reuse',
  description: 'Leave blank to use this page address.',
}),
```

- [ ] **Step 5: Add the explicit Astro template registry**

In `src/pages/[slug].astro`, import `VideoLeadOfferLandingPage`, resolve the key, and select the component:

```astro
import VideoLeadOfferLandingPage from '@/components/offers/templates/VideoLeadOfferLandingPage.astro';
import { resolveOfferTemplate } from '@/data/offerTemplates';

const template = resolveOfferTemplate(offer.template);
const templates = {
  default: OfferLandingPage,
  'video-lead': VideoLeadOfferLandingPage,
};
const LandingPage = templates[template];
```

Render `<LandingPage offer={offer} />` in place of the hardcoded default component. Create a temporary `VideoLeadOfferLandingPage.astro` that delegates to `<OfferLandingPage offer={offer} />` so Task 1 remains buildable.

- [ ] **Step 6: Run the focused test and type check**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: PASS.

Run: `host-test-slot --class focused npm run typecheck`

Expected: no Astro or TypeScript errors.

- [ ] **Step 7: Commit the template selector**

```bash
git add src/data/offerTemplates.ts src/data/offers.ts src/pages/'[slug].astro' src/components/offers/templates/VideoLeadOfferLandingPage.astro keystatic.config.ts tests/blueprint/offer-templates.test.mts
git commit -m "feat: add selectable offer templates"
```

---

### Task 2: Comparison Offer and Shared Checkout Alias

**Files:**
- Create: `src/content/offers/owned-funnel-builder-video-lead.json`
- Modify: `scripts/validate-funnel-config.mjs`
- Modify: `tests/blueprint/offer-templates.test.mts`

**Interfaces:**
- Consumes: `Offer.template` and `Offer.checkoutFunnelSlug` from Task 1.
- Produces: `/owned-funnel-builder-video-lead/`, unpublished, using the original `owned-funnel-builder` checkout definition.

- [ ] **Step 1: Extend the failing test with the comparison contract**

Read both offer JSON files and assert:

```ts
assert.equal(comparison.published, false);
assert.equal(comparison.slug, 'owned-funnel-builder-video-lead');
assert.equal(comparison.template, 'video-lead');
assert.equal(comparison.checkoutFunnelSlug, 'owned-funnel-builder');
assert.equal(comparison.productName, original.productName);
assert.equal(comparison.headline, original.headline);
assert.equal(comparison.subheadline, original.subheadline);
assert.deepEqual(comparison.included, original.included);
assert.deepEqual(comparison.proof, original.proof);
assert.deepEqual(comparison.faqs, original.faqs);
```

- [ ] **Step 2: Run the focused test and verify the missing comparison file failure**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: FAIL because `owned-funnel-builder-video-lead.json` does not exist.

- [ ] **Step 3: Create the comparison offer**

Copy the existing JSON content exactly, changing only these top-level fields:

```json
{
  "published": false,
  "template": "video-lead",
  "checkoutFunnelSlug": "owned-funnel-builder",
  "slug": "owned-funnel-builder-video-lead",
  "checkoutUrl": "/owned-funnel-builder/#checkout"
}
```

Do not create a second funnel JSON or duplicate product keys.

- [ ] **Step 4: Teach validation about the checkout alias**

Where `scripts/validate-funnel-config.mjs` requires a same-slug funnel, resolve:

```js
const checkoutFunnelSlug = offer.checkoutFunnelSlug || offer.slug;
```

Require that `funnels` contains `checkoutFunnelSlug`, and compare the landing-page price against that resolved funnel. Keep all existing checks for ordinary offers unchanged.

- [ ] **Step 5: Run the focused contract and configuration checks**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: PASS.

Run: `host-test-slot --class focused npm run validate:config`

Expected: `Funnel configuration is ready` with four landing pages and the existing unique products.

- [ ] **Step 6: Commit the comparison offer**

```bash
git add src/content/offers/owned-funnel-builder-video-lead.json scripts/validate-funnel-config.mjs tests/blueprint/offer-templates.test.mts
git commit -m "feat: add owned funnel layout comparison"
```

---

### Task 3: Full Video-Lead Landing Page

**Files:**
- Modify: `src/components/offers/templates/VideoLeadOfferLandingPage.astro`
- Modify: `tests/blueprint/offer-templates.test.mts`

**Interfaces:**
- Consumes: `offer: Offer`, `offer.checkoutFunnelSlug`, shared `OfferLayout`, `OfferAnalytics`, and `OfferCheckoutDialog`.
- Produces: the complete white/blue Perspective-inspired page composition.

- [ ] **Step 1: Add a failing source-contract test**

Read `VideoLeadOfferLandingPage.astro` and assert it contains the shared primitives and required section markers:

```ts
assert.match(source, /OfferCheckoutDialog/);
assert.match(source, /OfferAnalytics/);
assert.match(source, /video-lead-theme/);
assert.match(source, /data-video-lead="hero"/);
assert.match(source, /data-video-lead="included"/);
assert.match(source, /data-video-lead="features"/);
assert.match(source, /data-video-lead="proof"/);
assert.match(source, /data-video-lead="bonus"/);
assert.match(source, /data-video-lead="steps"/);
assert.match(source, /data-video-lead="faq"/);
assert.doesNotMatch(source, /strategy\.perspective|160 Qualified Leads|6,000\+ customers/);
```

- [ ] **Step 2: Run the focused test and verify the temporary delegate fails**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: FAIL because the temporary component lacks the new section markers.

- [ ] **Step 3: Replace the delegate with the full layout**

Implement these sections in this exact order:

1. centered hero using `offer.headline`, `offer.headlineAccent`, `offer.subheadline`, `offer.video`, `offer.currentPrice`, `offer.ctaLabel`, and `offer.ctaNote`;
2. quiet highlights row from `offer.sections.highlights`;
3. included/product showcase from `offer.sections.includedTitle`, `offer.productPreview`, and the first four `offer.included` items;
4. centered explanation and two-column feature cards from `offer.outcomes` plus remaining `offer.included` items;
5. proof grid from `offer.proof` and, when present, `offer.examples.items`;
6. repeated CTA;
7. black bonus band from `offer.sections.bonusesTitle` and `offer.bonuses`;
8. three getting-started cards from the first three `offer.heroPreview.steps`;
9. native `<details>` FAQ rows from `offer.faqs`;
10. final CTA and footer support link.

Use one local CTA partial expressed as an Astro function-free fragment pattern: repeat the existing anchor markup where needed rather than adding a component used only here.

Resolve checkout without modifying the shared dialog:

```ts
const checkoutSlug = offer.checkoutFunnelSlug ?? offer.slug;
const checkoutOffer = checkoutSlug === offer.slug ? offer : { ...offer, slug: checkoutSlug };
```

Pass `checkoutOffer` to `OfferCheckoutDialog`, but pass `offer.slug` to `OfferAnalytics` so comparison traffic remains distinguishable.

Scope these semantic colors on `.video-lead-theme`:

```css
.video-lead-theme {
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(19% 0.01 260);
  --color-card: oklch(98% 0.003 260);
  --color-muted: oklch(96.8% 0.003 260);
  --color-muted-foreground: oklch(49% 0.012 260);
  --color-border: oklch(91.5% 0.006 260);
  --color-brand: oklch(62% 0.21 255);
  --color-brand-foreground: oklch(100% 0 0);
}
```

Use an isolated media halo with `background: linear-gradient(135deg, oklch(72% 0.18 250), oklch(75% 0.18 335));`; no other gradient is allowed. Buttons use `rounded-md`, cards use restrained `rounded-xl`, and every control preserves a visible `focus-visible` ring and at least a 44px touch target.

- [ ] **Step 4: Run the focused contract and formatting checks**

Run: `host-test-slot --class focused node --import tsx --test tests/blueprint/offer-templates.test.mts`

Expected: PASS.

Run: `rtk prettier --check src/components/offers/templates/VideoLeadOfferLandingPage.astro src/data/offerTemplates.ts src/data/offers.ts src/pages/'[slug].astro' keystatic.config.ts tests/blueprint/offer-templates.test.mts`

Expected: all matched files use Prettier formatting.

- [ ] **Step 5: Commit the full template**

```bash
git add src/components/offers/templates/VideoLeadOfferLandingPage.astro tests/blueprint/offer-templates.test.mts
git commit -m "feat: build video lead funnel template"
```

---

### Task 4: Build and Browser Verification

**Files:**
- Modify only if a verified defect is found in files introduced by Tasks 1–3.
- Generate: quality screenshots outside source control.

**Interfaces:**
- Consumes: committed branch HEAD from Tasks 1–3.
- Produces: passing build/type checks and visual receipts for original and comparison routes.

- [ ] **Step 1: Run deterministic verification remotely**

Run: `rtk maestro-remote-test -- npm run test:blueprint`

Expected: all blueprint tests pass.

Run: `rtk maestro-remote-test -- npm run typecheck`

Expected: no Astro or TypeScript errors.

Run: `rtk maestro-remote-test -- npm run build`

Expected: production build succeeds and includes both `/owned-funnel-builder/` and `/owned-funnel-builder-video-lead/`.

- [ ] **Step 2: Start a local preview for browser checks**

Run through a focused host slot: `host-test-slot --class focused npm run dev -- --host 127.0.0.1`

Expected: Astro reports a local HTTP URL.

- [ ] **Step 3: Capture and inspect both layouts**

Use Playwright at 375×812, 768×1024, and 1440×1000 for both routes. Capture full-page screenshots and confirm:

- no horizontal overflow;
- the original route remains in its established visual system;
- the comparison route has the approved white/blue/plain-font treatment;
- the hero, included, feature, proof, black bonus, steps, FAQ, and final CTA sections render in order;
- no copied Perspective names, testimonials, or assets appear.

- [ ] **Step 4: Run accessibility and interaction checks**

On the comparison route, run Axe and require zero serious or critical findings. Tab through links and native FAQ disclosures, confirm visible focus, open the shared checkout dialog from the hero CTA, close it with Escape, and do not submit payment.

- [ ] **Step 5: Verify the final diff**

Run: `rtk git diff --check`

Expected: no whitespace errors.

Run: `rtk git status --short`

Expected: only the two pre-existing user edits remain outside committed feature work.

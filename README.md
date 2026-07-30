# Maestro Offers

Reusable, conversion-focused landing pages for low-ticket Maestro products. The site is built on [AstroDeck](https://github.com/holger1411/astrodeck) with Astro 7 and Tailwind CSS 4, then reduced to a focused offer-page system.

The first offer is available at:

```text
/vibe-code-anything/
```

## Start locally

```bash
npm install
npm run dev
```

## Create another offer

Create a safe draft in one command:

```bash
npm run offer:new -- my-offer "My Product" "Get The Outcome"
```

Then:

1. Open the generated JSON file in `src/data/offers/`.
2. Replace the scaffold copy, offer stack, proof, price, guarantee, FAQ, and checkout URL.
3. Add the social card to `public/` and set `ogImage` to its public path.
4. Preview it locally at the generated slug.
5. Set `published` to `true` only when it is ready for a production build.

The dynamic route in `src/pages/[slug].astro` discovers the JSON and generates the landing page automatically. Shared layout, attribution forwarding, legal links, repeated CTAs, responsive behavior, and structured data stay consistent across every offer.

## Checkout setup

The first offer reads `PUBLIC_VIBE_CODE_CHECKOUT_URL`. When it is missing, the CTA opens an email to `tim@keen.digital` so no button is dead during review.

Before paid traffic starts, set the real Stripe, ThriveCart, or other checkout URL:

```bash
PUBLIC_VIBE_CODE_CHECKOUT_URL=https://your-checkout.example/offer
```

HTTP checkout links automatically inherit these campaign parameters from the landing-page URL:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `gclid`
- `fbclid`

Every CTA also dispatches an `offer:cta-click` browser event with the offer slug and placement, ready for an analytics adapter without coupling the site to a specific vendor.

## Quality checks

```bash
npm run check:kpis
npm run lint
npm run format:check
npm run typecheck
npm run build
```

## Deploy to Cloudflare Pages

The production project is `maestro-offers`, with `main` as its production branch. Deploy the current source with:

```bash
npm run deploy
```

The live Pages URL is:

```text
https://maestro-offers.pages.dev/
```

## Important launch checks

- Replace the email fallback with a real checkout URL.
- Confirm price, delivery, refund promise, and license language.
- Connect the intended custom domain and update `PUBLIC_SITE_URL` when moving beyond the Pages domain.
- Add only the ad pixels and analytics tools you actually plan to use, then update the privacy page and consent behavior as required.

## Foundation credit

This project retains AstroDeck's MIT license and AI-friendly project conventions. See `LICENSE` and `AGENTS.md`.

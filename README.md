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
2. Replace the scaffold copy, optional conversion sections, proof, price, guarantee, FAQ, and checkout fallback URL.
3. Add the social card to `public/` and set `ogImage` to its public path.
4. Preview it locally at the generated slug.
5. Set `published` to `true` only when it is ready for a production build.

The dynamic route in `src/pages/[slug].astro` discovers the JSON and generates the landing page automatically. Shared layout, email-first Dodo checkout, attribution capture, legal links, repeated CTAs, responsive behavior, and structured data stay consistent across every offer.

## Dodo inline checkout

The inline flow is deliberately email-first:

1. A CTA opens the checkout dialog and asks for an email.
2. The Pages Function records consent and campaign attribution in D1.
3. The server creates a fresh, single-use Dodo checkout session with the email prefilled.
4. Dodo's complete secure frame opens inline without exposing the API key or card data to this site.

The lead ledger is the Cloudflare D1 database `maestro-offer-leads`. Apply migrations with:

```bash
npx wrangler d1 migrations apply maestro-offer-leads --remote
```

Set these Pages secrets interactively; never commit their values:

```bash
npx wrangler pages secret put DODO_PAYMENTS_API_KEY --project-name maestro-offers
npx wrangler pages secret put DODO_PAYMENTS_ENVIRONMENT --project-name maestro-offers
npx wrangler pages secret put DODO_PRODUCT_VIBE_CODE_ANYTHING --project-name maestro-offers
```

Use `live_mode` or `test_mode` for `DODO_PAYMENTS_ENVIRONMENT`. Each new offer maps its slug to a predictable secret named `DODO_PRODUCT_<UPPERCASE_SLUG>`, with hyphens converted to underscores.

Keep inline checkout disabled while reviewing copy. Enable it only for a build whose Dodo configuration has been tested:

```bash
PUBLIC_VIBE_CODE_DODO_CHECKOUT_ENABLED=true npm run build
```

Until then, `PUBLIC_VIBE_CODE_CHECKOUT_URL` remains the safe CTA fallback. Dodo's dashboard can also enable its native abandoned-cart recovery sequence after the live product exists.

The lead record captures these campaign parameters:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `gclid`
- `fbclid`
- `ttclid`
- `msclkid`

Every CTA dispatches `offer:cta-click`. Successful session creation dispatches `offer:checkout-session-created`, and Dodo frame events dispatch `offer:checkout-event`, ready for an analytics adapter without coupling the site to a specific vendor.

Export consented checkout leads from D1 with a focused query, then reconcile converted buyers before building a reminder or ad audience:

```bash
npx wrangler d1 execute maestro-offer-leads --remote --command "SELECT email, offer_slug, attribution_json, created_at FROM checkout_leads WHERE marketing_consent = 1 AND status IN ('captured', 'session_created') ORDER BY created_at DESC"
```

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

- Configure and verify the live Dodo product, API key, return URL, delivery email, and abandoned-cart settings.
- Confirm price, delivery, refund promise, and license language.
- Connect the intended custom domain and update `PUBLIC_SITE_URL` when moving beyond the Pages domain.
- Add only the ad pixels and analytics tools you actually plan to use, then update the privacy page and consent behavior as required.

## Foundation credit

This project retains AstroDeck's MIT license and AI-friendly project conventions. See `LICENSE` and `AGENTS.md`.

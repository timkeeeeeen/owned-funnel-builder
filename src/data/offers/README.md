# Additional offers

JSON files in this directory are discovered automatically. Create a safe draft with:

```bash
npm run offer:new -- my-offer "My Product" "Get The Outcome"
```

The final headline word is highlighted. New offers start with `"published": false`, so they are available in local development but excluded from production builds.

Every draft includes reusable blocks for:

- a video or honest pre-video fallback;
- an inspectable product preview;
- skills plus a sample assistant conversation;
- the complete included stack;
- plain-English quality gates;
- qualified and disqualified buyers;
- honest example outcomes;
- email-first Dodo inline checkout.

Delete an optional block when it does not help that offer. Otherwise replace every scaffold example, then confirm the price, proof, guarantee, fallback checkout URL, demo URL, and social image before setting `published` to `true`.

Dodo checkout starts with `"enabled": false`. Create the live product, add its Pages secret as `DODO_PRODUCT_<UPPERCASE_SLUG>` with hyphens changed to underscores, verify the full payment and delivery path, then enable the block. The API key and Dodo environment stay in Cloudflare Pages secrets; never put them in the JSON.

The first `vibe-code-anything` offer remains in `src/data/offers.ts` because its fallback checkout URL and Dodo enable flag can be supplied through public build variables.

# Additional offers

JSON files in this directory are discovered automatically. Create a safe draft with:

```bash
npm run offer:new -- my-offer "My Product" "Get The Outcome"
```

The final headline word is highlighted. New offers start with `"published": false`, so they are available in local development but excluded from production builds. After replacing the scaffold copy, price, proof, guarantee, checkout URL, and social image, set `published` to `true`.

The first `vibe-code-anything` offer remains in `src/data/offers.ts` because its checkout URL can be supplied through a public environment variable.

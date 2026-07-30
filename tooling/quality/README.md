# Funnel quality evidence

This folder checks the actual built site in a real browser. It is designed for an agent to run on behalf of someone who does not use a terminal.

## What it proves

- Every configured page loads on desktop, tablet, and mobile.
- First-fold and full-page screenshots belong to the exact current build.
- Pages do not scroll sideways or emit browser, page, or resource errors.
- Serious and critical Axe accessibility findings are absent.
- The main action goes to the expected internal or external destination, or safely opens a checkout surface.
- Old screenshots fail verification after relevant HTML, CSS, JavaScript, images, fonts, route configuration, or CTA expectations change.

## Configuration

Add `quality.config.json` at the repository root. If `routes` is omitted, every built HTML route except `404.html` is discovered automatically.

```json
{
  "$schema": "./tooling/quality/quality-config.schema.json",
  "distDirectory": "dist/client",
  "evidenceDirectory": "quality-evidence",
  "excludeRoutes": ["/privacy", "/terms"],
  "routes": [
    {
      "route": "/my-offer",
      "primaryCta": {
        "kind": "checkout",
        "selector": "[data-primary-cta]",
        "activate": true,
        "readySelector": "[data-checkout-dialog][open]"
      }
    },
    {
      "route": "/thank-you",
      "profiles": ["desktop", "mobile"],
      "captures": ["first-fold", "full-page"]
    }
  ]
}
```

CTA kinds:

- `internal`: an ordinary link on the same site. `expectedDestination` may be a route such as `/next-step`.
- `external`: an off-site link. Use `expectedDestination` for one exact URL or `allowedOrigins` for approved providers.
- `checkout`: a button or link marked with `data-checkout-trigger`, `data-checkout-url`, `data-dodo-checkout`, or `data-offer-checkout-trigger`. Set `activate` to safely prove the checkout dialog appears; this never submits payment.

Use `ignoreResourcePatterns` only for a known optional third-party request. Each value is treated as a regular expression, with plain-text matching as a fallback.

## Commands the root package should expose

```json
{
  "scripts": {
    "quality:discover": "tsx tooling/quality/cli.mts discover",
    "quality:smoke": "tsx tooling/quality/cli.mts smoke",
    "quality:capture": "tsx tooling/quality/cli.mts capture",
    "quality:verify": "tsx tooling/quality/cli.mts verify",
    "test:quality": "node --import tsx --test tests/quality/*.test.mts"
  }
}
```

Required development packages are `playwright`, `@axe-core/playwright`, and `tsx`. Install Chromium once with `npx playwright install chromium`.


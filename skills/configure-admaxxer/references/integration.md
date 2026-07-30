# Admaxxer integration contract

## Canonical sources

- Documentation index: `https://admaxxer.com/llms.txt`
- Astro installation: `https://admaxxer.com/documentation/install/astro`
- Dodo revenue connector: `https://admaxxer.com/documentation/revenue/dodo`
- SaaS and custom events: `https://admaxxer.com/documentation/saas-analytics`
- Consent API: `https://admaxxer.com/documentation/consent-api`
- First-party CNAME: `https://admaxxer.com/documentation/first-party-cname`

Fetch these again during setup because provider contracts can change.

## Browser contract

The supported global is:

```js
window.admaxxer('Lead', { offer_slug: 'example-offer' });
window.admaxxer.identify('buyer@example.com');
window.admaxxer.getVisitorId();
```

Load the standard pixel once per page layout. Prefer explicit Lead instrumentation over automatic form tracking when the checkout flow needs a precise success boundary.

## Dodo contract

Every server-created base, bump, or upsell payment must inherit:

```js
metadata: {
  admx_visitor_id: visitorId,
}
```

Admaxxer reads this field from the signed Dodo payment webhook. The Dodo connector token should be restricted to the minimum read scopes required by current documentation. Store the webhook signing secret only in Admaxxer and Dodo's secret surfaces.

## Verification checklist

- The exact production HTML contains one pixel script with the correct website ID and domain.
- A production visit appears as a page view for the correct Admaxxer website.
- A failed email or checkout request produces no Lead.
- A successful checkout-session creation identifies the email and produces exactly one Lead.
- Dodo checkout metadata contains a non-empty `admx_visitor_id`.
- Base payment, bump, and both upsells retain the same visitor ID.
- Dodo sends a signed `payment.succeeded` event to Admaxxer.
- Admaxxer shows the order with the visitor, source, and connector `dodo`.
- Meta receives the server-side Purchase and any browser counterpart is deduplicated.
- Test payments do not contaminate production reporting.

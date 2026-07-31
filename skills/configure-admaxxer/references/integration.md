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

## Payment provider and Payments API contract

Every server-created Dodo or Stripe base, bump, or upsell payment must inherit:

```js
metadata: {
  admx_visitor_id: visitorId,
}
```

The funnel must verify the selected provider's signature before trusting the payment. After fulfillment, its server sends the successful payment to:

```text
POST https://admaxxer.com/api/v1/payments
Authorization: Bearer <workspace API key>
```

The JSON body uses the Dodo `payment_id` or Stripe PaymentIntent ID as `transaction_id`, converts the provider amount from the currency's smallest unit, and includes `admaxxer_visitor_id` and customer email when available. The transaction ID makes retries idempotent. Keep the Admaxxer API key in a private Cloudflare secret, never in public Astro variables or browser code.

## Verification checklist

- The exact production HTML contains one pixel script with the correct website ID and domain.
- A production visit appears as a page view for the correct Admaxxer website.
- A failed email or checkout request produces no Lead.
- A successful checkout-session creation identifies the email and produces exactly one Lead.
- Provider payment metadata contains a non-empty `admx_visitor_id`.
- Base payment, bump, and both upsells retain the same visitor ID.
- The selected provider sends a signed payment-success event to the funnel's webhook.
- The verified webhook sends one payment to Admaxxer's Payments API.
- Admaxxer shows the order with the correct visitor or email match and source.
- Meta receives the server-side Purchase and any browser counterpart is deduplicated.
- Test payments do not contaminate production reporting.

# Cloudflare release evidence

## Before mutation

- Clean or understood Git status.
- Exact commit recorded and available on the intended GitHub remote.
- Build and audit pass from that commit.
- Existing Pages, D1, bindings, domains, and production deployment inspected.
- Required secret names known without exposing values.

## Provisioning order

1. Authenticate or request browser approval.
2. Resolve the account and exact targets.
3. Create or reuse D1 and apply migrations.
4. Configure Pages bindings and non-secret environment values.
5. Store secrets through the provider secret mechanism.
6. Deploy preview and verify.
7. Deploy production and verify the stable URL.
8. Attach and verify a custom domain if requested.

## Live verification

- Confirm the stable URL returns the intended offer and commit.
- Confirm all landing, upsell, completion, editor, and API routes required by the release.
- Confirm assets load, Functions respond, and no fallback email CTA replaced checkout.
- Confirm secrets are present by name only.
- Use no-charge checkout verification unless the user explicitly authorizes a real purchase.

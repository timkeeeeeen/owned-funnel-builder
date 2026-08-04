# Blueprint Paid-Traffic Evidence

Status: implementation-ready in source; runtime and provider gates remain open.

## Reviewed source

- Owned acquisition/runtime branch: `codex/owned-funnel-launch`
- Maestro Blueprint branch: `codex/blueprint-funnel-launch`
- Maestro implementation commit: `865f25917d` (latest reviewed Blueprint
  branch; Woodpecker re-verification still required)
- Public family: Authority Snapshot for agency owners, consultants, coaches,
  and solo experts → `$5 USD` CMO Game Plan.
- Optional `$99/month` Blueprint Activation remains disabled and out of scope.

## Local and remote verification

| Check | Result | Evidence |
| --- | --- | --- |
| Acquisition visitor validation and checkout metadata | passed | focused Blueprint contract tests |
| Admaxxer Purchase adapter and retry behavior | passed | focused Blueprint adapter/webhook tests |
| Verified Dodo webhook route and business idempotency | passed | 38 focused tests on `8741af7a23` |
| Maestro Convex typecheck | reported passed | remote worker verification; rerun on the exact accepted SHA before promotion |
| Staging runtime, Convex deployment, and workflow-output smoke | blocked | deployed runtime is fail-closed until `PUBLIC_BLUEPRINT_FUNNEL_ENABLED`, Maestro Convex/app URLs, and Turnstile site key are bound |
| Live `$5` Dodo product and webhook readback | unverified | requires Dodo access and account approval |
| Temporary live `$1` Game Plan canary | unverified | requires owner approval and card entry |
| Admaxxer website/CAPI and Meta event trace | unverified | requires Admaxxer key and owner CAPI connection |
| Production promotion and rollback | blocked | requires the guarded staging acceptance and exact accepted SHA |

## Required live canary evidence

Create one non-public live `$1 USD` Game Plan product with trusted
`launch_canary=true` metadata. After owner-approved card entry, prove the saved
Snapshot Lead, cross-domain visitor handoff, signed payment, product binding,
claim, plan, five retained drafts, export, revision, CMO continuation,
Admaxxer/Meta Purchase, refund, and revocation. Restore the `$5` mapping and
deactivate the canary before production promotion. Do not test `$99` Activation.

## Owner/provider gates

1. Configure isolated staging and production Convex, Cloudflare, Dodo,
   Admaxxer, Meta CAPI, Turnstile, email, and model bindings.
2. Read back the live `$5` product, webhook event set, return URL, support, and
   refund authority without exposing secrets.
3. Approve the `$1` identity, charge, card-entry moment, and immediate refund.
4. Record exact staging-accepted and production SHAs plus rollback IDs.

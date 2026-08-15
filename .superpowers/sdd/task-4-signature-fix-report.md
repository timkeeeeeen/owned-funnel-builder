# Task 4 signature fix

## Root cause

`functions/api/webhooks/dodo.ts` checked the timestamp before invoking Dodo's
signature verifier, so an invalid signature with the test timestamp was
returned as `400` rather than `401`. Dodo's verifier performs its own
too-old/too-new checks, so those verified timestamp failures remain `400`;
all other verification failures return `401`.

## Commands and results

1. `rtk host-test-slot --class focused node --import tsx --test tests/functions/payment.test.mts tests/functions/browser-events.test.mts tests/functions/source-outbox.test.mts`
   - Before fix: 49 passed, 1 failed (`400 !== 401` at `payment.test.mts:1319`).
   - After fix: 50 passed, 0 failed.
2. `rtk pnpm check:functions`
   - Passed (exit code 0).
3. `rtk pnpm format:check`
   - Passed (exit code 0).
4. `rtk git diff --check`
   - Passed (exit code 0).

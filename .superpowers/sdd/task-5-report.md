# Task 5 Implementer Report

Status: DONE_WITH_CONCERNS

## Scope completed

- Reconciled the existing Task 5 browser consent/tracker changes without modifying the unrelated dirty Task 3/6 privacy and Worker files.
- Bound the shared browser tracker to the two-phase bootstrap response, one-time CSRF nonce header, signed tracking-context hash, and policy version.
- Kept browser PageView delivery on credentialed `fetch` with `keepalive`, removed browser-created session identity and `sendBeacon`, and excluded URL fragments.
- Persisted banner choices through the Worker privacy endpoint before updating the local UI cache.
- Added the Task 5 nonce-binding migration.

## Focused verification

1. `rtk host-test-slot --class focused pnpm test:blueprint`
   - Acquired the focused slot, but the `pnpm` process never launched the Node test child.
   - Failed after approximately 288 seconds at the 4 GB heap limit with `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.
2. `rtk host-test-slot --class focused node --import tsx --test tests/blueprint/*.test.mts`
   - PASS: 14 tests, 0 failures, 384.855459 ms.
3. `rtk host-test-slot --class focused node --import tsx --test tests/functions/blueprint-proxy.test.mts`
   - PASS: 3 tests, 0 failures, 345.551125 ms.
4. `rtk host-test-slot --class focused node --import tsx --test tests/functions/browser-events.test.mts`
   - PASS: 3 tests, 0 failures, 313.353584 ms.
5. `rtk host-test-slot --class focused node --import tsx --test tests/tracking/browser-contract.test.mts`
   - PASS: 4 tests, 0 failures, 249.689334 ms.
6. Fresh exact `pnpm test:blueprint` retry through `host-test-slot`
   - Interrupted before acquisition after host load remained above the required threshold; the direct equivalent above is green.
7. `rtk pnpm check:functions`
   - Interrupted after reproducing the package-manager no-output scan behavior.
8. `rtk ./node_modules/.bin/wrangler pages functions build functions --outdir .wrangler/functions-build --project-directory . --build-output-directory dist/client`
   - PASS: Wrangler 4.115.0, `Compiled Worker successfully`.
9. Playwright preview contract
   - Not run: no `playwright.config.*`, `preview-browser.spec.mts`, or repository browser-spec harness/host fixture exists.

## Concerns

- The required `pnpm` wrapper command is not reliable on this host in this worktree: one acquired run exhausted the Node heap before tests launched, while the exact underlying test command passed. This is tooling/environment evidence, not a failing Task 5 assertion.
- Task 6 owns atomic nonce consumption and the authoritative privacy/bootstrap Worker behavior. Its dirty files were preserved and intentionally excluded from this Task 5 commit.
- Task 8 still owns the source-runtime bridge/outbox completion behind the Blueprint proxy shells; Task 5 does not claim that end-to-end source path is live.

## Review remediation

Status: DONE

- Replaced two concurrent per-purpose consent writes with one versioned action carrying both decisions and a unique `choice_id`.
- Made nonce consumption, policy/context/action binding, and both immutable purpose-ledger inserts one atomic SQLite statement via the nonce update trigger. Reuse returns 409.
- Made bootstrap effective purposes the browser's only consent authority. Local storage now only prefills UI; stale policy and GPC remain fail closed.
- Deferred PageView dedupe until signed bootstrap context validation and retained one candidate event ID for consent replay, Pixel, and collector parity.
- Invalid collector configuration falls back to the owned HTTPS `/v1/events` endpoint.
- Blueprint proxy shells/tests remain in Task 5; Task 8 owns their authoritative source-runtime bridge/outbox implementation.

### Review verification

- RED: browser contract 3/4; collector 15/17 with the expected authority/action failures.
- GREEN: browser contract 4/4 (605.955667 ms); collector 17/17 (final 731.400708 ms).
- GREEN: tracking privacy 6/6 (543.514 ms); Blueprint direct equivalent 14/14 (308.244333 ms); browser events 3/3 (313.040541 ms); Blueprint proxy 3/3 (308.662375 ms).
- GREEN: focused Prettier check; Pages Functions compiled; Events Worker dry-run bundled successfully (one expected warning because no deploy environment was selected).
- The earlier exact `pnpm test:blueprint` 4 GB package-manager OOM remains environmental evidence; its exact underlying Node suite passed 14/14 through `host-test-slot`.

## Final signer remediation

Status: DONE

- Replaced the privacy grant's test-only signer requirement with a production WebCrypto HMAC-SHA-256 fallback using `TRACKING_CONTEXT_SIGNING_KEY_CURRENT` and the configured current key ID. The optional injected signer remains available to isolated tests.
- The Worker now emits a five-minute `v1.<key-id>.<payload>.<signature>` context token bound to tenant, site, funnel, subject, deletion state, and policy version. Browser validation accepts this exact versioned shape while preserving the legacy verifier seam.
- Wrangler config commits only the non-secret preview/live key IDs and names the current/previous secret bindings in comments. No secret value is committed.
- Production-shaped grant coverage passes with only the real secret/key-ID bindings. Removing the current secret returns the fail-closed 503 instead of minting an unsigned context.
- Task 6 remains responsible for provisioning `TRACKING_CONTEXT_SIGNING_KEY_CURRENT` in preview/live and the previous-key rotation binding before deployment. With that runtime dependency provisioned, the production-shaped grant path no longer remains on the 503 test-only callback branch.

### Final signer verification

- RED: Worker collector 12/18, with the production-shaped privacy grant returning 503 instead of 202 and downstream PageViews failing without the removed fixture.
- GREEN: Worker collector 18/18; browser contract 4/4; tracking privacy 6/6; Blueprint direct equivalent 14/14; browser events 3/3; Blueprint proxy 3/3.
- GREEN: focused Prettier check, Pages Functions compilation, Events Worker preview and production dry-runs, and `git diff --check`. The production dry-run retained Wrangler's pre-existing warning about unrelated non-inherited vars.

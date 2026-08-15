# Authority Snapshot progress reconciliation

Date: 2026-08-15

## Decision

Recover the still-valuable receipt-driven progress experience from frozen candidate
`9bd0460206562f10a04feca60f44376594d212fb` onto exact reviewed main
`2a5f9318a92fe6ac3c798ddfd536af93a9be1032`.

Main remains authoritative. The reconciliation starts from main and ports only the
progress behavior; it does not merge or rebase the preserved branch.

## Scope

Keep:

- strict parsing of the existing redacted persisted progress projection;
- seven milestones whose state advances only from their own receipts;
- monotonic reconciliation across sparse polling responses;
- a hidden-by-default, semantic progress panel for valid saved sessions;
- elapsed, stalled, failed, completed, restart, and reload behavior;
- hidden Snapshot results until a durable result parses successfully.

Exclude:

- the candidate's Turnstile testing bypass and direct checkout transport;
- unrelated Snapshot page rewrites or speculative backend work;
- changes to tracking, video-lead, market-plan, payment, deployment, campaign,
  traffic, or provider-credential behavior;
- percentages, estimated completion times, model thoughts, raw source content,
  or inferred milestones.

## Architecture and data flow

`src/scripts/blueprint-progress.ts` owns the small pure model: validate the public
projection, merge receipts without regression, derive exact-receipt step states,
and evaluate the server-provided stall threshold.

`SnapshotThankYouPage.astro` owns accessible hidden markup only. The existing
`blueprint-funnel-client.ts` watcher remains the runtime authority: after restoring
a valid saved session, each successful watch response is parsed and reconciled.
Invalid progress is ignored. Completion still requires the existing durable result
parser, and checkout continues through main's tracking-aware proxy flow.

The browser writes status text with `textContent`, keeps one polite live region,
does not expose preview payloads, and reveals restart behavior on failed or expired
sessions. Direct visits do not reveal the progress panel or start work.

## Integration rule

Preserve main's `trackingContextToken`, candidate-event, proxy checkout, video-lead,
and market-plan behavior exactly. Only the progress imports, watcher callback, UI
reconciliation, and focused contract assertions may touch the two overlapping
files from the true merge base `6387353810a13de956401a1c8fab373777ed6b8d`.

## Error handling

- Malformed recognized receipts reject that projection without erasing prior state.
- Unknown future event keys are ignored.
- Sparse or older responses cannot regress reached milestones, counts, or activity.
- Failed and expired sessions expose the existing restart path.
- Network/watch failures use the existing reload guidance.
- No progress response can synthesize result content or unlock checkout.

## Verification

Run the focused Blueprint suite, focused formatting and lint, tracking proxy/contract
tests affected by the shared client, and the repository typecheck/build/functions
gate once on the frozen delivery head. Perform one deterministic browser review at
mobile and desktop widths covering receipt-only advancement, sparse responses,
stall/failure/completion transitions, reload, hidden synthetic results, overflow,
reduced motion, and serious/critical Axe findings.

Open one normal PR only after the diff proves the newer main behavior remains
present and all relevant checks pass. Merge only if the PR is independently green
and reviewed. Do not deploy production.

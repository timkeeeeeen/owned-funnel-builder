# Authority Snapshot and CMO Game Plan product acceptance

Date: 2026-07-31  
Status: acceptance preview; submission, checkout, and Activation are disabled.

This document keeps the sales promise, product surface, test, and evidence in one place. A page claim may move to `READY` only when its current implementation and a safe end-to-end run both satisfy the same contract.

## Acquisition journeys

```text
Paid ad -> Free Authority Snapshot -> Thank-you bridge -> $5 CMO Game Plan
Paid ad -----------------------------------------------> $5 CMO Game Plan
                                                             |
                                                             v
                                               Optional Blueprint Activation
```

All audience variants use the one `cmo-game-plan` product key. Agency-owner, consultant, coach, and solo-expert pages may change language and synthetic examples, but not price, scoring, output, ownership, or fulfillment.

## Two scoring instruments

The free and paid scores answer different questions and are never added together:

- **Visible Authority Score, /40:** what a buyer can observe across Profile Visibility and Content Visibility. Its eight public criteria cover buyer, promise, visible proof, next action, recent consistency, point of view, writing evidence, and a commercial next-step connection.
- **Authority System Score, /100:** what the complete operating system reveals across Profile, Content, Outreach, Lead capture, and Proof. It has four criteria per dimension and requires complete evidence for all twenty before showing a total.

The paid reveal preserves the earlier `/40` beside the `/100` for context. Unknown, skipped, or unavailable evidence is unassessed, not zero. An explicit “none” or “not tracked” answer can be complete evidence for a low score.

## Promise-to-evidence matrix

| Promise | Page demonstration | Required product acceptance test | Evidence as of 2026-07-31 | Launch status |
|---|---|---|---|---|
| Free result uses public LinkedIn evidence | Snapshot scorecard cites profile and recent-content sources | Normalize and allowlist LinkedIn URLs; handle private, missing, redirected, and rate-limited profiles; prohibit arbitrary fetches | The local funnel bridge now calls Maestro's existing `v2` public Snapshot start and watch authorities; the page remains inert until the exact endpoint, Turnstile, ready contract, and live flag are configured. No current deployed canary proves retrieval | `BLOCKED-E2E` |
| Free score is its own public `/40` instrument | Two public dimensions are scored; three system areas are visibly unassessed; copy says the `/40` is not part of the paid `/100` | Eight public criteria and exact `/40` math; unavailable public evidence remains unassessed; no arithmetic carry-over into the paid score | Corrected rubric and non-additivity tests exist on the page side; no safe current-version live result yet | `PAGE-ONLY` |
| Up to three findings cite visible evidence | Synthetic finding sits beside its source observation | Every finding has a source pointer and no unsupported inference; zero-to-three findings is a valid state | Maestro unit-contract coverage exists from the audit, but live staging is stale | `UNPROVEN-E2E` |
| Free draft does not invent private proof | Draft is labeled `Strong starter` and retains source questions | No invented clients, metrics, quotes, stories, or permission; `Ready` requires complete evidence | Page contract exists; actual current output still needs human scoring | `UNPROVEN-E2E` |
| Saved free result can be resumed | Page copy explains the required recovery boundary, but makes no live claim | Durable result, opaque hashed resume token, recovery email, expiry and deletion policy, no PII in URL | Maestro owns the durable run, hashed tokens, delivery, and immutable claim package. The funnel now includes the exact `/blueprint/asset` email destination, removes delivery and claim tokens from the visible URL immediately after capture, reads the canonical saved result, and permits an active email claim token to continue into the same checkout cross-device. Deployment, expiry, deletion, and a real cross-device canary remain unproven | `BLOCKED-E2E` |
| $5 is one shared paid product across both journeys | Direct page and thank-you bridge expose the same product key | Both placements persist audience, journey, UTMs, click IDs, and resolve one Dodo product at exactly $5 | The existing provider-neutral purchase, Dodo checkout, receipt, claim, and package path is reused. Maestro preserves the closed audience, entry, opaque journey ID, UTMs, and click IDs on the canonical Snapshot run. Both acquisition journeys and the email-recovery asset call the same checkout start/status authorities; the configured `/blueprint/checkout/return` route now hands the opaque token to Maestro through a fragment and never calls the funnel repo's generic `/api/checkout`. No deployment or test-mode purchase has run | `BLOCKED-E2E` |
| Paid score is a separate `/100` system instrument | Five-dimension rubric, 0-5 maturity scale, completion rules, and preserved public `/40` are visible without implying addition | Five chapter answers bind four canonical criteria each; kickoff binds none; replay cannot advance; evidence/missing-data rules, exact 20-criterion math, challenge/re-score behavior, and no total until all criteria are complete | Focused Maestro tests prove the first chapter contains four policy-owned prompts, kickoff stores zero verdicts, each answer stores one dimension's four criterion verdicts, replay is idempotent, and five answers produce exactly twenty. Current deployed and human-reviewed canary evidence is still absent | `LOCAL-PASS-E2E-BLOCKED` |
| Buyer gets three ranked priorities | Synthetic example shows exactly three ranked moves tied to one objective | Priorities trace to evidence and bottleneck; generic tip lists fail evaluation | The canonical month direction now carries the evaluated buyer reason, each actionable criterion's evidence-backed current-state reason and next move, plus the stored acquisition segment as a labeled fallback hint. Real output still needs human evaluation | `LOCAL-PASS-E2E-BLOCKED` |
| Buyer gets a four-week, 20-slot month | Every sample slot shows job, buyer, source, and reason | Exactly 20 unique slots; every field is specific or visibly unresolved; no duplicated filler | The authenticated Maestro read model now exposes each canonical weekly slot with its goal, buyer, CTA, source needs, readiness, and generation state as soon as the plan materializes. Real all-audience output still needs human evaluation | `UNPROVEN-E2E` |
| Buyer gets first five retained drafts | Both paths now state the continuity contract: the Snapshot becomes Post 1 and the Game Plan adds four | Exactly five retained artifacts; claim checks; voice match; source questions; read/copy/edit/export | Local Maestro tests prove one imported post plus exactly four generation calls, replay safety, blocked-outcome rejection, no overwrite of another generated post, partial draft progress, and visible reviewer questions. The reviewer now receives the same frozen source pack and exact citation handles as the writer. The historical r60 quality evidence still fails the quality bar and must be superseded by a current canary | `FAILS-QUALITY-BAR` |
| Same CMO session can repair affected drafts | Working Session section defines context retention and dependency-scoped repair | Durable session; add proof; regenerate dependent drafts only; unrelated drafts remain byte-stable where expected | Local exact-lineage routing tests prove addressed-gap/accepted-turn/slot-gap isolation, unmatched-evidence exclusion, and zero changed packs on replay. No current deployed call-repair canary exists | `BLOCKED-E2E` |
| Nothing is auto-published | Every CTA note states no automatic publishing | Generation runtime has no publishing capability; explicit negative capability test passes | The paid first-week composition test proves its complete query, mutation, and workflow reference set contains no publishing, scheduling, or LinkedIn capability | `LOCAL-PASS` |
| Buyer keeps paid artifacts without Activation | Ownership panel lists resume, read, copy, light edit, and export; shared commercial terms define retained access and deletion requests | Decline/cancel Activation; paid artifacts remain authorized and durable | Page, Terms, and Privacy now render one shared retained-access policy; not yet proven end to end | `PAGE-ONLY` |
| Optional Activation is $99/month with a $5 first-invoice credit | Downstream card shows exact scope and a red disabled state | Subscription creation, credit, renewal, cancellation, failed payment, refund, revocation, scope, capacity, and access tests | Current funnel Dodo setup is one-time-product oriented; Activation is informational | `BLOCKED` |
| Earlier experience is not represented as product results | Credentials and quotes are labeled as earlier-program proof with an adjacent disclaimer | Source record, exact quote, name/company permission, paid-ad permission, material-connection and typical-results review | User supplied candidate proof; permissions and underlying records are not yet verified | `BLOCKED-FOR-ADS` |

The preview now uses one shared commercial-terms contract across the direct page, thank-you upsell, Terms, and Privacy: immediate post-claim audit access; progressive score, plan, and draft delivery; one resumable evidence-repair Working Session; two-business-day support target; a seven-day access/failed-fulfillment refund window; and retained/exportable paid artifacts without Activation. These terms remain subject to business approval and live fulfillment proof before `acceptance-preview` can be removed.

## Current product verdict

**Not ready for paid traffic.** The canonical Maestro workflow is real, durable, and capable of producing the full artifact set, but the current evidence does not yet support the page’s five-useful-drafts promise without operator or Working Session repair.

The strongest current canary, `r60`, completed twenty canonical posts in 25.4 minutes at a recorded successful-call cost of `$2.12150`. All twenty were labeled `strong_starter`; six were visibly weak, 68 completion questions remained, and the final series verdict was still `repair`. Average scores were 46.85 source fidelity, 57.10 speaker intent, 62.15 hook strength, 65.35 audience relevance, 58.85 voice fit, 54.45 insight density, and 53.65 platform readiness. The narrower `r63` retry proved template recovery, but still retained an unsupported “9 out of 10,” a missing turning-point story, an unclear CTA offer, and three author questions.

A local Maestro correction now:

- gives the free and paid instruments distinct policy identities;
- preserves the frozen `/40` beside the paid result;
- labels the paid result `Authority System Score` instead of `Visible Authority Score`;
- exposes `Ready` versus `Strong starter` on each retained draft; and
- refuses to project a blocked draft as one of the completed first five;
- adopts the imported Snapshot as slot one and generates exactly four additional first-week posts; and
- routes Working Session evidence only to source packs sharing the exact addressed gap and accepted transcript turn, returning only packs that actually changed.
- passes the same frozen source pack and exact citation handles from the writer into the existing post reviewer, then preserves the reviewer outcome and exact completion questions instead of accidentally projecting a `strong_starter` as `ready`;
- exposes canonical weekly slots before included-draft generation finishes, with partial draft progress and the actual remaining reviewer questions, instead of hiding the paid plan behind draft completion;
- admits a completed Authority Snapshot into the existing shared Game Plan purchase, checkout, receipt, and claim path without adding a second paid-product authority.
- closes the existing two-field intake seam: the public Snapshot start now binds a validated email to the same run, Snapshot completion can prepare the existing immutable claim package, and the existing delivery-token authority no longer excludes Snapshot results.
- preserves paid-ad audience, entry, opaque journey identity, UTMs, and click IDs on that same canonical Snapshot run without changing replay, billing, claim, or delivery authority.

The local owned-funnel bridge now:

- calls only Maestro's existing Snapshot start/watch and Game Plan checkout start/status authorities;
- makes the direct `$5` journey bootstrap and wait for the same completed Snapshot;
- stores only the opaque session envelope in tab-scoped session storage and keeps PII out of URLs;
- validates provider checkout URLs before navigation and never imports or calls the generic funnel `/api/checkout`; and
- renders the canonical delivery email at `/blueprint/asset`, accepts only active server-validated Snapshot session or claim tokens for purchase, and preserves one checkout idempotency key across recovery-page refreshes;
- implements the configured `/blueprint/checkout/return` destination and transfers the opaque token to Maestro in the fragment rather than query parameters; and
- remains fail-closed until the product contract is `ready`, an explicit live flag is set, valid Maestro Convex and app origins are present, and Turnstile is configured.

The authenticated Maestro continuation now also selects the exact claim-bound CMO thread before fully reloading `/talk`, which clears any stale shell-local thread identity before Talk remounts. A missing, mismatched, or unsuccessfully selected thread fails closed instead of silently opening another active CMO conversation. The paid audit, included Working Session, and score retake therefore retain one explicit conversation identity even if the buyer has used another CMO thread in between.

The public `$5` action now follows the approved product-plan language: `Get my full Game Plan — $5`, supported by `About 10 minutes · five short chapters · type your answers · no subscription or sales call.` This makes the interaction cost and the complete paid outcome visible without implying instant delivery or a human strategy call.

That interaction promise now maps directly to Maestro's canonical paid audit.
The kickoff message asks Chapter 1 without becoming evidence. Each of the five
customer answers is bound to the four existing criteria in one policy-owned
dimension, for exactly twenty criterion verdicts; short answers, `none`, and
`not tracked` are valid explicit evidence. A replayed message cannot advance
the next chapter. This groups the existing rubric for conversation only and
does not create a second assessment, score, or persistence path.

The exact build-time activation contract is `blueprintProductContract.status = "ready"`,
`PUBLIC_BLUEPRINT_FUNNEL_ENABLED=true`, `PUBLIC_MAESTRO_CONVEX_URL`, and
`PUBLIC_MAESTRO_APP_URL`, and `PUBLIC_TURNSTILE_SITE_KEY`. The workspace and recipe defaults remain
`modern-agency-sales` and `mas-blueprint`; their optional overrides are
`PUBLIC_MAESTRO_BLUEPRINT_WORKSPACE_SLUG` and
`PUBLIC_MAESTRO_BLUEPRINT_LEAD_MAGNET_SLUG`. Setting these values is not itself
launch approval: the deployed canary and test-mode purchase gates below still
apply.

Those changes are local implementation evidence, not deployment or end-to-end acceptance. The existing objective pack and `questionPaths` remain the conversation-goal authority; no second semantic-goal layer should be added. The next product iteration must prove through a deployed canary that the Content Working Session uses that existing strategy to resolve the important gaps, regenerates only affected drafts, preserves unrelated drafts, and leaves five human-reviewed outputs at the demonstrated quality bar. The direct paid-ad page must enter through the same Snapshot intake/session authority before it can call the shared checkout.

## Page acceptance tests

- All sixteen preview routes build: two audience indexes, four Snapshot pages, four thank-you bridges, four direct Game Plan pages, the email asset page, and the checkout-return page.
- Unknown audience slugs resolve to the static 404.
- Every preview route is `noindex` and unlinked from the public offer index.
- No preview component imports checkout or calls `/api/checkout`.
- Every apparent submission or purchase action is a native disabled button.
- The local live bridge is present but cannot activate while the product contract remains `acceptance-preview`.
- Audience switching preserves approved UTM/click identifiers and an opaque `journey_id`, never an email address.
- Each audience has unique copy, five evidence observations, three priorities, twenty unique slots, three source questions, and a synthetic draft.
- Visual quality runs on desktop, tablet, and mobile for every acquisition page and on desktop/mobile for every bridge.

Current combined local verification: 12 Blueprint contract tests, 16 existing Functions tests, the focused Maestro product suites, Astro typecheck with zero diagnostics, Cloudflare Functions compilation, focused formatting, a 29-page production build, 56 route/viewport smoke checks, and 112 current screenshots across 23 pages all pass. This is implementation evidence, not deployment or paid-traffic acceptance.

## Product evaluation loop

1. Run one no-charge fixture per audience against the current `v2` contract.
2. Score each artifact against the rows above; retain the output and evaluator notes.
3. Fix the highest-severity promise miss in Maestro without changing the page to excuse it.
4. Re-run the affected fixture and regression set.
5. Repeat until the free and paid contracts pass for all four audiences.
6. Deploy the current contract, run a safe live canary, then perform one authorized Dodo test-mode purchase from each acquisition journey.
7. Only then remove `acceptance-preview`, set final delivery/refund terms, verify proof permissions, and enable actions.

The landing page is allowed to become more precise when the product improves. It is not allowed to become less precise merely to make an incomplete product pass.

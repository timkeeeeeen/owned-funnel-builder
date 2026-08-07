# Authority Snapshot progress experience

Date: 2026-08-07

## Goal

Replace the six-minute static loading message with an honest milestone timeline. The page should explain what Maestro has completed, what it is doing now, and whether activity has stalled without inventing percentages, ETAs, source content, or model thoughts.

## Scope Guard

In scope:

- the Authority Snapshot thank-you loading state;
- the existing five-second personalization watch loop;
- the existing redacted `progress` projection returned by Maestro;
- loading, stalled, failed, completed, direct-visit, and reload states;
- responsive and accessible presentation.

Out of scope:

- token streaming or partial score/draft rendering;
- new backend workflow stages or persistence;
- email/SMS completion notifications;
- checkout, Dodo, Turnstile, tracking, or payment changes;
- displaying captured post text, URLs, email addresses, provider identifiers, or internal errors.

## Chosen approach

Use the backend's persisted progress receipts as the only authority. The public projection already provides:

- `startedAt`, `lastActivityAt`, and `stallAfterMs`;
- redacted profile/post counts and generic source previews;
- ordered events for request acceptance, research, source discovery, evidence organization, dimension evaluation, drafting, finalization, and failure.

The Astro page will render one compact progress panel. The existing browser poller will parse each projection and reconcile the panel on every response. No new dependency or backend mutation is needed.

## Interface design

### Loading panel

The panel appears where the current single loading sentence sits. It contains:

1. A heading: **Building your Authority Snapshot**.
2. A one-line current status taken from the newest real progress event.
3. A vertical milestone list:
   - Request accepted
   - Researching your public profile
   - Finding public sources
   - Organizing evidence
   - Evaluating authority dimensions
   - Drafting your starter post
   - Finalizing your Snapshot
4. A compact elapsed-time label derived from `startedAt`; it is informational, never an ETA.
5. A reassurance: **Your session is saved. You can safely reload this page.**

Milestones older than the newest receipt use a check and completed label. The newest receipt is marked **Latest update**, which avoids claiming that a just-started stage is complete. Future milestones stay muted. New receipts use a restrained 200 ms opacity transition; motion is removed under `prefers-reduced-motion`.

Before the first watch response, **Request accepted** is the only active milestone because reaching the thank-you page requires a successfully accepted session.

### Truthful live details

When source discovery exists, the current detail uses the server summary, such as **1 public profile and 18 public posts discovered**. Generic previews such as **LinkedIn profile** and **Public post 1** may appear as compact receipts. Captured content and identifying source data never appear.

The page does not estimate a percentage. Different profiles spend different amounts of time in research and evaluation, so a percentage would imply precision the workflow does not have.

### Stalled state

When `now - lastActivityAt >= stallAfterMs` while the run remains active, the panel changes tone without declaring failure:

> Still working — profile research can sometimes take longer. Your session is saved, and reloading is safe.

The timeline remains visible at the last verified milestone. Do not automatically restart or create a duplicate run. A later progress receipt clears the stalled message.

### Completion and failure

On completion, the progress panel is hidden, the existing result sections are rendered and revealed, and the existing success status remains the checkout instruction.

On failure, the panel retains completed receipts, marks processing as stopped, and exposes the existing restart action. Public copy must provide a next step without exposing internal failure details.

On a direct thank-you visit without a saved session, the progress panel stays hidden and the existing **Start a new free Snapshot** action remains the only path forward.

## Data contract and parsing

The browser accepts `progress` only when its required timestamps, source counts, and event array are valid. Each event must have a recognized key, numeric timestamp, string summary, and bounded preview array. Unknown event keys are ignored for forward compatibility; malformed progress falls back to the current generic loading message without breaking completion polling.

Rendering is monotonic within a page visit: an older or temporarily sparse response must not move a completed milestone back to pending. Reload restoration rebuilds the timeline from the backend's persisted receipts.

## Accessibility

- Use a semantic ordered list for milestones.
- Use text and icons, never color alone, for complete/current/pending state.
- Keep one stable `role="status"`/polite live region and announce only newly reached milestones or a stall/failure transition.
- Do not announce the elapsed timer every second.
- Decorative icons are hidden from assistive technology.
- Preserve readable text, contrast, focus visibility, and 320–375 px reflow.
- Honor `prefers-reduced-motion`.

## Quality Targets

- Every visible progress claim comes from a persisted backend receipt or the accepted local session fact.
- No synthetic result content is visible during progress.
- A poll response updates the visible milestone within one poll interval.
- The timeline restores after reload without starting another run.
- No new network endpoint, dependency, or source-data exposure is introduced.
- Completion still unlocks checkout only after the durable result parses successfully.

## Error handling

- Missing or malformed `progress`: keep polling and show the generic saved-session loading message.
- Network/query error: retain the last verified milestones and use the existing reload/retry message.
- Backend failure: stop polling, preserve the milestone history, and reveal restart.
- Expired session: clear local session state and direct the visitor to start again.

## Test Plan

Behavior tests will cover:

- direct visit: progress and results hidden, restart visible, zero watch calls;
- accepted-only loading: first milestone active and synthetic results hidden;
- each supported backend event advances the correct milestone;
- source counts and generic previews render without raw source fields;
- sparse responses do not regress completed milestones;
- unknown/malformed progress falls back safely and polling continues;
- stalled activity changes the message without restarting or failing;
- renewed activity clears the stalled message;
- failure preserves receipts and reveals restart;
- completion hides progress, renders the real result, and unlocks checkout;
- reload restores progress or the completed result from the same session;
- mobile reflow, reduced motion, keyboard access, and Axe checks;
- one real same-tab production run verifies milestone movement, completion, and reload without entering checkout.

## Alternatives rejected

- **Chat-like activity stream:** noisier, harder to scan, and encourages invented narration between durable events.
- **Partial score/draft streaming:** creates unstable customer-facing output and requires new backend contracts and product decisions.
- **Fake percentage or countdown:** misleading because stage duration varies by available public evidence.

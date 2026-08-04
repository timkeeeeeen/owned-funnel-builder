# Market Opportunity Plan Page Design

Date: 2026-08-04

Status: approved for autonomous execution by the owner's instruction to finish the page before showing it

## Purpose

Create one browser-viewable decision page that combines the existing funnel portfolio, Maestro's current product truth, and the completed US Meta Ads Library research into a practical offer and funnel test plan.

The page must answer four questions:

1. What are smaller advertisers repeatedly selling through active Meta ads?
2. Which service offers should the owner test across app development, funnels, ads, and AI-brain implementation?
3. Which funnels should be added to the current portfolio?
4. Which adjacent digital or SaaS products are worth validating, and which broad ideas should be avoided?

## Evidence boundary

The research set contains 3,275 collected ad rows, 411 deduplicated relevant advertiser/offer combinations, and a 159-row high-signal shortlist. Of the shortlist, 150 landing pages across 138 advertisers were HTTP-reachable during the research run.

Active status, longevity, repeated creatives, and reachable landing pages are competitive-persistence signals. They do not reveal spend, purchases, profit, or ROAS. The page must use the label `Observed signal` for facts from the research and `Recommendation` for strategic inference.

Every showcased advertiser must link to both the exact landing page captured in the research and its direct Meta Ad Library record. No advertiser is presented as a verified winner.

## Product truth

The current funnel portfolio has five offer families:

- Owned Funnel Builder: $49 direct checkout, $19 bump, and configured upsells.
- Talking-Head Ad Machine: $27 direct checkout, $9 bump, and a configured $37 upsell.
- Vibe Code Anything: $29 direct checkout, $19 bump, and configured upsells.
- Authority Snapshot to $5 CMO Game Plan: lead-magnet ladder, still blocked from paid traffic by product and live-proof gates.
- App Idea Evaluator to $29 Complete Build Pack: lead-magnet ladder, still blocked from paid traffic by deployment and proof gates.

Maestro's launch-safe wedge is invite-controlled: a real call becomes source-backed claims and one reviewable LinkedIn draft or content brief. Its Brain ingests sources, extracts cited claims, and supplies grounded context to generation. Native LinkedIn publishing, broad autonomous content operations, public pricing, and a done-for-you Maestro tier are not launch-ready promises.

## Strategic design

The page recommends two focused service lanes instead of one generalist agency:

1. **Launch Rescue for SaaS and vibe-coded founders:** finish and production-harden the app, create the conversion path, install tracking, and prepare the first acquisition test.
2. **Source-Backed Growth System for agencies, consultants, and founder-led teams:** turn calls and company knowledge into a cited Brain, approved messaging, and reviewable LinkedIn/funnel assets through Maestro.

Web development, funnel building, ads management, and AI-brain work remain delivery capabilities beneath those two outcomes. Ads management is sold only with the offer, conversion path, creative, tracking, and qualification system needed to produce useful calls.

## Page structure

The route is `/market-opportunity-plan/` and is excluded from search indexing.

1. **Executive recommendation** — two service lanes, what to lead with, and what not to lead with.
2. **Research readout** — sample size, limitations, and the strongest observed funnel patterns.
3. **What the market appears to want** — outcome-led demand across app rescue, funnel systems, ads, AI implementation, and LinkedIn/content.
4. **Existing portfolio and gaps** — the five offer families and missing direct-to-call, diagnostic, sample-output, and implementation bridges.
5. **Offer ladder** — free, low-ticket, booked-call, implementation, and recurring layers for each lane.
6. **Prioritized funnel tests** — hypothesis, audience, page type, front-end offer, backend, traffic angle, and pass/kill rule.
7. **Service decisions** — explicit positioning for web development, funnel building, ads management, and AI-brain implementation.
8. **Digital and SaaS build candidates** — ranked by evidence fit, validation speed, Maestro leverage, and delivery burden; includes a do-not-build list.
9. **Competitive funnel library** — representative smaller advertisers with exact landing-page and ad links.
10. **30-day execution sequence** — the smallest order of operations and decision metrics.

## Approaches considered

### Recommended: one static Astro decision page

Use the existing `OfferLayout`, design tokens, and Tailwind utilities. Keep the research snapshot as page-local data because it is an internal decision artifact, not a reusable product domain. This produces one route, no runtime API, no new dependency, and the smallest diff.

### Rejected: turn the research into a live dashboard

A filterable dashboard would require parsing, state, pagination, and a durable data update path. The owner asked for a plan and evidence library, not a research product. The existing CSV remains the exhaustive sheet.

### Rejected: add the strategy to the public offer catalog

The page is an internal planning artifact rather than a customer offer. Publishing it in the homepage catalog would confuse buyers and expose strategic notes.

## Visual and interaction design

- Use the existing warm background, Geist type, blue brand action, yellow highlights, card surfaces, and grid texture.
- Use a compact anchor navigation at the top and clear section IDs.
- Put the two-lane recommendation before research detail.
- Use responsive cards for strategy and offer ladders; use horizontally scrollable tables only where repeated fields make comparison materially easier.
- External links name their destination, open in a new tab, and keep visible focus styles and at least 44-pixel touch targets.
- The page has one `h1`, sequential heading levels, a readable text measure, and no hidden mobile-only information.
- Do not add animation, client-side state, custom components, or new global styles.

## Data flow and failure behavior

All page data is compiled into static HTML from local constants in the route. There are no runtime requests and no form submissions. If an external competitor page later disappears, the captured URL and Meta record remain visible as research evidence; the page makes no runtime availability claim.

## Verification

Write one Node test before the page exists. It reads the built HTML and asserts:

- the route builds;
- the research limitation is visible;
- both service lanes are present;
- direct-to-call, lead-magnet, low-ticket, trial/demo, and checkout are represented;
- the digital/SaaS candidate section is present;
- representative landing-page and Meta Ad Library links are rendered.

Verify the failing test against the baseline build, implement the page, rebuild, rerun the focused test, run Astro typecheck, and inspect desktop and mobile screenshots for overflow and hierarchy.

## Acceptance criteria

- The user can open the page locally in a browser at one stable route.
- The page clearly distinguishes observed research from recommendations.
- It includes exact advertiser landing-page and Meta-ad links.
- It recommends what to test first and names pass/kill thresholds.
- It covers all four service capabilities and adjacent digital/SaaS candidates.
- It preserves Maestro's current product and launch boundaries.
- The existing funnel routes and unrelated working-tree changes remain untouched.

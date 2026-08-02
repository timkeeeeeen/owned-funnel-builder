# Owned Funnel Builder

A fast, conversion-focused funnel builder you own forever.

It includes:

- polished Astro landing pages with large, unmistakable calls to action;
- a visual Keystatic editor for changing copy without touching code;
- email-first Dodo or Stripe checkout, with Dodo as the default;
- one order bump and up to two one-click upsells;
- verified file delivery: Dodo-native access or required branded Postmark delivery with Stripe;
- Cloudflare Pages, Functions, and D1 setup;
- bundled agent skills and a safe local MCP;
- desktop, tablet, mobile, accessibility, and checkout release checks.

## If you do not know anything about computers

You do not need to learn Git, a terminal, YAML, environment variables, or Cloudflare infrastructure.

1. Open Claude Cowork, Claude Code, Codex, or another agent that can work with files and GitHub.
2. Give it the folder or private GitHub access link you received.
3. Say:

> Help me launch my offer. Assume I have no computer skills and handle the technical work for me.

The agent will ask normal business questions: what you sell, who it is for, the price, what buyers receive, and what proof you have. It can open the visual editor when you want to change words yourself.

When the agent asks you to connect services, it opens a private setup screen on your computer. Choose Dodo or Stripe and connect Postmark for purchase access and opted-in updates. Dodo can deliver files itself; Stripe requires Postmark so buyers receive their access link. The file is excluded from GitHub and the setup screen never prints the values.

When you are ready, say:

> Check everything and publish it to Cloudflare.

The agent should return the real public URL only after the build, payment configuration, and release checks pass.

## Useful sentences to give your agent

- “Make me a landing page for this offer.”
- “Open the visual editor so I can change the copy.”
- “Add a $19 order bump that is an obvious yes.”
- “Write two one-click upsells that naturally follow the purchase.”
- “Show me the mobile version.”
- “Connect Dodo for payments.”
- “Connect Stripe and customer access email.”
- “Run every release check.”
- “Publish this and give me the URL.”
- “Roll back to the last known-good version.”

## What the buyer edits

Keystatic edits ordinary JSON files in `src/content/`. The published website is still a fast static Astro site. Keystatic does not run publicly and customers never see an admin screen.

The agent can also write explicit Astro when an offer needs a custom section. This is intentional: the content editor handles routine changes, while a smart agent remains free to create a page that fits the offer.

## Agent quickstart

Read [AGENTS.md](./AGENTS.md), [PROJECT.md](./PROJECT.md), the applicable skill under `skills/`, and the relevant design primitives under `system/globals/`.

Common commands for the agent:

```bash
npm install
npm run editor
npm run validate:config
npm run typecheck
npm run build
npm run check:functions
npm run test:quality
npm run test:functions
npm run mcp:test
npm run quality:smoke
npm run quality:capture
npm run quality:verify
```

The private service setup workflow is:

```bash
npm run setup
npm run setup:cloudflare
npm run setup:dodo # or: npm run setup:stripe
npm run setup:email:test
npm run email:send
npm run publish
```

Do not ask a nontechnical buyer to run those commands. Run them on the buyer’s behalf and explain only the human decision or browser approval required.

## Local MCP

Build it with `npm run mcp:build`. The high-level tools include `funnel_start`, `funnel_create`, `funnel_preview`, `funnel_validate`, payment/email configuration guidance, publish planning, status, and rollback planning.

See [packages/mcp/README.md](./packages/mcp/README.md) for client configuration and the security contract. It never accepts secret values, runs arbitrary shell commands, creates paid orders, or silently publishes.

## Payment and fulfillment contract

Dodo Payments is the supported default, and Stripe is a first-class option. Every configured funnel has:

- one main product;
- one optional checkout bump;
- zero to two post-purchase upsells;
- a visible decline path;
- saved-payment-method one-click charging when available;
- a secure checkout fallback when one-click charging is unavailable;
- idempotent server-side payment verification;
- signed provider webhooks that drive fulfillment and Admaxxer revenue attribution;
- one Dodo entitlement per purchased product, or one required Postmark access email per Stripe purchase;

Provider webhooks are the fulfillment source of truth. Dodo sends fresh download links by email and through its customer portal. Stripe sends each configured access link through Postmark. In both modes, email failures never create a second charge and retry keys prevent duplicate access emails. Marketing email uses Postmark's separate broadcast stream and only includes explicitly opted-in, non-suppressed subscribers.

Stripe Checkout saves the first card for off-session reuse. An eligible upsell charges that saved method server-side; authentication, a declined saved method, or a missing method opens secure hosted Stripe Checkout instead.

## GitHub safety

The repository is designed to be the source of truth. Commit and push coherent milestones after they pass focused checks. Never commit `.dev.vars`, secrets, D1 customer data, or generated screenshot evidence.

The original working funnel was preserved before this product was extracted. The reusable repository keeps that funnel as a dogfood example while all infrastructure identifiers and private contact details are generic.

## Included dogfood funnels

- `/vibe-code-anything/` preserves the first complete paid-offer implementation.
- `/owned-funnel-builder/` sells this builder using the same editable page, $19 bump, two upsells, fulfillment contract, and release gates customers receive.

The repository intentionally ships with example support emails and access links. `npm run publish` fails closed until the owner replaces them through the visual editor and private setup workflow. This prevents a buyer from paying successfully and receiving a placeholder link.

## Foundation

Built from the MIT-licensed [AstroDeck](https://github.com/holger1411/astrodeck) foundation. The distributable product contains only generic design primitives and original implementation.

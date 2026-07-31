---
name: launch-a-funnel
description: Launch or substantially revise a complete owned sales funnel from a plain-English product idea. Use when the user wants the agent to interview them, create the landing page, configure checkout with an optional order bump and up to two upsells, set up delivery email, publish to Cloudflare, or coordinate the full funnel workflow for a nontechnical owner.
---

# Launch a Funnel

Own the technical work. Ask the user only for business decisions, account approvals, and facts only they can know.

## Workflow

1. Read `PROJECT.md`, `AGENTS.md`, and [references/interview.md](references/interview.md).
2. Inspect the current offer data, routes, funnel configuration, and deployment status before changing anything.
3. Recover known facts from the repository and conversation. Do not ask for them again.
4. Ask one to three short plain-English questions at a time. Prefer concrete choices when the user may not know the terminology.
5. Record the offer, audience, promise, price, proof, delivery, bump, upsells, guarantee, brand inputs, domain, and prohibited claims.
6. Use `$write-funnel-copy` and `$design-funnel` to create the page. Preserve the proven checkout and upsell implementation.
7. Use `$edit-funnel` to expose customer-visible content in Keystatic.
8. Use either `$configure-dodo` or `$configure-stripe`, then `$configure-resend`, `$configure-admaxxer`, and `$publish-cloudflare` for operations. Run commands yourself; never turn a command into a user task.
9. Use `$audit-funnel` before publishing and again against the live URL.
10. Return the public URL, what is live, and any human action still required.

## Interaction contract

- Translate jargon into outcomes. Say “approve Cloudflare access,” not “authenticate Wrangler.”
- Open or provide the exact approval link when an account needs the user.
- Never ask the user to edit code, use Git, run a terminal command, name an environment variable, or choose an infrastructure binding.
- Never invent proof, testimonials, guarantees, product behavior, or scarcity.
- Pause for explicit approval before a real charge, DNS change, destructive operation, or public launch when that approval has not already been given.
- Keep the existing live funnel available while replacing or extending it.

## Completion

Do not call the funnel launched until its copy, responsive layout, email capture, checkout, optional bump, upsell accept/decline paths, fulfillment, analytics events, revenue attribution, and exact production URL have been verified at the appropriate no-charge or sandbox level.

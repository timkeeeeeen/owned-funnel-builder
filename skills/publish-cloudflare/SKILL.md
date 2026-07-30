---
name: publish-cloudflare
description: Create, configure, publish, verify, or roll back this Astro funnel on Cloudflare Pages with Functions, D1, secrets, environment variables, and an optional custom domain. Use when a nontechnical owner asks to put a funnel online, connect Cloudflare, migrate the lead database, set production configuration, publish an exact Git commit, or diagnose a live deployment.
---

# Publish to Cloudflare

Treat deployment as a low-freedom release. Run operations yourself and verify every external mutation.

## Workflow

1. Read [references/release.md](references/release.md), `wrangler.jsonc`, `astro.config.mjs`, migrations, package scripts, and the target branch status.
2. Confirm the intended Git repository, Cloudflare account, project name, production branch, domain, and whether a live funnel must remain available.
3. Ask the user only to approve account access or DNS ownership when required. Provide the exact link and one plain-English action.
4. Build and audit the exact commit intended for production.
5. Create or reuse the Pages project and D1 database. Apply migrations in order without deleting real leads.
6. Configure bindings, environment values, and secrets without printing secret values.
7. Deploy the exact commit to a preview first when payment or infrastructure changed, then publish production after approval already in scope.
8. Read Cloudflare state back and verify the commit, routes, assets, Functions, checkout configuration, and live response.
9. Connect the custom domain only when requested and verify DNS and HTTPS.
10. Record the stable URL, exact commit, resources created, checks run, and rollback target.

## Safety

- Never overwrite an unrelated Pages project, D1 database, binding, domain, or production branch.
- Never replace or delete production data to make a test pass.
- Keep prior deployment identifiers available for rollback.
- Do not claim success from CLI exit status alone; verify the stable URL.

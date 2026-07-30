---
name: edit-funnel
description: Edit an existing funnel's customer-visible copy, images, video, offer settings, or basic brand choices through Keystatic and the repository content model. Use when a nontechnical owner asks to change wording or media, add or remove a section, preview edits, repair missing editor fields, or keep Astro composition and Keystatic fields synchronized.
---

# Edit a Funnel

Make the requested change yourself and give the user a simple preview. Do not send them into source code.

## Process

1. Read the target offer, its Astro route or composition, `keystatic.config.*`, and [references/keystatic.md](references/keystatic.md).
2. Determine whether the request changes content, presentation, payments, or several of them.
3. For content and media, update the canonical Keystatic-backed record. Do not create a second source of truth.
4. For composition changes, update Astro and expose all customer-visible copy and media as clear Keystatic fields.
5. Use friendly field labels, short descriptions, sensible defaults, and validation that explains how to fix errors.
6. Start the editor and preview yourself when possible. Tell the user only which local page to open and what human decision to review.
7. Run type, format, build, and relevant funnel checks before handing off.

## Boundaries

- Keep CSS, classes, secret values, provider IDs, database bindings, and Git controls out of Keystatic.
- Avoid raw HTML fields when structured text is sufficient.
- Preserve unknown fields and unrelated user edits.
- Never silently publish an unfinished draft or replace live content without the requested authorization.
- If Keystatic cannot express an intentional layout change, change the Astro composition; do not contort content fields into a page builder.

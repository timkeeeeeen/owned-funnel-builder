# Owned Funnel Builder MCP

This local stdio MCP gives an AI assistant a small set of safe, plain-language operations for working with an Owned Funnel Builder project. It is designed for people who do not use a terminal themselves.

It can:

- explain project and integration status;
- list, read, and safely update structured offer content;
- explain how to open a preview;
- run the project’s validation commands;
- report whether Dodo, Resend, and Cloudflare settings are present without returning their values;
- prepare a dry-run publishing plan; and
- verify local release checks and a public HTTPS page.

## The simple tools your agent should use

These are the recommended tools for ordinary use. Their names follow the same order as the plain-English launch workflow.

| Tool                        | What it does                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `funnel_start`              | Explains what is ready and asks the short offer interview.                                                                              |
| `funnel_list`               | Shows every funnel and its local page address.                                                                                          |
| `funnel_create`             | Creates an unpublished landing page, disabled checkout, unselected order bump, two upsells, completion page, and delivery placeholders. |
| `funnel_preview`            | Explains how to open the page and the Keystatic editor.                                                                                 |
| `funnel_validate`           | Runs the project quality checks.                                                                                                        |
| `funnel_configure_payments` | Reports Dodo setup status and gives safe next steps without accepting or displaying a key.                                              |
| `funnel_configure_email`    | Reports Resend setup status and gives safe next steps without accepting or displaying a key.                                            |
| `funnel_publish`            | Produces an explicit Cloudflare dry-run plan and reports blockers.                                                                      |
| `funnel_status`             | Summarizes pages, integrations, editing, and publishing capabilities.                                                                   |
| `funnel_rollback`           | Produces a non-destructive recovery plan from known Git and Cloudflare history.                                                         |

New funnels are intentionally unpublished and have checkout disabled. Their order bump and two upsells are fully shaped but use generic draft copy, placeholder delivery links, and a placeholder support address. The agent must replace and verify those details before enabling payments.

The lower-level tools (`project_status`, `list_offers`, `read_offer`, `update_offer`, `preview_instructions`, `validate_funnel`, `configuration_status`, `plan_publish`, and `verify_release`) remain available for compatibility and more focused operations.

It cannot display credentials, run arbitrary shell commands, silently publish, or place a real order.

## Build and test

From this package directory:

```bash
npm install
npm test
```

## Connect it to an MCP client

Build the package, then point the client at the absolute `dist/index.js` path. Keep the funnel repository explicit so the server cannot accidentally operate on a different folder.

```json
{
  "mcpServers": {
    "owned-funnel-builder": {
      "command": "node",
      "args": ["/absolute/path/to/owned-funnel-builder/packages/mcp/dist/index.js"],
      "env": {
        "FUNNEL_PROJECT_ROOT": "/absolute/path/to/owned-funnel-builder"
      }
    }
  }
}
```

Use Keystatic for ordinary hand editing. The MCP is the agent’s operational interface, not a replacement content editor.

## Offer content contract

Editable offers are discovered beneath one of these folders:

- `content/offers/`
- `src/content/offers/`
- `src/data/offers/`

JSON, YAML, and Markdown with YAML frontmatter are supported. A record should contain a stable `slug`. Existing TypeScript-only offers are listed as legacy and intentionally remain read-only until migrated to structured content.

Updates merge named fields and are written atomically. The MCP refuses absolute paths, parent traversal, escaping symlinks, unsafe object keys, and slug changes.

## Security model

- All file access is confined to the resolved funnel repository.
- Executed validation commands come from a fixed allowlist and use argument arrays, never a shell.
- Child checks receive an environment with credential-like variables removed.
- Integration checks inspect setting names only.
- Diagnostic output is truncated and credential-shaped text is redacted.
- Publishing is a dry-run planning tool. A dedicated publishing skill or explicit human-approved workflow performs external mutations.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validateProject, projectStatus, publishPlan, verifyRelease } from './checks.js';
import { findOffer, listOffers, updateOffer } from './offers.js';
import { findProjectRoot, readPackageScripts } from './project.js';
import { integrationStatus } from './services.js';

function response(value: unknown) {
  const structured =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : Array.isArray(value)
        ? { items: value }
        : { value };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: structured,
  };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'The request could not be completed.' }],
  };
}

async function root() {
  return findProjectRoot();
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'owned-funnel-builder', version: '0.1.0' });

  server.registerTool('project_status', {
    title: 'Check funnel project status',
    description: 'Explains what is in this funnel project, what is connected, and what still needs attention. Never returns secret values.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try { return response(await projectStatus(await root())); } catch (error) { return failure(error); }
  });

  server.registerTool('list_offers', {
    title: 'List offers',
    description: 'Lists the offers that can be edited in this project.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const offers = await listOffers(await root());
      return response(offers.map(({ slug, path, format, editable, note }) => ({ slug, path, format, editable, note })));
    } catch (error) { return failure(error); }
  });

  server.registerTool('read_offer', {
    title: 'Read an offer',
    description: 'Reads the editable words and settings for one offer. Payment credentials are never stored in offer content.',
    inputSchema: { slug: z.string().min(1).max(100).describe('The offer address, such as my-first-offer') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ slug }) => {
    try { return response(await findOffer(await root(), slug)); } catch (error) { return failure(error); }
  });

  server.registerTool('update_offer', {
    title: 'Update offer words and settings',
    description: 'Safely updates named fields in one structured offer file. It cannot edit files outside this project or change the offer address.',
    inputSchema: {
      slug: z.string().min(1).max(100),
      updates: z.record(z.string(), z.unknown()).describe('Only the fields to change. Nested objects are merged.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ slug, updates }) => {
    try {
      const offer = await updateOffer(await root(), slug, updates);
      return response({ ok: true, message: `Updated “${slug}”. Preview and validate it before publishing.`, offer });
    } catch (error) { return failure(error); }
  });

  server.registerTool('preview_instructions', {
    title: 'Preview the funnel',
    description: 'Gives plain-language instructions and the exact safe command for opening the local preview. It does not start a hidden background process.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const scripts = await readPackageScripts(await root());
      const command = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null;
      return response(command ? {
        ready: true,
        command,
        instructions: ['Ask your agent to run the preview command.', 'Open the local link it returns.', 'Keep that window open while editing in Keystatic.', 'Check the phone-sized preview before publishing.'],
      } : { ready: false, instructions: ['The project needs a dev or start command before it can be previewed.'] });
    } catch (error) { return failure(error); }
  });

  server.registerTool('validate_funnel', {
    title: 'Validate the funnel',
    description: 'Runs the project’s own safe quality checks and explains which checks passed or failed.',
    inputSchema: { level: z.enum(['basic', 'full']).default('basic') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ level }) => {
    try { return response(await validateProject(await root(), level)); } catch (error) { return failure(error); }
  });

  server.registerTool('configuration_status', {
    title: 'Check Dodo, Resend, and Cloudflare setup',
    description: 'Reports whether required settings exist without reading or displaying any secret values.',
    inputSchema: { service: z.enum(['all', 'dodo', 'resend', 'cloudflare']).default('all') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ service }) => {
    try {
      const status = await integrationStatus(await root());
      return response(service === 'all' ? status : { [service]: status[service], privacy: status.privacy });
    } catch (error) { return failure(error); }
  });

  server.registerTool('plan_publish', {
    title: 'Prepare a Cloudflare publish plan',
    description: 'Checks publish prerequisites and returns a plain-language dry run. It never publishes or changes Cloudflare by itself.',
    inputSchema: { production: z.boolean().default(false).describe('Whether this plan is for the public production site') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ production }) => {
    try { return response(await publishPlan(await root(), production)); } catch (error) { return failure(error); }
  });

  server.registerTool('verify_release', {
    title: 'Verify a funnel release',
    description: 'Runs full local checks and optionally confirms that a public HTTPS URL serves an HTML page. It never places a paid order.',
    inputSchema: { url: z.string().url().optional().describe('The final public page to verify') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try { return response(await verifyRelease(await root(), url)); } catch (error) { return failure(error); }
  });

  return server;
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  validateProject,
  projectStatus,
  publishPlan,
  rollbackPlan,
  verifyRelease,
} from './checks.js';
import { createFunnel, findOffer, listOffers, updateOffer } from './offers.js';
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
    content: [
      {
        type: 'text' as const,
        text: error instanceof Error ? error.message : 'The request could not be completed.',
      },
    ],
  };
}

async function root() {
  return findProjectRoot();
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'owned-funnel-builder', version: '0.1.0' });

  server.registerTool(
    'project_status',
    {
      title: 'Check funnel project status',
      description:
        'Explains what is in this funnel project, what is connected, and what still needs attention. Never returns secret values.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return response(await projectStatus(await root()));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_offers',
    {
      title: 'List offers',
      description: 'Lists the offers that can be edited in this project.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const offers = await listOffers(await root());
        return response(
          offers.map(({ slug, path, format, editable, note }) => ({
            slug,
            path,
            format,
            editable,
            note,
          }))
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'read_offer',
    {
      title: 'Read an offer',
      description:
        'Reads the editable words and settings for one offer. Payment credentials are never stored in offer content.',
      inputSchema: {
        slug: z.string().min(1).max(100).describe('The offer address, such as my-first-offer'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ slug }) => {
      try {
        return response(await findOffer(await root(), slug));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'update_offer',
    {
      title: 'Update offer words and settings',
      description:
        'Safely updates named fields in one structured offer file. It cannot edit files outside this project or change the offer address.',
      inputSchema: {
        slug: z.string().min(1).max(100),
        updates: z
          .record(z.string(), z.unknown())
          .describe('Only the fields to change. Nested objects are merged.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ slug, updates }) => {
      try {
        const offer = await updateOffer(await root(), slug, updates);
        return response({
          ok: true,
          message: `Updated “${slug}”. Preview and validate it before publishing.`,
          offer,
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'preview_instructions',
    {
      title: 'Preview the funnel',
      description:
        'Gives plain-language instructions and the exact safe command for opening the local preview. It does not start a hidden background process.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const scripts = await readPackageScripts(await root());
        const command = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null;
        return response(
          command
            ? {
                ready: true,
                command,
                instructions: [
                  'Ask your agent to run the preview command.',
                  'Open the local link it returns.',
                  'Keep that window open while editing in Keystatic.',
                  'Check the phone-sized preview before publishing.',
                ],
              }
            : {
                ready: false,
                instructions: [
                  'The project needs a dev or start command before it can be previewed.',
                ],
              }
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'validate_funnel',
    {
      title: 'Validate the funnel',
      description:
        'Runs the project’s own safe quality checks and explains which checks passed or failed.',
      inputSchema: { level: z.enum(['basic', 'full']).default('basic') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ level }) => {
      try {
        return response(await validateProject(await root(), level));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'configuration_status',
    {
      title: 'Check payments, Postmark, and Cloudflare setup',
      description:
        'Reports whether required settings exist without reading or displaying any secret values.',
      inputSchema: {
        service: z
          .enum(['all', 'payments', 'dodo', 'stripe', 'email', 'cloudflare'])
          .default('all'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ service }) => {
      try {
        const status = await integrationStatus(await root());
        return response(
          service === 'all' ? status : { [service]: status[service], privacy: status.privacy }
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'plan_publish',
    {
      title: 'Prepare a Cloudflare publish plan',
      description:
        'Checks publish prerequisites and returns a plain-language dry run. It never publishes or changes Cloudflare by itself.',
      inputSchema: {
        production: z
          .boolean()
          .default(false)
          .describe('Whether this plan is for the public production site'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ production }) => {
      try {
        return response(await publishPlan(await root(), production));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'verify_release',
    {
      title: 'Verify a funnel release',
      description:
        'Runs full local checks and optionally confirms that a public HTTPS URL serves an HTML page. It never places a paid order.',
      inputSchema: { url: z.string().url().optional().describe('The final public page to verify') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        return response(await verifyRelease(await root(), url));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_start',
    {
      title: 'Start building a funnel',
      description:
        'Starts the zero-skill workflow by explaining what is ready and the few plain-English questions needed to make or finish a funnel.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = await projectStatus(await root());
        return response({
          message:
            'You do not need to edit code or use a terminal. Answer these questions and your agent can handle the project.',
          questions: [
            'What are you selling?',
            'Who is it for, and who is it not for?',
            'What result does the buyer get?',
            'What does the main product cost?',
            'What simple add-on would be easy to include at checkout?',
            'What two upgrades would help the buyer get a bigger or faster result?',
            'Where should customers receive their access?',
            'Which payment service do you want to use: Dodo or Stripe? Do you already have the required Postmark, Cloudflare, and domain accounts?',
          ],
          project: status,
          nextTool: status.offerCount > 0 ? 'funnel_list' : 'funnel_create',
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_list',
    {
      title: 'Show my funnels',
      description:
        'Shows every landing-page offer in the project and whether its editable content is ready.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const offers = await listOffers(await root());
        return response({
          count: offers.length,
          funnels: offers.map(({ slug, path, format, editable, note }) => ({
            slug,
            page: `/${slug}/`,
            path,
            format,
            editable,
            note,
          })),
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_create',
    {
      title: 'Create a complete funnel draft',
      description:
        'Creates a safe unpublished landing page, checkout, unselected order bump, two upsells, completion page, and delivery placeholders from a few plain-English details.',
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .max(80)
          .describe('Short lowercase page address, such as my-great-offer'),
        productName: z.string().min(2).max(120).describe('The name buyers will see'),
        headline: z.string().min(3).max(100).describe('The main promise in at least two words'),
        priceAmount: z
          .number()
          .min(0)
          .max(1_000_000)
          .describe('Main price in ordinary currency units, such as 29'),
        currency: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .default('USD'),
        orderBumpPrice: z.number().min(0).max(1_000_000).default(19),
        firstUpsellPrice: z.number().min(0).max(1_000_000).default(39),
        secondUpsellPrice: z.number().min(0).max(1_000_000).default(79),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const created = await createFunnel(await root(), {
          ...input,
          currency: input.currency.toUpperCase(),
        });
        return response({
          ok: true,
          message: `Created the unpublished “${input.productName}” funnel with a checkout bump and two upsells. No payment products were created and nothing was published.`,
          ...created,
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_preview',
    {
      title: 'Preview my funnel',
      description:
        'Explains exactly how the agent should open the local page and visual editor. It does not leave a hidden process running.',
      inputSchema: { slug: z.string().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ slug }) => {
      try {
        const scripts = await readPackageScripts(await root());
        const command = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null;
        return response({
          ready: Boolean(command),
          command,
          page: slug ? `/${slug}/` : 'Choose a funnel with funnel_list.',
          editor: '/keystatic',
          instructions: command
            ? [
                'Ask your agent to run the preview command.',
                'Open the local link it returns.',
                'Use /keystatic to hand-edit words and images.',
                'Review the landing page, order bump, and both upsells on desktop and phone sizes.',
              ]
            : ['The project needs a dev or start command before preview is available.'],
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_validate',
    {
      title: 'Check that my funnel is ready',
      description:
        'Runs the project’s safe quality checks. Full mode checks formatting, code, content rules, and the production build.',
      inputSchema: { level: z.enum(['basic', 'full']).default('full') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ level }) => {
      try {
        return response(await validateProject(await root(), level));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_configure_payments',
    {
      title: 'Prepare payments',
      description:
        'Checks the selected Dodo or Stripe settings and explains safe next steps. This tool never accepts, reads, or displays a payment key.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = await integrationStatus(await root());
        const provider = status.payments.provider;
        const selectedStatus = provider === 'stripe' ? status.stripe : status.dodo;
        return response({
          ...status.payments,
          variables: selectedStatus.variables,
          changedNothing: true,
          safeSteps:
            provider === 'stripe'
              ? [
                  'Open Stripe in your own browser and start in test mode.',
                  'Ask the configure-stripe skill to guide secure setup.',
                  'Connect Postmark and replace every placeholder access link before enabling Stripe.',
                  'Create or reuse the main, bump, and upsell Products and Prices and verify the signed webhook.',
                  'Run a test checkout, saved-card upsell, and hosted fallback without making a live charge.',
                ]
              : [
                  'Open Dodo Payments in your own browser.',
                  'Ask the configure-dodo skill to guide product creation and secure secret storage.',
                  'Create the main product, order bump, and two upsells from the funnel definition.',
                  'Run a test checkout without making an unnecessary real charge.',
                  'Enable checkout only after product IDs and prices are verified.',
                ],
          privacy: status.privacy,
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_configure_email',
    {
      title: 'Prepare delivery email',
      description:
        'Checks whether Postmark settings exist and explains the safe next steps. This tool never accepts, reads, or displays an email token.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = await integrationStatus(await root());
        return response({
          ...status.email,
          changedNothing: true,
          safeSteps: [
            'Open Postmark in your own browser.',
            'Ask the configure-email skill to guide domain verification and secure secret storage.',
            'Replace every placeholder access link and support email.',
            'Send a Postmark sandbox or black-hole test email.',
            'Confirm core, bump, and accepted upsells each deliver the correct item.',
          ],
          privacy: status.privacy,
        });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_publish',
    {
      title: 'Prepare to publish my funnel',
      description:
        'Prepares an explicit Cloudflare publishing plan and checks blockers. It does not publish silently or change external accounts.',
      inputSchema: { production: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ production }) => {
      try {
        return response(await publishPlan(await root(), production));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_status',
    {
      title: 'Tell me what is ready',
      description:
        'Explains the current funnel project, integrations, editing support, and next likely action without exposing credentials.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return response(await projectStatus(await root()));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'funnel_rollback',
    {
      title: 'Prepare a safe rollback',
      description:
        'Shows a non-destructive recovery plan using known Git and Cloudflare history. It never resets files, deletes data, or changes the public site.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return response(await rollbackPlan(await root()));
      } catch (error) {
        return failure(error);
      }
    }
  );

  return server;
}

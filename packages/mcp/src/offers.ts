import { link, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { pathExists, safeProjectPath } from './project.js';

const OFFER_DIRECTORIES = ['content/offers', 'src/content/offers', 'src/data/offers'];
const EDITABLE_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.md', '.mdx']);
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface OfferRecord {
  slug: string;
  path: string;
  format: string;
  editable: boolean;
  data?: Record<string, unknown>;
  note?: string;
}

export interface CreateFunnelInput {
  slug: string;
  productName: string;
  headline: string;
  priceAmount: number;
  currency: string;
  orderBumpPrice: number;
  firstUpsellPrice: number;
  secondUpsellPrice: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeObject(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`The field name “${key}” is not allowed.`);
    if (isRecord(child)) assertSafeObject(child);
  }
}

function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  if (!source.startsWith('---\n')) return { data: {}, body: source };
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('The offer has an unfinished frontmatter section.');
  const parsed = YAML.parse(source.slice(4, end));
  if (!isRecord(parsed)) throw new Error('The offer frontmatter must contain named fields.');
  return { data: parsed, body: source.slice(end + 5) };
}

async function parseOfferFile(
  path: string
): Promise<{ data: Record<string, unknown>; body?: string }> {
  const source = await readFile(path, 'utf8');
  const extension = extname(path).toLowerCase();
  if (extension === '.json') {
    const parsed: unknown = JSON.parse(source);
    if (!isRecord(parsed)) throw new Error('The offer file must contain named fields.');
    return { data: parsed };
  }
  if (extension === '.yaml' || extension === '.yml') {
    const parsed: unknown = YAML.parse(source);
    if (!isRecord(parsed)) throw new Error('The offer file must contain named fields.');
    return { data: parsed };
  }
  return parseFrontmatter(source);
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(path)));
    else if (entry.isFile() && EDITABLE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      results.push(path);
  }
  return results;
}

function slugFrom(path: string, data: Record<string, unknown>): string {
  if (typeof data.slug === 'string' && data.slug.trim()) return data.slug.trim();
  const name = basename(path, extname(path));
  return name === 'index' || name === 'offer' ? basename(dirname(path)) : name;
}

export async function listOffers(root: string): Promise<OfferRecord[]> {
  const actualRoot = await realpath(root);
  const offers: OfferRecord[] = [];
  for (const relativeDir of OFFER_DIRECTORIES) {
    const dir = await safeProjectPath(root, relativeDir);
    if (!(await pathExists(dir))) continue;
    for (const file of await walk(dir)) {
      try {
        const parsed = await parseOfferFile(file);
        offers.push({
          slug: slugFrom(file, parsed.data),
          path: relative(actualRoot, file),
          format: extname(file).slice(1),
          editable: true,
          data: parsed.data,
        });
      } catch (error) {
        offers.push({
          slug: basename(file, extname(file)),
          path: relative(actualRoot, file),
          format: extname(file).slice(1),
          editable: false,
          note: error instanceof Error ? error.message : 'This file could not be read.',
        });
      }
    }
  }

  const legacy = join(root, 'src/data/offers.ts');
  if (offers.length === 0 && (await pathExists(legacy))) {
    const source = await readFile(legacy, 'utf8');
    for (const match of source.matchAll(/\bslug:\s*['"]([^'"]+)['"]/g)) {
      offers.push({
        slug: match[1] ?? 'offer',
        path: 'src/data/offers.ts',
        format: 'typescript',
        editable: false,
        note: 'This is a legacy code-based offer. Ask the agent to migrate it to a content offer before using the editor.',
      });
    }
  }
  return offers.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function findOffer(root: string, slug: string): Promise<OfferRecord> {
  const normalized = slug.trim().toLowerCase();
  const offer = (await listOffers(root)).find((item) => item.slug.toLowerCase() === normalized);
  if (!offer)
    throw new Error(
      `I could not find an offer named “${slug}”. Use list_offers to see the available offers.`
    );
  return offer;
}

function mergeUpdates(
  target: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(updates)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`The field name “${key}” is not allowed.`);
    if (isRecord(value) && isRecord(result[key]))
      result[key] = mergeUpdates(result[key] as Record<string, unknown>, value);
    else result[key] = value;
  }
  return result;
}

export async function updateOffer(
  root: string,
  slug: string,
  updates: Record<string, unknown>
): Promise<OfferRecord> {
  assertSafeObject(updates);
  const offer = await findOffer(root, slug);
  if (!offer.editable) throw new Error(offer.note ?? 'This offer is not safely editable yet.');
  const path = await safeProjectPath(root, offer.path);
  const parsed = await parseOfferFile(path);
  const next = mergeUpdates(parsed.data, updates);
  if (typeof next.slug === 'string' && next.slug !== offer.slug) {
    throw new Error('Changing an offer address is a separate operation. The slug was not changed.');
  }

  const extension = extname(path).toLowerCase();
  let serialized: string;
  if (extension === '.json') serialized = `${JSON.stringify(next, null, 2)}\n`;
  else if (extension === '.yaml' || extension === '.yml')
    serialized = YAML.stringify(next, { lineWidth: 100 });
  else
    serialized = `---\n${YAML.stringify(next, { lineWidth: 100 }).trimEnd()}\n---\n${parsed.body ?? ''}`;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return { ...offer, data: next };
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

function buildOfferDraft(input: CreateFunnelInput): Record<string, unknown> {
  const words = input.headline.trim().split(/\s+/);
  const accent = words.pop() ?? input.headline;
  const lead = words.join(' ') || input.productName;
  const price = money(input.priceAmount, input.currency);
  const bumpPrice = money(input.orderBumpPrice, input.currency);
  return {
    published: false,
    slug: input.slug,
    productName: input.productName,
    eyebrow: 'A focused shortcut to a valuable result',
    headline: lead,
    headlineAccent: accent,
    subheadline: `${input.productName} gives the right buyer a clear starting point, a proven path, and a useful result without the usual setup and guesswork.`,
    metaTitle: `${input.headline} — ${input.productName}`,
    metaDescription: `${input.productName} is a practical system for reaching a useful result faster with less setup and a clearer path forward.`,
    ogImage: '',
    audience:
      'For people who want the promised result and are ready to follow a focused, practical process.',
    checkoutUrl: `/${input.slug}/#checkout`,
    checkout: {
      provider: 'dodo-inline',
      enabled: false,
      eyebrow: 'Secure inline checkout',
      title: 'First, where should we send your access?',
      description: `Enter your best email. We will keep you on this page for checkout and send your ${input.productName} access there after purchase.`,
      emailLabel: 'Email address',
      emailPlaceholder: 'you@company.com',
      buttonLabel: 'Continue to secure checkout',
      summaryDescription: `The complete ${input.productName}, quickstart instructions, and lifetime access.`,
      guaranteeLabel: '30-day guarantee',
      paymentTrustLabel: 'Secure payment',
      consentCopy:
        'By continuing, you agree to receive product access and essential messages about this purchase. You can unsubscribe from optional emails anytime.',
      consentVersion: 'v1',
      bump: {
        title: `Add the ${input.productName} Quickstart Pack`,
        description:
          'Add ready-to-use examples, checklists, and shortcuts that make the first result easier.',
        price: bumpPrice,
        items: [
          'Start with a proven example',
          'Avoid common first-time mistakes',
          'Reach the first useful result faster',
        ],
      },
    },
    demoUrl: '',
    currentPrice: price,
    regularPrice: money(Math.max(input.priceAmount * 3, input.priceAmount), input.currency),
    priceAmount: input.priceAmount,
    currency: input.currency,
    ctaLabel: `Get ${input.productName} for ${price}`,
    ctaNote: 'One payment · lifetime access · 30-day guarantee',
    painTitle: 'The result should not require weeks of setup.',
    painBody:
      'Most people lose momentum before the useful work starts. They collect advice, rebuild the basics, and make decisions with no clear sequence. This offer gives them a shorter path.',
    withoutLabel: 'WITHOUT THIS',
    withoutTitle: 'The slow, frustrating way',
    without: [
      'Start from a blank page',
      'Piece together disconnected advice',
      'Guess what comes next',
      'Spend time on work that does not change the outcome',
    ],
    withLabel: 'WITH THIS',
    withTitle: 'A clearer path to the result',
    with: [
      'Start from a proven structure',
      'Follow one clear sequence',
      'Focus on the work that creates value',
      'Finish a useful result faster',
    ],
    outcomes: [
      {
        title: 'Start faster',
        description: 'Open a clear starting point instead of facing an empty page.',
      },
      {
        title: 'Make fewer decisions',
        description: 'Use an opinionated sequence that keeps the work moving.',
      },
      {
        title: 'Finish something useful',
        description: 'Turn the offer into a concrete outcome you can use immediately.',
      },
    ],
    video: {
      eyebrow: 'See it in action',
      title: 'Watch the shortest path from start to useful result.',
      description:
        'Add a focused two-to-five-minute walkthrough showing the input, the method, and the real result.',
      embedUrl: '',
      fallbackTitle: 'Add the walkthrough before sending paid traffic.',
      fallbackBody:
        'Until the recording is ready, show a real sample or preview instead of pretending a video exists.',
    },
    productPreview: {
      eyebrow: 'What it looks like',
      title: `Show buyers the actual ${input.productName}.`,
      description:
        'Replace this scaffold with the real deliverable, interface, worksheet, template, or before-and-after result.',
      workspaceLabel: input.productName.toUpperCase(),
      productLabel: input.productName,
      productDescription: 'Ready-to-use system',
      navItems: ['Start', 'Build', 'Review', 'Finish'],
      activeNavItem: 'Build',
      activeEyebrow: 'Step / active',
      activeTitle: 'Turn the input into the outcome',
      activeDescription: 'One visible sequence with a clear finish line.',
      statusLabel: 'Ready to use',
      stages: ['Input', 'Method', 'Review', 'Result'],
      panels: [
        { title: 'Clear input', description: 'Tell buyers exactly what they start with.' },
        { title: 'Guided method', description: 'Show the sequence that removes guesswork.' },
        { title: 'Useful output', description: 'Make the finished result easy to picture.' },
      ],
    },
    assistant: {
      eyebrow: 'Built to work with you',
      title: 'Use it with the coding agent you already trust.',
      description:
        'The included context helps your agent understand the system, adapt the offer, and check the finished work.',
      skills: [
        {
          title: 'Quickstart skill',
          description: 'Gets from download to a first useful result without hunting through files.',
        },
        {
          title: 'Implementation skill',
          description: 'Turns a stated goal into the next concrete action or artifact.',
        },
        {
          title: 'Review skill',
          description: 'Checks the result against the offer method before calling it finished.',
        },
      ],
      conversation: [
        {
          speaker: 'You',
          text: `Help me use ${input.productName}. Start with the smallest useful result.`,
        },
        {
          speaker: 'Your agent',
          text: 'I will ask for the minimum input, choose the matching path, and show you the first concrete output before expanding the work.',
        },
      ],
    },
    included: [
      {
        title: `The complete ${input.productName}`,
        description: 'The core system, organized and ready to use.',
      },
      {
        title: 'The quickstart path',
        description: 'A short sequence showing what to do first, second, and third.',
      },
      {
        title: 'Reusable examples',
        description: 'Concrete examples to adapt instead of inventing the structure yourself.',
      },
    ],
    gates: {
      eyebrow: 'Why it works',
      title: 'A simple process catches mistakes before they become expensive.',
      description:
        'Each check asks one plain question and prevents a common class of avoidable error.',
      items: [
        {
          label: '01 / INPUT',
          question: 'Do we have what we need?',
          description: 'Checks the starting information before work begins.',
          catches: 'Missing context and vague goals.',
        },
        {
          label: '02 / FIT',
          question: 'Is this the right path?',
          description: 'Matches the situation to the smallest useful workflow.',
          catches: 'Overbuilding and irrelevant steps.',
        },
        {
          label: '03 / BUILD',
          question: 'Did we follow the method?',
          description: 'Keeps the work in a reliable sequence.',
          catches: 'Skipped steps and hidden gaps.',
        },
        {
          label: '04 / REVIEW',
          question: 'Does the result hold up?',
          description: 'Compares the output with a concrete checklist.',
          catches: 'Plausible work that misses the real goal.',
        },
        {
          label: '05 / FINISH',
          question: 'Can the buyer use it now?',
          description: 'Packages the result with a clear next action.',
          catches: 'Half-finished artifacts and unclear handoffs.',
        },
      ],
    },
    fit: {
      eyebrow: 'Who this is for',
      title: 'Qualify the right buyer. Let the wrong buyer leave.',
      description: 'Specific fit language improves conversion quality and reduces refunds.',
      forYou: [
        'You have the stated problem now.',
        'You will follow a clear sequence and apply it to real work.',
        'You value a reusable system over disconnected tips.',
      ],
      notForYou: [
        'You want the entire result done for you.',
        'You will not supply the required input.',
        'You need a different outcome from the one promised here.',
      ],
    },
    examples: {
      eyebrow: 'Example outcomes',
      title: 'Make the result easy to picture.',
      description: 'Replace these clearly labeled concepts with real examples before publishing.',
      items: [
        {
          label: 'EXAMPLE TO REPLACE',
          title: 'The fastest common use case',
          description: 'Show the most recognizable input, path, and finished output.',
        },
        {
          label: 'EXAMPLE TO REPLACE',
          title: 'A more advanced use case',
          description: 'Show how the system adapts when the buyer has more complexity.',
        },
        {
          label: 'NOT A FIT',
          title: 'The tempting but wrong use case',
          description: 'Disqualify buyers who actually need a different product.',
        },
      ],
    },
    bonuses: [
      {
        title: 'The implementation checklist',
        description: 'A compact checklist for turning the material into a finished result.',
      },
    ],
    proof: [
      {
        value: '1',
        label: 'clear outcome',
        detail: 'The page and product stay focused on one useful result.',
      },
      {
        value: '3',
        label: 'simple steps',
        detail: 'Start, build, and finish without a complicated process.',
      },
      {
        value: '30',
        label: 'days to try it',
        detail: 'Use it on real work and decide with evidence.',
      },
    ],
    guaranteeTitle: 'Try it for 30 days. Keep it only if it helps.',
    guaranteeBody:
      'Use the complete system on a real project. If it does not provide a meaningfully better path to the promised outcome, request a refund within 30 days.',
    faqs: [
      {
        question: `What exactly is ${input.productName}?`,
        answer:
          'It is the complete digital system described on this page, with its supporting examples and quickstart path.',
      },
      {
        question: 'Who is this for?',
        answer:
          'It is for people who value a clear starting point and want the stated outcome without rebuilding the basics.',
      },
      {
        question: 'Is this a subscription?',
        answer: 'No. This draft is configured as a one-time payment with lifetime access.',
      },
      {
        question: 'What if it is not useful for me?',
        answer: 'Request a refund within 30 days under the offer guarantee.',
      },
    ],
    finalTitle: `${input.headline}. Start with the shortcut.`,
    finalBody: `Get ${input.productName}, follow the clear path, and spend your time on the part that creates the result.`,
  };
}

function deliveryProduct(productKey: string, name: string, priceAmount: number, currency: string) {
  return {
    productKey,
    name,
    priceAmount,
    currency,
    deliverySubject: `Your ${name} access`,
    deliveryBody: `Thanks for your purchase. Your ${name} access is ready at the link below.`,
    accessUrl: 'https://example.com/replace-with-your-access-link',
  };
}

function buildFunnelDraft(input: CreateFunnelInput): Record<string, unknown> {
  const bumpName = `${input.productName} Quickstart Pack`;
  const firstName = `${input.productName} Implementation Pack`;
  const secondName = `${input.productName} Complete Bundle`;
  return {
    offerSlug: input.slug,
    supportEmail: 'support@example.com',
    base: deliveryProduct(input.slug, input.productName, input.priceAmount, input.currency),
    bump: {
      key: 'quickstart',
      ...deliveryProduct(
        `${input.slug}-quickstart`,
        bumpName,
        input.orderBumpPrice,
        input.currency
      ),
    },
    upsells: [
      {
        key: 'implementation',
        ...deliveryProduct(
          `${input.slug}-implementation`,
          firstName,
          input.firstUpsellPrice,
          input.currency
        ),
        stepLabel: 'Upgrade 1 of 2',
        eyebrow: 'Make the first result easier',
        title: 'Want the complete implementation pack',
        accent: 'added to your order?',
        description:
          'Add the examples, templates, and implementation shortcuts that remove the next layer of guesswork.',
        price: money(input.firstUpsellPrice, input.currency),
        regularPrice: money(
          Math.max(input.firstUpsellPrice * 2, input.firstUpsellPrice),
          input.currency
        ),
        items: [
          'Detailed implementation path',
          'Ready-to-adapt examples',
          'Review checklist',
          'Lifetime access',
        ],
        acceptLabel: `Yes — add it for ${money(input.firstUpsellPrice, input.currency)}`,
        declineLabel: 'No thanks — continue without this upgrade',
      },
      {
        key: 'complete',
        ...deliveryProduct(
          `${input.slug}-complete`,
          secondName,
          input.secondUpsellPrice,
          input.currency
        ),
        stepLabel: 'Upgrade 2 of 2',
        eyebrow: 'Get the complete system',
        title: 'Want every advanced resource',
        accent: 'included too?',
        description:
          'Add the full advanced pack for buyers who want the most complete path and the fewest remaining decisions.',
        price: money(input.secondUpsellPrice, input.currency),
        regularPrice: money(
          Math.max(input.secondUpsellPrice * 2, input.secondUpsellPrice),
          input.currency
        ),
        items: [
          'Advanced examples',
          'Complete resource library',
          'Launch and review guidance',
          'Lifetime access',
        ],
        acceptLabel: `Yes — add it for ${money(input.secondUpsellPrice, input.currency)}`,
        declineLabel: 'No thanks — finish my order',
      },
    ],
    completion: {
      title: 'You’re in. Everything is attached to your email.',
      description:
        'Your receipt and access instructions will arrive at the email used at checkout.',
      backLabel: `Back to ${input.productName}`,
    },
  };
}

export async function createFunnel(root: string, input: CreateFunnelInput) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new Error('The page address must use lowercase letters, numbers, and single hyphens.');
  }
  if (input.headline.trim().split(/\s+/).length < 2) {
    throw new Error('Use a headline with at least two words.');
  }
  const actualRoot = await realpath(root);
  const offerPath = await safeProjectPath(root, `src/content/offers/${input.slug}.json`);
  const funnelPath = await safeProjectPath(root, `src/content/funnels/${input.slug}.json`);
  if ((await pathExists(offerPath)) || (await pathExists(funnelPath))) {
    throw new Error(`A funnel named “${input.slug}” already exists. Nothing was changed.`);
  }
  await mkdir(dirname(offerPath), { recursive: true });
  await mkdir(dirname(funnelPath), { recursive: true });
  const nonce = randomUUID();
  const offerTemp = `${offerPath}.${nonce}.tmp`;
  const funnelTemp = `${funnelPath}.${nonce}.tmp`;
  let offerCreated = false;
  try {
    await writeFile(offerTemp, `${JSON.stringify(buildOfferDraft(input), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(funnelTemp, `${JSON.stringify(buildFunnelDraft(input), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await link(offerTemp, offerPath);
    offerCreated = true;
    await rm(offerTemp, { force: true });
    await link(funnelTemp, funnelPath);
    await rm(funnelTemp, { force: true });
  } catch (error) {
    await Promise.all([
      rm(offerTemp, { force: true }),
      rm(funnelTemp, { force: true }),
      ...(offerCreated ? [rm(offerPath, { force: true })] : []),
    ]);
    throw error;
  }
  return {
    slug: input.slug,
    offerPath: relative(actualRoot, offerPath),
    funnelPath: relative(actualRoot, funnelPath),
    previewPath: `/${input.slug}/`,
    published: false,
    checkoutEnabled: false,
    nextStep:
      'Replace the clearly labeled draft content, delivery links, and support email. Then connect payments and validate before publishing.',
  };
}

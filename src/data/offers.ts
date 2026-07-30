export interface OfferItem {
  title: string;
  description: string;
}

export interface OfferProof {
  value: string;
  label: string;
  detail: string;
}

export interface OfferFaq {
  question: string;
  answer: string;
}

export interface Offer {
  published: boolean;
  slug: string;
  productName: string;
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  subheadline: string;
  metaTitle: string;
  metaDescription: string;
  ogImage: string;
  audience: string;
  checkoutUrl: string;
  demoUrl: string;
  currentPrice: string;
  regularPrice: string;
  priceAmount: number;
  currency: string;
  ctaLabel: string;
  ctaNote: string;
  painTitle: string;
  painBody: string;
  without: string[];
  with: string[];
  outcomes: OfferItem[];
  included: OfferItem[];
  bonuses: OfferItem[];
  proof: OfferProof[];
  guaranteeTitle: string;
  guaranteeBody: string;
  faqs: OfferFaq[];
  finalTitle: string;
  finalBody: string;
}

const vibeCodeCheckoutUrl =
  import.meta.env.PUBLIC_VIBE_CODE_CHECKOUT_URL ??
  'mailto:tim@keen.digital?subject=Vibe%20Code%20Anything%20%E2%80%94%20template%20access';

const featuredOffers: Offer[] = [
  {
    published: true,
    slug: 'vibe-code-anything',
    productName: 'Maestro SaaS UI Template',
    eyebrow: 'The production-grade starting point for AI-assisted coding',
    headline: 'vibe code',
    headlineAccent: 'anything',
    subheadline:
      'Skip the blank repo. Start with the boring, difficult parts already designed, typed, and gated—then tell your coding agent what you actually want to ship.',
    metaTitle: 'Vibe Code Anything — Maestro SaaS UI Template',
    metaDescription:
      'Build production-grade AI and SaaS apps faster with a full-stack template for tenancy, workflows, agents, typed contracts, provider seams, and CI gates.',
    ogImage: '/og-vibe-code-anything.jpg',
    audience:
      'For founders, consultants, and product builders who want AI coding speed without rebuilding the same app foundations every time.',
    checkoutUrl: vibeCodeCheckoutUrl,
    demoUrl: 'https://maestro-template.pages.dev/',
    currentPrice: '$29',
    regularPrice: '$149',
    priceAmount: 29,
    currency: 'USD',
    ctaLabel: 'Get the full template for $29',
    ctaNote: 'One payment · lifetime access · 30-day guarantee',
    painTitle: 'Vibe coding is fast—until your app has to survive reality.',
    painBody:
      'A blank repo feels liberating for the first hour. Then you hit tenancy, permissions, data contracts, workflows, provider setup, failure states, and deployment proof. Your agent can generate each piece. The expensive part is making every piece agree.',
    without: [
      'Rebuild auth, tenancy, and permissions from scratch',
      'Glue AI workflows to ad-hoc handlers',
      'Let frontend and backend contracts drift',
      'Discover architecture mistakes after the demo',
      'Spend days prompting for invisible plumbing',
    ],
    with: [
      'Swap providers at contained, documented seams',
      'Start with server-derived workspace tenancy',
      'Build on typed workflows and capabilities',
      'Catch drift with deterministic quality gates',
      'Spend your prompts on the product people buy',
    ],
    outcomes: [
      {
        title: 'Start at the product layer',
        description:
          'Open a working SaaS shell instead of an empty folder. Your first prompt can describe the business, not the boilerplate.',
      },
      {
        title: 'Keep AI changes inside the lines',
        description:
          'Repo-native instructions, typed contracts, boundary rules, and review gates give your coding agent a real operating system.',
      },
      {
        title: 'Grow without the rewrite tax',
        description:
          'Tenancy, capabilities, workflows, headless surfaces, and provider adapters are designed as explicit seams from day one.',
      },
    ],
    included: [
      {
        title: 'A real full-stack SaaS shell',
        description:
          'A polished React and SaaS UI application backed by Convex, with a working live-data path and a reviewer-safe reference app.',
      },
      {
        title: 'The architecture AI agents need',
        description:
          'Clear routes, screens, features, blocks, typed specs, domain boundaries, and canonical ownership rules—documented in the repo.',
      },
      {
        title: 'Agents, workflows, and capabilities',
        description:
          'Production-shaped contracts for durable work, agent surfaces, approvals, runs, and headless access through API, CLI, and MCP.',
      },
      {
        title: 'Provider-shaped seams',
        description:
          'Contained adapters for auth, analytics, billing, email, storage, and LLM providers, with fake-safe defaults for local building.',
      },
      {
        title: 'Generators and guided commands',
        description:
          'Initialize a product, add a capability, workflow, agent, or client domain, run a doctor, and create a clean handoff without guessing file placement.',
      },
      {
        title: 'A serious proof system',
        description:
          'Formatting, linting, type checks, tests, boundary checks, security checks, smoke tests, review receipts, and gated deployment paths.',
      },
    ],
    bonuses: [
      {
        title: 'The golden-path build guide',
        description:
          'Follow one business slice from product idea to typed backend contract, live UI, tests, and proof.',
      },
      {
        title: 'The architecture and reviewer packet',
        description:
          'Understand why the system is shaped this way, where to customize it, and how to explain it to a senior reviewer or client.',
      },
      {
        title: 'The delivery receipts',
        description:
          'Concrete evidence paths for what is real, what is intentionally fake-safe, and what must be connected in your product fork.',
      },
    ],
    proof: [
      {
        value: '18+',
        label: 'product surfaces',
        detail: 'Brain, workflows, agents, runs, documents, billing, analytics, admin, and more.',
      },
      {
        value: '1',
        label: 'live full-stack reference app',
        detail: 'A deployed web app reading real data from a deployed Convex backend.',
      },
      {
        value: '3',
        label: 'headless entry points',
        detail: 'API, CLI, and MCP share the same capabilities and workflow contracts.',
      },
      {
        value: 'Every',
        label: 'main-branch push is gated',
        detail: 'Deterministic checks, review gates, staging deploy, and controlled promotion.',
      },
    ],
    guaranteeTitle: 'Build with it for 30 days. Keep it only if it saves you real time.',
    guaranteeBody:
      'Open the template, run the reference app, and use it on a real build. If it does not give you a meaningfully better starting point, email within 30 days for a full refund.',
    faqs: [
      {
        question: 'Is this a course or the actual codebase?',
        answer:
          'It is the actual template codebase, plus the architecture guides, generators, quality gates, and delivery receipts used to work with it. You can inspect and change everything in your copy.',
      },
      {
        question: 'Do I need to know Convex, Effect, or Confect first?',
        answer:
          'No. You can start from the working reference patterns and let your coding agent follow the repo instructions. The deeper architecture is there when your app needs stronger contracts, workflows, and failure handling.',
      },
      {
        question: 'Does it include live authentication and billing?',
        answer:
          'It includes provider-shaped seams and fake-safe local adapters. You choose and connect the live auth, billing, email, analytics, storage, and LLM providers for each product instead of inheriting somebody else’s production accounts.',
      },
      {
        question: 'Which coding agents can I use?',
        answer:
          'The template is designed for repo-aware agents such as Codex and Claude Code. Its instructions, architecture maps, generators, and gates live with the code, so the workflow is not tied to one chat session.',
      },
      {
        question: 'What can I build with it?',
        answer:
          'AI workflow products, vertical SaaS apps, client portals, internal operations tools, agent systems, and other products that need real tenancy, typed data, durable work, and a polished application shell.',
      },
      {
        question: 'Why is the launch price only $29?',
        answer:
          'This is the low-ticket builder launch. The goal is to get the template into the hands of people who will use it on real products, learn what they reach for first, and improve the package quickly.',
      },
      {
        question: 'What if it is too much for my project?',
        answer:
          'Use only the layers you need. The live surface is deliberately thin, providers are swappable, and the docs distinguish real production paths from contract fixtures. You are buying a strong starting point, not a requirement to activate everything.',
      },
    ],
    finalTitle: 'Your next prompt should build the product—not rebuild the foundation.',
    finalBody:
      'Start with a serious app shell, tell your coding agent what the business needs, and move from idea to working software without the blank-repo tax.',
  },
];

const additionalOfferModules = import.meta.glob<{ default: Offer }>('./offers/*.json', {
  eager: true,
});

export const offers: Offer[] = [
  ...featuredOffers,
  ...Object.values(additionalOfferModules).map((module) => module.default),
];

export const publishedOffers = offers.filter((offer) => offer.published);

export function getOffer(slug: string): Offer | undefined {
  return offers.find((offer) => offer.slug === slug);
}

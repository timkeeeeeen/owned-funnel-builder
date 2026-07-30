import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const args = rawArgs.filter((arg) => arg !== '--dry-run');
const [slug, productName, headline] = args;

function fail(message) {
  console.error(`\n${message}\n`);
  console.error('Usage: npm run offer:new -- <slug> "<Product name>" "<Headline>" [--dry-run]\n');
  process.exit(1);
}

if (!slug || !productName || !headline) {
  fail('A slug, product name, and headline are required.');
}

if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
  fail('The slug must use lowercase letters, numbers, and single hyphens.');
}

const headlineWords = headline.trim().split(/\s+/);
if (headlineWords.length < 2) {
  fail('Use a headline with at least two words so the final word can be highlighted.');
}

const headlineAccent = headlineWords.pop();
const headlineLead = headlineWords.join(' ');
const checkoutSubject = encodeURIComponent(`${productName} — access`);

const offer = {
  published: false,
  slug,
  productName,
  eyebrow: 'A low-ticket shortcut for people who want the outcome without the usual setup',
  headline: headlineLead,
  headlineAccent,
  subheadline: `${productName} gives you a clear, practical starting point so you can move from idea to useful result faster.`,
  metaTitle: `${headline} — ${productName}`,
  metaDescription: `${productName} is a focused, low-ticket system for getting to a useful result faster with less setup, less guessing, and a clearer path forward.`,
  ogImage: '',
  audience: `For people who want ${headline.toLowerCase()} without rebuilding the same foundation or piecing together scattered advice.`,
  checkoutUrl: `mailto:tim@keen.digital?subject=${checkoutSubject}`,
  checkout: {
    provider: 'dodo-inline',
    enabled: false,
    eyebrow: 'Secure inline checkout',
    title: 'First, where should we send your access?',
    description: `Enter your best email. We will prefill the secure Dodo checkout, keep you on this page, and send ${productName} access there after purchase.`,
    emailLabel: 'Email address',
    emailPlaceholder: 'you@company.com',
    buttonLabel: 'Continue to secure checkout',
    consentCopy:
      'By continuing, you agree to receive product access and occasional emails about this offer, including a reminder if you leave checkout unfinished. Unsubscribe anytime.',
    consentVersion: 'v1-2026-07-30',
  },
  demoUrl: 'https://maestro-template.pages.dev/',
  currentPrice: '$19',
  regularPrice: '$99',
  priceAmount: 19,
  currency: 'USD',
  ctaLabel: `Get ${productName} for $19`,
  ctaNote: 'One payment · lifetime access · 30-day guarantee',
  painTitle: 'The result should not require weeks of setup.',
  painBody:
    'Most people lose momentum before the useful work starts. They collect advice, rebuild the basics, and make decisions with no clear sequence. This offer gives them a shorter path.',
  without: [
    'Start from a blank page',
    'Piece together disconnected advice',
    'Spend time on work that does not change the outcome',
    'Guess what comes next',
  ],
  with: [
    'Start from a proven structure',
    'Follow one clear sequence',
    'Focus effort on the parts that create value',
    'Move from idea to finished result faster',
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
      'Use this section for a focused two-to-five-minute walkthrough. Show the input, the method, and the finished outcome without a long founder story.',
    embedUrl: '',
    fallbackTitle: 'Add the walkthrough before sending paid traffic.',
    fallbackBody:
      'Until the recording is ready, this card can point to a real demo, sample, or preview instead of pretending a video exists.',
  },
  productPreview: {
    eyebrow: 'What it looks like',
    title: `Show buyers the actual ${productName}.`,
    description:
      'Replace this scaffold with the real deliverable, interface, worksheet, template, or before-and-after result. Concrete previews beat another paragraph of claims.',
    workspaceLabel: productName.toUpperCase(),
    productLabel: productName,
    productDescription: 'Ready-to-use system',
    navItems: ['Start', 'Build', 'Review', 'Finish'],
    activeNavItem: 'Build',
    activeEyebrow: 'Step / active',
    activeTitle: 'Turn the input into the outcome',
    activeDescription: 'One visible sequence with a clear finish line.',
    statusLabel: 'Ready to use',
    stages: ['Input', 'Method', 'Review', 'Result'],
    panels: [
      {
        title: 'Clear input',
        description: 'Tell buyers exactly what they start with.',
      },
      {
        title: 'Guided method',
        description: 'Show the sequence that removes guesswork.',
      },
      {
        title: 'Useful output',
        description: 'Make the finished result easy to picture.',
      },
    ],
  },
  assistant: {
    eyebrow: 'Built to work with you',
    title: 'Explain how the buyer uses it in plain English.',
    description:
      'Use this block when the offer includes prompts, skills, automations, or an assistant. Show the actual exchange and name the reusable capabilities.',
    skills: [
      {
        title: 'Quickstart skill',
        description:
          'Gets the buyer from download to first useful result without hunting through files.',
      },
      {
        title: 'Implementation skill',
        description: 'Turns a stated goal into the next concrete action or artifact.',
      },
      {
        title: 'Review skill',
        description:
          'Checks the result against the offer method before the buyer calls it finished.',
      },
      {
        title: 'Adaptation skill',
        description: 'Helps customize the system for a different audience, project, or constraint.',
      },
    ],
    conversation: [
      {
        speaker: 'You',
        text: `Help me use ${productName} for my project. Start with the smallest useful result.`,
      },
      {
        speaker: productName,
        text: 'I will ask for the minimum input, choose the matching path, and show you the first concrete output before expanding the work.',
      },
    ],
  },
  included: [
    {
      title: `The complete ${productName}`,
      description: 'The core system, organized and ready to use.',
    },
    {
      title: 'The quickstart path',
      description: 'A short sequence that shows you what to do first, second, and third.',
    },
    {
      title: 'Reusable examples',
      description: 'Concrete examples you can adapt instead of inventing the structure yourself.',
    },
  ],
  gates: {
    eyebrow: 'Why it works',
    title: 'Turn the method into five checks anyone can understand.',
    description:
      'Use gates to explain why the buyer gets a more reliable result. Each gate asks one plain question and catches one expensive class of mistake.',
    items: [
      {
        label: '01 / INPUT',
        question: 'Do we have what we need?',
        description:
          'Checks the starting information before the buyer wastes time on the wrong path.',
        catches: 'Missing context, vague goals, and the wrong starting material.',
      },
      {
        label: '02 / FIT',
        question: 'Is this the right path?',
        description: 'Matches the situation to the smallest useful workflow or example.',
        catches: 'Overbuilding, irrelevant steps, and one-size-fits-all advice.',
      },
      {
        label: '03 / BUILD',
        question: 'Did we follow the method?',
        description: 'Keeps the work in sequence so important pieces are not skipped.',
        catches: 'Random tactics, premature polish, and hidden gaps.',
      },
      {
        label: '04 / REVIEW',
        question: 'Does the result hold up?',
        description:
          'Compares the output with a concrete checklist before it is considered finished.',
        catches: 'Plausible-looking work that misses the actual goal.',
      },
      {
        label: '05 / FINISH',
        question: 'Can the buyer use it now?',
        description: 'Packages the final output with a clear next action.',
        catches: 'Half-finished artifacts and advice with no handoff.',
      },
    ],
  },
  fit: {
    eyebrow: 'Who this is for',
    title: 'Qualify the right buyer. Let the wrong buyer leave.',
    description:
      'Specific fit language improves conversion quality and reduces refunds. Replace these lines with the real prerequisites and disqualifiers for the offer.',
    forYou: [
      'You have the stated problem now and want a focused shortcut.',
      'You are willing to follow a clear sequence and apply it to real work.',
      'You value a reusable system more than another pile of disconnected tips.',
    ],
    notForYou: [
      'You want the result done completely for you.',
      'You are not willing to supply the required input or make basic decisions.',
      'You need a different outcome from the one promised on this page.',
    ],
  },
  examples: {
    eyebrow: 'Example outcomes',
    title: 'Make the result easy to picture.',
    description:
      'Use real examples when possible. Label concepts honestly so a good-fit buyer can recognize their own use case without mistaking an idea for proof.',
    items: [
      {
        label: 'EXAMPLE TO REPLACE',
        title: 'The fastest common use case',
        description: 'Show the most recognizable input, path, and finished output.',
      },
      {
        label: 'EXAMPLE TO REPLACE',
        title: 'A more advanced use case',
        description: 'Show how the same system adapts when the buyer has more complexity.',
      },
      {
        label: 'EXAMPLE TO REPLACE',
        title: 'A narrow specialist use case',
        description: 'Help a qualified niche buyer see that the offer still fits.',
      },
      {
        label: 'NOT A FIT',
        title: 'The tempting but wrong use case',
        description: 'Use one example to disqualify buyers who need a different product.',
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
      detail: 'Start, build, and finish without a complicated funnel.',
    },
    {
      value: '30',
      label: 'days to try it',
      detail: 'Use it on real work and decide with evidence.',
    },
  ],
  guaranteeTitle: 'Try it for 30 days. Keep it only if it helps.',
  guaranteeBody:
    'Use the complete system on a real project. If it does not give you a meaningfully better path to the outcome, email within 30 days for a full refund.',
  faqs: [
    {
      question: `What exactly is ${productName}?`,
      answer:
        'It is the complete digital system described on this page, delivered with the supporting examples and quickstart path.',
    },
    {
      question: 'Who is this for?',
      answer:
        'It is for people who value a clear starting point and want to reach the stated outcome without rebuilding the basics.',
    },
    {
      question: 'Is this a subscription?',
      answer:
        'No. The launch offer is a one-time payment with lifetime access to the purchased materials.',
    },
    {
      question: 'What if it is not useful for me?',
      answer: 'Email within 30 days of purchase for a full refund under the offer guarantee.',
    },
  ],
  finalTitle: `${headline}. Start with the shortcut.`,
  finalBody: `Get ${productName}, follow the clear path, and spend your time on the part that actually creates the result.`,
};

const output = `${JSON.stringify(offer, null, 2)}\n`;
const offersDirectory = resolve('src/data/offers');
const outputPath = resolve(offersDirectory, `${slug}.json`);

if (dryRun) {
  process.stdout.write(output);
  process.exit(0);
}

if (existsSync(outputPath)) {
  fail(`An offer file already exists at ${outputPath}.`);
}

mkdirSync(offersDirectory, { recursive: true });
writeFileSync(outputPath, output, 'utf8');

console.log(`\nCreated ${outputPath}`);
console.log(`Preview locally at /${slug}/`);
console.log(
  'Edit the copy, optional sections, price, guarantee, checkout fallback, proof, and social image.'
);
console.log(`Dodo product secret: DODO_PRODUCT_${slug.toUpperCase().replaceAll('-', '_')}`);
console.log('Set "published" to true only when the offer is ready for a production build.\n');

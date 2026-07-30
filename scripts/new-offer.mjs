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
console.log('Edit the copy, price, guarantee, checkout URL, proof, and social image.');
console.log('Set "published" to true only when the offer is ready for a production build.\n');

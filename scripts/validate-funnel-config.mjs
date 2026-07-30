import { access, readdir, readFile } from 'node:fs/promises';

const offerFiles = (await readdir('src/content/offers')).filter((file) => file.endsWith('.json'));
const funnelFiles = (await readdir('src/content/funnels')).filter((file) => file.endsWith('.json'));
const offers = await Promise.all(
  offerFiles.map(async (file) => JSON.parse(await readFile(`src/content/offers/${file}`, 'utf8')))
);
const funnels = await Promise.all(
  funnelFiles.map(async (file) => JSON.parse(await readFile(`src/content/funnels/${file}`, 'utf8')))
);
const site = JSON.parse(await readFile('src/content/site.json', 'utf8'));
const publishing = process.argv.includes('--publish');

const problems = [];
const offerSlugs = new Set(offers.map((offer) => offer.slug));
for (const offer of offers) {
  if (!funnels.some((funnel) => funnel.offerSlug === offer.slug)) {
    problems.push(`${offer.slug}: add a matching checkout funnel.`);
  }
  if (offer.published && !offer.checkout?.enabled) {
    problems.push(`${offer.slug}: checkout is turned off on a published page.`);
  }
  if (offer.published && offer.ogImage) {
    try {
      await access(`public/${offer.ogImage.replace(/^\/+/, '')}`);
    } catch {
      problems.push(`${offer.slug}: the social sharing image does not exist.`);
    }
  }
}

if (publishing && /@example\.com$/i.test(site.supportEmail ?? '')) {
  problems.push('site settings: replace the example support email.');
}

const productKeys = new Set();
const stepKeys = new Set();
for (const funnel of funnels) {
  const offer = offers.find((item) => item.slug === funnel.offerSlug);
  if (!offerSlugs.has(funnel.offerSlug)) {
    problems.push(`${funnel.offerSlug}: checkout has no matching landing page.`);
  }
  if (!Array.isArray(funnel.upsells) || funnel.upsells.length > 2) {
    problems.push(`${funnel.offerSlug}: use no more than two one-click upsells.`);
  }
  const products = [funnel.base, ...(funnel.bump ? [funnel.bump] : []), ...funnel.upsells];
  for (const product of products) {
    if (productKeys.has(product.productKey)) {
      problems.push(`${product.productKey}: product keys must be unique.`);
    }
    productKeys.add(product.productKey);
    if (!Number.isFinite(product.priceAmount) || product.priceAmount < 0) {
      problems.push(`${product.productKey}: enter a valid price.`);
    }
    if (!/^https:\/\//.test(product.accessUrl ?? '')) {
      problems.push(`${product.productKey}: add a secure customer access link.`);
    } else if (
      publishing &&
      offer?.published &&
      new URL(product.accessUrl).hostname === 'example.com'
    ) {
      problems.push(`${product.productKey}: replace the example customer access link.`);
    }
  }
  if (
    offer &&
    (offer.priceAmount !== funnel.base.priceAmount || offer.currency !== funnel.base.currency)
  ) {
    problems.push(`${funnel.offerSlug}: landing-page and checkout prices must match.`);
  }
  if (publishing && offer?.published && /@example\.com$/i.test(funnel.supportEmail ?? '')) {
    problems.push(`${funnel.offerSlug}: replace the example support email.`);
  }
  for (const step of funnel.upsells) {
    if (stepKeys.has(step.key)) problems.push(`${step.key}: upsell page keys must be unique.`);
    stepKeys.add(step.key);
  }
}

if (problems.length) {
  console.error('The funnel needs a few fixes before publishing:\n');
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exitCode = 1;
} else {
  console.log(
    `Funnel configuration is ready: ${offers.length} page(s), ${productKeys.size} product(s).`
  );
}

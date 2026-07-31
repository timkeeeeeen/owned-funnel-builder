import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BLUEPRINT_AUDIENCE_SLUGS,
  blueprintAudiences,
  blueprintProductContract,
  getBlueprintAudience,
} from '../../src/data/blueprint-offers.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const readRepositoryFile = (path: string) =>
  readFile(new URL(path, `file://${repositoryRoot}/`), 'utf8');

test('one shared paid product serves four unique audience variants', () => {
  assert.equal(BLUEPRINT_AUDIENCE_SLUGS.length, 4);
  assert.equal(new Set(BLUEPRINT_AUDIENCE_SLUGS).size, 4);
  assert.deepEqual(BLUEPRINT_AUDIENCE_SLUGS, [
    'agency-owners',
    'consultants',
    'coaches',
    'solo-experts',
  ]);
  assert.equal(blueprintProductContract.sharedProductKey, 'cmo-game-plan');
  assert.equal(getBlueprintAudience('not-a-real-audience'), undefined);
});

test('the free and paid scores are independent, complete, non-additive instruments', () => {
  const { authoritySnapshot: snapshot, gamePlan } = blueprintProductContract;
  const snapshotCriteria = snapshot.dimensions.flatMap((dimension) => dimension.criteria);
  const paidCriteria = gamePlan.dimensions.flatMap((dimension) => dimension.criteria);

  assert.equal(snapshot.scoreName, 'Visible Authority Score');
  assert.equal(gamePlan.scoreName, 'Authority System Score');

  assert.equal(snapshot.dimensions.length, snapshot.dimensionCount);
  assert.equal(snapshotCriteria.length, snapshot.criterionCount);
  assert.equal(new Set(snapshotCriteria).size, snapshotCriteria.length);
  assert.ok(snapshot.dimensions.every((dimension) => dimension.criteria.length === 4));
  assert.equal(snapshot.dimensionCount * 4 * snapshot.criterionMaximum, snapshot.scoreMaximum);

  assert.equal(gamePlan.dimensions.length, gamePlan.dimensionCount);
  assert.equal(paidCriteria.length, gamePlan.criterionCount);
  assert.equal(new Set(paidCriteria).size, paidCriteria.length);
  assert.ok(gamePlan.dimensions.every((dimension) => dimension.criteria.length === 4));
  assert.equal(gamePlan.dimensionCount * 4 * gamePlan.criterionMaximum, gamePlan.scoreMaximum);

  assert.notDeepEqual(snapshot.dimensions, gamePlan.dimensions.slice(0, 2));
  assert.match(snapshot.instrumentBoundary, /does not score the systems/i);
  assert.ok(gamePlan.completionRules.some((rule) => /separate instrument/i.test(rule)));
  assert.ok(gamePlan.completionRules.some((rule) => /never added/i.test(rule)));
});

test('synthetic score examples add up and label missing scope honestly', () => {
  const sample = blueprintProductContract.illustrativeSample;
  assert.equal(
    sample.snapshotDimensions.reduce((sum, dimension) => sum + dimension.score, 0),
    sample.snapshotScore
  );
  assert.equal(
    sample.paidDimensions.reduce((sum, dimension) => sum + dimension.score, 0),
    sample.paidScore
  );
  assert.deepEqual(
    sample.snapshotDimensions.map((dimension) => dimension.label),
    blueprintProductContract.authoritySnapshot.dimensions.map((dimension) => dimension.label)
  );
  assert.deepEqual(
    sample.paidDimensions.map((dimension) => dimension.label),
    blueprintProductContract.gamePlan.dimensions.map((dimension) => dimension.label)
  );
  assert.notEqual(sample.snapshotScore + sample.paidScore, sample.paidScore);
  assert.match(sample.note, /synthetic/i);
  assert.match(sample.note, /not (?:a real )?customer results?/i);
});

test('every audience demonstrates the complete shared output shape', () => {
  const headlines = new Set<string>();

  for (const slug of BLUEPRINT_AUDIENCE_SLUGS) {
    const audience = blueprintAudiences[slug];
    assert.equal(audience.slug, slug);
    assert.equal(audience.exampleEvidence.length, 5);
    assert.equal(
      audience.examplePriorities.length,
      blueprintProductContract.gamePlan.priorityCount
    );
    assert.equal(audience.exampleSlots.length, blueprintProductContract.gamePlan.slotCount);
    assert.equal(new Set(audience.exampleSlots).size, audience.exampleSlots.length);
    assert.equal(audience.exampleQuestions.length, 3);
    assert.ok(audience.examplePostBody.length > 200);
    assert.ok(!headlines.has(audience.gamePlanHeadline));
    headlines.add(audience.gamePlanHeadline);
  }
});

test('price and downstream scope cannot drift silently', () => {
  const { gamePlan, activation } = blueprintProductContract;
  assert.equal(gamePlan.priceAmount, 5);
  assert.equal(gamePlan.currency, 'USD');
  assert.equal(gamePlan.weekCount * 5, gamePlan.slotCount);
  assert.equal(gamePlan.retainedDraftCount, 5);
  assert.equal(gamePlan.ctaLabel, 'Get my full Game Plan — $5');
  assert.match(gamePlan.auditExpectation, /10 minutes/i);
  assert.match(gamePlan.auditExpectation, /no subscription or sales call/i);
  assert.equal(activation.amountMinor, 9_900);
  assert.equal(activation.firstInvoiceCreditMinor, gamePlan.priceAmount * 100);
  assert.equal(activation.remainingPostCount + gamePlan.retainedDraftCount, gamePlan.slotCount);
  assert.equal(activation.optional, true);
  assert.match(blueprintProductContract.commercialTerms.delivery, /five-chapter audit/i);
  assert.match(blueprintProductContract.commercialTerms.includedRevision, /one resumable/i);
  assert.match(blueprintProductContract.commercialTerms.support, /two business days/i);
  assert.match(blueprintProductContract.commercialTerms.refund, /seven calendar days/i);
  assert.match(blueprintProductContract.commercialTerms.retainedAccess, /exported at any time/i);
});

test('proof and examples carry adjacent truth boundaries', () => {
  assert.match(blueprintProductContract.proofDisclaimer, /earlier agency programs/i);
  assert.match(blueprintProductContract.proofDisclaimer, /not results from the new/i);
  assert.match(blueprintProductContract.proofDisclaimer, /no similar outcome is promised/i);
  assert.ok(blueprintProductContract.proof.length > 0);
  assert.ok(blueprintProductContract.testimonials.length > 0);
  assert.ok(blueprintProductContract.launchGates.some((gate) => /permission/i.test(gate)));
});

test('acceptance-preview route components cannot submit or open checkout', async () => {
  const pageFiles = [
    'src/components/blueprint/AuthoritySnapshotPage.astro',
    'src/components/blueprint/GamePlanPage.astro',
    'src/components/blueprint/SnapshotThankYouPage.astro',
    'src/pages/blueprint/asset.astro',
  ];

  for (const path of pageFiles) {
    const source = await readRepositoryFile(path);
    assert.match(source, /data-acceptance-cta/);
    assert.match(source, /disabled/);
    assert.match(source, /noindex=\{true\}/);
    assert.doesNotMatch(source, /OfferCheckoutDialog/);
    assert.doesNotMatch(source, /\/api\/checkout/);
  }
});

test('all audience route families and quality checks are declared', async () => {
  const routeFiles = [
    'src/pages/authority-snapshot/index.astro',
    'src/pages/authority-snapshot/[audience].astro',
    'src/pages/authority-snapshot/[audience]/thank-you.astro',
    'src/pages/cmo-game-plan/index.astro',
    'src/pages/cmo-game-plan/[audience].astro',
    'src/pages/blueprint/asset.astro',
    'src/pages/blueprint/checkout/return.astro',
  ];
  await Promise.all(routeFiles.map((path) => readRepositoryFile(path)));

  const qualityConfig = JSON.parse(await readRepositoryFile('quality.config.json')) as {
    routes: Array<{ route: string }>;
  };
  const configuredRoutes = new Set(qualityConfig.routes.map((route) => route.route));

  for (const slug of BLUEPRINT_AUDIENCE_SLUGS) {
    assert.ok(configuredRoutes.has(`/authority-snapshot/${slug}`));
    assert.ok(configuredRoutes.has(`/authority-snapshot/${slug}/thank-you`));
    assert.ok(configuredRoutes.has(`/cmo-game-plan/${slug}`));
  }
  assert.ok(configuredRoutes.has('/blueprint/asset'));
  assert.ok(configuredRoutes.has('/blueprint/checkout/return'));
});

test('audience navigation preserves paid-ad and opaque journey attribution', async () => {
  const source = await readRepositoryFile('src/components/blueprint/PreserveAttribution.astro');
  for (const key of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gclid',
    'fbclid',
    'ttclid',
    'msclkid',
    'journey_id',
  ]) {
    assert.match(source, new RegExp(`['"]${key}['"]`));
  }
  assert.doesNotMatch(source, /email/i);
});

test('the live bridge remains a thin client of canonical Maestro authorities', async () => {
  const [runtime, client, thankYou, scorecard, draftPreview] = await Promise.all([
    readRepositoryFile('src/components/blueprint/BlueprintFunnelRuntime.astro'),
    readRepositoryFile('src/scripts/blueprint-funnel-client.ts'),
    readRepositoryFile('src/components/blueprint/SnapshotThankYouPage.astro'),
    readRepositoryFile('src/components/blueprint/BlueprintScorecard.astro'),
    readRepositoryFile('src/components/blueprint/DraftPreview.astro'),
  ]);

  assert.match(runtime, /PUBLIC_BLUEPRINT_FUNNEL_ENABLED/);
  assert.match(runtime, /blueprintProductContract\.status/);
  assert.match(runtime, /PUBLIC_MAESTRO_CONVEX_URL/);
  assert.match(runtime, /PUBLIC_MAESTRO_APP_URL/);
  assert.match(runtime, /PUBLIC_TURNSTILE_SITE_KEY/);

  for (const path of [
    'capabilities/leadMagnets/publicPersonalizations:start',
    'capabilities/leadMagnets/personalizations:watchPersonalization',
    'capabilities/billing/blueprintCheckoutStarts:start',
    'capabilities/billing/blueprintPurchases:getCheckoutStatus',
    'capabilities/leadMagnets/personalizationDelivery:readAsset',
  ]) {
    assert.match(client, new RegExp(path.replaceAll('/', '\\/')));
  }
  assert.match(client, /cmo-game-plan-direct/);
  assert.match(client, /authority-snapshot/);
  assert.match(client, /publicSessionToken/);
  assert.match(client, /sessionStorage/);
  assert.match(client, /blueprint:return:claim-token/);
  assert.match(client, /\/blueprint\/claim/);
  assert.match(client, /history\.replaceState/);
  assert.match(client, /result\.authoritySnapshot/);
  assert.match(client, /snapshot\.findings/);
  assert.match(client, /item\.evidenceRefs/);
  assert.match(client, /result\.posts/);
  assert.match(client, /result\.postOutcomes/);
  assert.match(client, /value\.questionsLeft/);
  assert.match(thankYou, /data-blueprint-findings/);
  assert.match(thankYou, /plan\.auditExpectation/);
  assert.match(thankYou, /commercialTerms\.refund/);
  assert.match(scorecard, /data-blueprint-score/);
  assert.match(thankYou, /<DraftPreview/);
  assert.match(draftPreview, /data-blueprint-draft-body/);
  assert.match(draftPreview, /data-blueprint-draft-questions/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /innerHTML/);
  assert.doesNotMatch(client, /localStorage/);
  assert.doesNotMatch(client, /\/api\/checkout/);
  assert.doesNotMatch(client, /DODO_PAYMENTS_API_KEY/);
});

test('buyer-facing proof leads with real experience and keeps the new-product boundary', async () => {
  const [snapshotPage, gamePlanPage, proofStrip, proofSection] = await Promise.all([
    readRepositoryFile('src/components/blueprint/AuthoritySnapshotPage.astro'),
    readRepositoryFile('src/components/blueprint/GamePlanPage.astro'),
    readRepositoryFile('src/components/blueprint/ExperienceProofStrip.astro'),
    readRepositoryFile('src/components/blueprint/PriorExperienceProof.astro'),
  ]);

  assert.match(snapshotPage, /<ExperienceProofStrip \/>/);
  assert.match(gamePlanPage, /<ExperienceProofStrip \/>/);
  assert.match(proofStrip, /blueprintProductContract\.proof/);
  assert.match(proofStrip, /not claimed as results from this new\s+product/i);
  assert.match(proofSection, /They are not results from these new products/i);
  assert.doesNotMatch(proofSection, /candidate credentials|verification required|bright line/i);
});

test('privacy and terms cover personalized generation without weakening review responsibility', async () => {
  const [privacy, terms] = await Promise.all([
    readRepositoryFile('src/pages/privacy.astro'),
    readRepositoryFile('src/pages/terms.astro'),
  ]);

  assert.match(privacy, /Personalized AI products/);
  assert.match(privacy, /email addresses are not placed in result URLs/i);
  assert.match(privacy, /Nothing is published to LinkedIn\s+automatically/i);
  assert.match(terms, /personalized reports, plans,\s+drafts/i);
  assert.match(terms, /checking facts, permissions, claims, and final\s+copy/i);
  assert.match(terms, /commercialTerms\.refund/);
  assert.match(privacy, /commercialTerms\.retainedAccess/);
});

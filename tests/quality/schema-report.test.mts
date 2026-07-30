import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUALITY_SCHEMA_VERSION,
  QUALITY_TOOL_VERSION,
  type FreshnessResult,
  type SmokeReceipt,
} from '../../tooling/quality/contracts.mts';
import { formatFreshnessReport, formatSmokeReport } from '../../tooling/quality/report.mts';
import { parseSmokeReceipt } from '../../tooling/quality/schema.mts';

function receipt(): SmokeReceipt {
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    toolVersion: QUALITY_TOOL_VERSION,
    createdAt: new Date(0).toISOString(),
    buildFingerprint: 'a'.repeat(64),
    configFingerprint: 'b'.repeat(64),
    passed: false,
    routes: [
      {
        route: '/offer',
        profile: 'mobile',
        title: 'Offer',
        horizontalOverflow: 24,
        pageErrors: ['The page is 24px wider than the screen'],
        consoleErrors: [],
        resourceErrors: [],
        accessibilityViolations: [],
        primaryCta: {
          kind: 'external',
          selector: '[data-primary-cta]',
          found: 1,
          passed: false,
          errors: ['The primary action should open an external destination'],
        },
        passed: false,
      },
    ],
  };
}

test('runtime receipt validation rejects structurally weak evidence', () => {
  assert.deepEqual(parseSmokeReceipt(receipt()), receipt());
  assert.throws(
    () => parseSmokeReceipt({ ...receipt(), buildFingerprint: 'not-a-hash' }),
    /SHA-256/
  );
});

test('reports browser and stale-evidence failures in nontechnical language', () => {
  const smoke = formatSmokeReport(receipt());
  assert.match(smoke, /Quality check found problems/);
  assert.match(smoke, /Main button/);
  const freshness: FreshnessResult = {
    passed: false,
    problems: [{ route: '/offer', message: 'The built page changed' }],
  };
  assert.match(formatFreshnessReport(freshness), /screenshots were captured|built page changed/i);
  assert.match(formatFreshnessReport(freshness), /capture command again/i);
});

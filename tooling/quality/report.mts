import type { FreshnessResult, SmokeReceipt } from './contracts.mts';

export function formatSmokeReport(receipt: SmokeReceipt): string {
  const lines = [
    receipt.passed
      ? `Quality check passed for ${receipt.routes.length} page and screen-size combinations.`
      : `Quality check found problems in ${receipt.routes.filter((route) => !route.passed).length} page and screen-size combinations.`,
  ];
  for (const route of receipt.routes.filter((item) => !item.passed)) {
    lines.push(`\n${route.route} on ${route.profile}:`);
    for (const error of route.pageErrors) lines.push(`- Page: ${error}`);
    for (const error of route.consoleErrors) lines.push(`- Browser: ${error}`);
    for (const error of route.resourceErrors) lines.push(`- Resource: ${error}`);
    for (const violation of route.accessibilityViolations) {
      lines.push(
        `- Accessibility: ${violation.description} (${violation.nodes} affected element${violation.nodes === 1 ? '' : 's'})`
      );
    }
    for (const error of route.primaryCta?.errors ?? []) lines.push(`- Main button: ${error}`);
  }
  return lines.join('\n');
}

export function formatFreshnessReport(result: FreshnessResult): string {
  if (result.passed) return 'Screenshot evidence is complete and matches the current built site.';
  return [
    'Screenshot evidence is missing or out of date:',
    ...result.problems.map((problem) => {
      const subject = problem.route ?? problem.path;
      return `- ${subject ? `${subject}: ` : ''}${problem.message}`;
    }),
    'Run the capture command again after fixing the site.',
  ].join('\n');
}

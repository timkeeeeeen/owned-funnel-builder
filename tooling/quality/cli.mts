#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { captureQualityEvidence } from './capture.mts';
import { loadQualityConfig, resolveQualityRoutes } from './config.mts';
import { verifyEvidenceFreshness } from './freshness.mts';
import { formatFreshnessReport, formatSmokeReport } from './report.mts';
import { runBrowserSmoke } from './smoke.mts';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function context() {
  const configPath = resolve(argument('--config') ?? 'quality.config.json');
  const config = await loadQualityConfig(configPath);
  const distDirectory = resolve(config.distDirectory ?? 'dist/client');
  const evidenceDirectory = resolve(config.evidenceDirectory ?? 'quality-evidence');
  const routes = await resolveQualityRoutes(config, distDirectory);
  return { config, configPath, distDirectory, evidenceDirectory, routes };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['discover', 'smoke', 'capture', 'verify'].includes(command)) {
    throw new Error('Use: quality <discover|smoke|capture|verify> [--config quality.config.json]');
  }
  const state = await context();
  if (command === 'discover') {
    process.stdout.write(
      `${state.routes.map((route) => `${route.route} (${route.profiles?.join(', ')})`).join('\n')}\n`
    );
    return;
  }
  if (command === 'smoke') {
    const receipt = await runBrowserSmoke({
      distDirectory: state.distDirectory,
      routes: state.routes,
    });
    await mkdir(state.evidenceDirectory, { recursive: true });
    await writeFile(
      resolve(state.evidenceDirectory, 'latest-smoke-receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`
    );
    process.stdout.write(`${formatSmokeReport(receipt)}\n`);
    if (!receipt.passed) process.exitCode = 1;
    return;
  }
  if (command === 'capture') {
    const manifest = await captureQualityEvidence({
      distDirectory: state.distDirectory,
      evidenceDirectory: state.evidenceDirectory,
      routes: state.routes,
      maxFullPageHeight: state.config.maxFullPageHeight,
      maxImageBytes: state.config.maxImageBytes,
    });
    process.stdout.write(
      `Saved ${manifest.routes.flatMap((route) => route.captures).length} current screenshots for ${manifest.routes.length} pages.\n`
    );
    return;
  }
  const result = await verifyEvidenceFreshness({
    manifestPath: resolve(state.evidenceDirectory, 'capture-manifest.json'),
    distDirectory: state.distDirectory,
    routes: state.routes,
  });
  process.stdout.write(`${formatFreshnessReport(result)}\n`);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `Quality check could not run: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});

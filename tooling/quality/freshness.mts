import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { configFingerprint } from './config.mts';
import type {
  CaptureManifest,
  FreshnessProblem,
  FreshnessResult,
  QualityRouteConfig,
} from './contracts.mts';
import { computeRouteBuildFingerprint, sha256 } from './fingerprint.mts';
import { pngDimensions } from './png.mts';
import { parseCaptureManifest, parseSmokeReceipt } from './schema.mts';

export interface VerifyEvidenceOptions {
  manifestPath: string;
  distDirectory: string;
  routes: readonly QualityRouteConfig[];
}

async function problemForCapture(
  capture: CaptureManifest['routes'][number]['captures'][number]
): Promise<FreshnessProblem[]> {
  const problems: FreshnessProblem[] = [];
  const path = resolve(process.cwd(), capture.path);
  try {
    const content = await readFile(path);
    const fileStat = await stat(path);
    const dimensions = pngDimensions(content);
    if (sha256(content) !== capture.sha256)
      problems.push({ path: capture.path, message: 'The screenshot bytes changed after capture' });
    if (fileStat.size !== capture.byteSize)
      problems.push({
        path: capture.path,
        message: 'The screenshot file size no longer matches its manifest',
      });
    if (dimensions.width !== capture.width || dimensions.height !== capture.height)
      problems.push({
        path: capture.path,
        message: 'The screenshot dimensions no longer match its manifest',
      });
  } catch (error) {
    problems.push({
      path: capture.path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return problems;
}

export async function verifyEvidenceFreshness(
  options: VerifyEvidenceOptions
): Promise<FreshnessResult> {
  const problems: FreshnessProblem[] = [];
  let manifest: CaptureManifest;
  try {
    manifest = parseCaptureManifest(JSON.parse(await readFile(options.manifestPath, 'utf8')));
  } catch (error) {
    return {
      passed: false,
      problems: [
        {
          message: `The capture manifest cannot be trusted: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const expectedConfig = configFingerprint(options.routes);
  if (manifest.configFingerprint !== expectedConfig) {
    problems.push({
      message: 'The route or CTA configuration changed after screenshots were captured',
    });
  }
  const configuredRoutes = new Set(options.routes.map((route) => route.route));
  const capturedRoutes = new Set(manifest.routes.map((route) => route.route));
  for (const route of configuredRoutes) {
    if (!capturedRoutes.has(route))
      problems.push({ route, message: 'This page has no captured evidence' });
  }
  for (const route of manifest.routes) {
    if (!configuredRoutes.has(route.route)) {
      problems.push({
        route: route.route,
        message: 'This evidence belongs to a page no longer in the quality configuration',
      });
      continue;
    }
    try {
      const current = computeRouteBuildFingerprint(options.distDirectory, route.route).fingerprint;
      if (current !== route.buildFingerprint) {
        problems.push({
          route: route.route,
          message: 'The built page changed after screenshots were captured',
        });
      }
    } catch (error) {
      problems.push({
        route: route.route,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const routeConfig = options.routes.find((candidate) => candidate.route === route.route);
    if (routeConfig) {
      const expected = new Set(
        (routeConfig.profiles ?? ['desktop', 'tablet', 'mobile']).flatMap((profile) =>
          (routeConfig.captures ?? ['first-fold', 'full-page']).map((kind) => `${profile}:${kind}`)
        )
      );
      const actual = new Set(route.captures.map((capture) => `${capture.profile}:${capture.kind}`));
      for (const combination of expected) {
        if (!actual.has(combination)) {
          problems.push({
            route: route.route,
            message: `The ${combination.replace(':', ' ')} screenshot is missing`,
          });
        }
      }
      if (actual.size !== route.captures.length) {
        problems.push({
          route: route.route,
          message: 'The screenshot manifest contains duplicate entries',
        });
      }
      for (const capture of route.captures) {
        if (capture.route !== route.route) {
          problems.push({
            path: capture.path,
            message: 'The screenshot is assigned to the wrong page',
          });
        }
      }
    }
    for (const capture of route.captures) problems.push(...(await problemForCapture(capture)));
  }
  try {
    const smoke = parseSmokeReceipt(
      JSON.parse(await readFile(resolve(process.cwd(), manifest.smokeReceiptPath), 'utf8'))
    );
    if (!smoke.passed)
      problems.push({ message: 'The browser checks recorded with these screenshots did not pass' });
    if (smoke.configFingerprint !== manifest.configFingerprint)
      problems.push({
        message: 'The browser receipt and screenshot manifest used different configuration',
      });
    const expectedCombined = sha256(
      [...manifest.routes]
        .sort((left, right) => left.route.localeCompare(right.route))
        .map((route) => `${route.route}\0${route.buildFingerprint}`)
        .join('\n')
    );
    if (smoke.buildFingerprint !== expectedCombined)
      problems.push({ message: 'The browser receipt and screenshots came from different builds' });
  } catch (error) {
    problems.push({
      message: `The browser receipt cannot be trusted: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return { passed: problems.length === 0, problems };
}

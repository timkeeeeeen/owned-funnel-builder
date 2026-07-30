import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type Page } from 'playwright';

import { controlledContextOptions, prepareStablePage } from './browser.mts';
import { configFingerprint } from './config.mts';
import {
  QUALITY_SCHEMA_VERSION,
  QUALITY_TOOL_VERSION,
  type QualityRouteConfig,
  type SmokeReceipt,
  type SmokeRouteResult,
  type ViewportName,
} from './contracts.mts';
import { checkPrimaryCta } from './cta.mts';
import { sha256, computeRouteBuildFingerprint } from './fingerprint.mts';
import { startStaticServer } from './static-server.mts';

export interface SmokeOptions {
  distDirectory: string;
  routes: readonly QualityRouteConfig[];
  browser?: Browser;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ignored(url: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(url);
    } catch {
      return url.includes(pattern);
    }
  });
}

function routePassed(result: SmokeRouteResult): boolean {
  return (
    result.pageErrors.length === 0 &&
    result.consoleErrors.length === 0 &&
    result.resourceErrors.length === 0 &&
    result.accessibilityViolations.length === 0 &&
    result.horizontalOverflow <= 1 &&
    (result.primaryCta?.passed ?? true)
  );
}

async function inspectRoute(
  browser: Browser,
  origin: string,
  route: QualityRouteConfig,
  profile: ViewportName
): Promise<SmokeRouteResult> {
  const context = await browser.newContext(controlledContextOptions(profile));
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const resourceErrors: string[] = [];
  const ignorePatterns = route.ignoreResourcePatterns ?? [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (!ignored(request.url(), ignorePatterns)) {
      resourceErrors.push(
        `${request.resourceType()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`
      );
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !ignored(response.url(), ignorePatterns)) {
      resourceErrors.push(
        `${response.request().resourceType()} ${response.url()}: HTTP ${response.status()}`
      );
    }
  });

  let title = '';
  let horizontalOverflow = 0;
  let accessibilityViolations: SmokeRouteResult['accessibilityViolations'] = [];
  let primaryCta: SmokeRouteResult['primaryCta'];
  try {
    const response = await page.goto(`${origin}${route.route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    if (!response?.ok()) {
      pageErrors.push(
        `The page returned ${response?.status() ?? 'no response'} instead of a successful response`
      );
    }
    await prepareStablePage(page);
    title = await page.title();
    if (!title.trim()) pageErrors.push('The browser title is missing');
    const semantics = await page.evaluate(() => ({
      language: document.documentElement.lang,
      mainCount: document.querySelectorAll('main').length,
      headingCount: document.querySelectorAll('h1').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    horizontalOverflow = Math.max(0, semantics.overflow);
    if (!semantics.language.trim()) pageErrors.push('The page language is missing');
    if (semantics.mainCount !== 1) {
      pageErrors.push(`Expected one main content area, found ${semantics.mainCount}`);
    }
    if (semantics.headingCount !== 1) {
      pageErrors.push(`Expected one main headline, found ${semantics.headingCount}`);
    }
    if (horizontalOverflow > 1) {
      pageErrors.push(`The page is ${horizontalOverflow}px wider than the screen`);
    }
    const axe = await new AxeBuilder({ page }).analyze();
    accessibilityViolations = axe.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        description: violation.description,
        nodes: violation.nodes.length,
      }));
    if (route.primaryCta) primaryCta = await checkPrimaryCta(page, route.primaryCta);
  } catch (error) {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
  const result: SmokeRouteResult = {
    route: route.route,
    profile,
    title,
    horizontalOverflow,
    pageErrors: unique(pageErrors),
    consoleErrors: unique(consoleErrors),
    resourceErrors: unique(resourceErrors),
    accessibilityViolations,
    ...(primaryCta && { primaryCta }),
    passed: false,
  };
  result.passed = routePassed(result);
  return result;
}

function combinedFingerprint(distDirectory: string, routes: readonly QualityRouteConfig[]): string {
  return sha256(
    [...routes]
      .sort((left, right) => left.route.localeCompare(right.route))
      .map(
        (route) =>
          `${route.route}\0${computeRouteBuildFingerprint(distDirectory, route.route).fingerprint}`
      )
      .join('\n')
  );
}

export async function runBrowserSmoke(options: SmokeOptions): Promise<SmokeReceipt> {
  if (options.routes.length === 0) throw new Error('Browser checks need at least one route');
  const server = await startStaticServer(options.distDirectory);
  const ownedBrowser = options.browser ? undefined : await chromium.launch({ headless: true });
  const browser = options.browser ?? ownedBrowser;
  if (!browser) throw new Error('The browser could not start');
  try {
    const results: SmokeRouteResult[] = [];
    for (const route of options.routes) {
      for (const profile of route.profiles ?? ['desktop', 'tablet', 'mobile']) {
        results.push(await inspectRoute(browser, server.origin, route, profile));
      }
    }
    const missing = await fetch(`${server.origin}/__quality_missing__`);
    if (missing.status !== 404) {
      results[0]?.resourceErrors.push(
        `The local preview returned ${missing.status} for a page that does not exist`
      );
      if (results[0]) results[0].passed = false;
    }
    return {
      schemaVersion: QUALITY_SCHEMA_VERSION,
      toolVersion: QUALITY_TOOL_VERSION,
      createdAt: new Date().toISOString(),
      buildFingerprint: combinedFingerprint(options.distDirectory, options.routes),
      configFingerprint: configFingerprint(options.routes),
      routes: results,
      passed: results.every((result) => result.passed),
    };
  } finally {
    await ownedBrowser?.close();
    await server.close();
  }
}

export function browserPageForTesting(page: Page): Page {
  return page;
}

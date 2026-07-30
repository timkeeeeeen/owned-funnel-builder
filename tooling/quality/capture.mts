import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { chromium } from 'playwright';

import { controlledContextOptions, playwrightVersion, prepareStablePage } from './browser.mts';
import { configFingerprint } from './config.mts';
import {
  QUALITY_SCHEMA_VERSION,
  QUALITY_TOOL_VERSION,
  VIEWPORTS,
  type CaptureEntry,
  type CaptureManifest,
  type QualityRouteConfig,
  type RouteEvidence,
} from './contracts.mts';
import { computeRouteBuildFingerprint, sha256 } from './fingerprint.mts';
import { pngDimensions } from './png.mts';
import { runBrowserSmoke } from './smoke.mts';
import { startStaticServer } from './static-server.mts';

export interface CaptureOptions {
  distDirectory: string;
  evidenceDirectory: string;
  routes: readonly QualityRouteConfig[];
  maxFullPageHeight?: number;
  maxImageBytes?: number;
}

function portablePath(path: string): string {
  return path.split(sep).join('/');
}

function routeDirectory(route: string): string {
  if (route === '/') return 'home';
  return route
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replaceAll('/', '__');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function replaceDirectory(temporary: string, destination: string): Promise<void> {
  const backup = `${destination}.backup-${randomUUID()}`;
  let hadDestination = false;
  try {
    try {
      await rename(destination, backup);
      hadDestination = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temporary, destination);
    if (hadDestination) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadDestination) {
      await rm(destination, { recursive: true, force: true });
      await rename(backup, destination);
    }
    throw error;
  }
}

export async function captureQualityEvidence(options: CaptureOptions): Promise<CaptureManifest> {
  const destination = resolve(options.evidenceDirectory);
  const temporary = join(dirname(destination), `.quality-partial-${randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  try {
    const smoke = await runBrowserSmoke({
      distDirectory: options.distDirectory,
      routes: options.routes,
    });
    if (!smoke.passed) {
      throw new Error('Browser checks found problems. Fix them before recording screenshots.');
    }
    await writeJson(join(temporary, 'smoke-receipt.json'), smoke);
    const server = await startStaticServer(options.distDirectory);
    const browser = await chromium.launch({ headless: true });
    const chromiumVersion = browser.version();
    const routeEvidence: RouteEvidence[] = [];
    try {
      for (const route of options.routes) {
        const captures: CaptureEntry[] = [];
        const folder = join(temporary, routeDirectory(route.route));
        await mkdir(folder, { recursive: true });
        for (const profile of route.profiles ?? ['desktop', 'tablet', 'mobile']) {
          for (const kind of route.captures ?? ['first-fold', 'full-page']) {
            const context = await browser.newContext(controlledContextOptions(profile));
            const page = await context.newPage();
            try {
              const response = await page.goto(`${server.origin}${route.route}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15_000,
              });
              if (!response?.ok()) throw new Error(`${route.route} did not load for capture`);
              await prepareStablePage(page);
              const fullPage = kind === 'full-page';
              if (fullPage) {
                const height = await page.evaluate(() =>
                  Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)
                );
                if (height > (options.maxFullPageHeight ?? 30_000)) {
                  throw new Error(
                    `${route.route} is ${height}px tall; the capture limit is ${options.maxFullPageHeight ?? 30_000}px`
                  );
                }
              }
              const fileName = `${profile}-${kind}.png`;
              const absolute = join(folder, fileName);
              const buffer = await page.screenshot({
                path: absolute,
                type: 'png',
                fullPage,
                animations: 'disabled',
                caret: 'hide',
                scale: 'css',
              });
              const fileStat = await stat(absolute);
              if (fileStat.size > (options.maxImageBytes ?? 12_000_000)) {
                throw new Error(`${fileName} is larger than the allowed screenshot size`);
              }
              const dimensions = pngDimensions(buffer);
              if (dimensions.width !== VIEWPORTS[profile].width) {
                throw new Error(`${fileName} has the wrong width`);
              }
              if (!fullPage && dimensions.height !== VIEWPORTS[profile].height) {
                throw new Error(`${fileName} has the wrong first-fold height`);
              }
              const finalPath = join(destination, routeDirectory(route.route), fileName);
              captures.push({
                route: route.route,
                profile,
                kind,
                path: portablePath(relative(process.cwd(), finalPath)),
                width: dimensions.width,
                height: dimensions.height,
                byteSize: fileStat.size,
                sha256: sha256(buffer),
              });
            } finally {
              await context.close();
            }
          }
        }
        routeEvidence.push({
          route: route.route,
          buildFingerprint: computeRouteBuildFingerprint(options.distDirectory, route.route)
            .fingerprint,
          captures,
        });
      }
    } finally {
      await browser.close();
      await server.close();
    }
    const capturedBuildFingerprint = sha256(
      [...routeEvidence]
        .sort((left, right) => left.route.localeCompare(right.route))
        .map((route) => `${route.route}\0${route.buildFingerprint}`)
        .join('\n')
    );
    if (capturedBuildFingerprint !== smoke.buildFingerprint) {
      throw new Error(
        'The built site changed between browser checks and screenshots. Build once, then capture again.'
      );
    }
    const manifest: CaptureManifest = {
      schemaVersion: QUALITY_SCHEMA_VERSION,
      toolVersion: QUALITY_TOOL_VERSION,
      capturedAt: new Date().toISOString(),
      playwrightVersion: playwrightVersion(),
      chromiumVersion,
      configFingerprint: configFingerprint(options.routes),
      distDirectory: portablePath(relative(process.cwd(), resolve(options.distDirectory))),
      smokeReceiptPath: portablePath(
        relative(process.cwd(), join(destination, 'smoke-receipt.json'))
      ),
      environment: {
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      },
      routes: routeEvidence,
    };
    await writeJson(join(temporary, 'capture-manifest.json'), manifest);
    await mkdir(dirname(destination), { recursive: true });
    await replaceDirectory(temporary, destination);
    await readFile(join(destination, 'capture-manifest.json'), 'utf8');
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

import { createRequire } from 'node:module';

import type { Page } from 'playwright';

import { VIEWPORTS, type ViewportName } from './contracts.mts';

const require = createRequire(import.meta.url);

export function playwrightVersion(): string {
  const packageJson = require('playwright/package.json') as { version: string };
  return packageJson.version;
}

export function controlledContextOptions(profile: ViewportName) {
  return {
    viewport: VIEWPORTS[profile],
    deviceScaleFactor: 1,
    locale: 'en-US' as const,
    timezoneId: 'UTC' as const,
    colorScheme: 'light' as const,
    reducedMotion: 'reduce' as const,
    serviceWorkers: 'block' as const,
  };
}

export async function prepareStablePage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(100);
}

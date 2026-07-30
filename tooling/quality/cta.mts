import type { Locator, Page } from 'playwright';

import {
  DEFAULT_CHECKOUT_READY_SELECTOR,
  DEFAULT_CTA_SELECTOR,
  type CtaCheckResult,
  type PrimaryCtaConfig,
} from './contracts.mts';

function exactDestination(actual: URL, expected: string, pageOrigin: string): boolean {
  const wanted = new URL(expected, pageOrigin);
  if (wanted.origin !== pageOrigin) return actual.href === wanted.href;
  return actual.pathname === wanted.pathname && actual.search === wanted.search;
}

async function visibleFocus(locator: Locator): Promise<boolean> {
  await locator.focus();
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      element.matches(':focus-visible') &&
      ((style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== 'none')
    );
  });
}

export async function checkPrimaryCta(
  page: Page,
  config: PrimaryCtaConfig
): Promise<CtaCheckResult> {
  const selector = config.selector ?? DEFAULT_CTA_SELECTOR;
  const result: CtaCheckResult = {
    kind: config.kind,
    selector,
    found: 0,
    passed: false,
    errors: [],
  };
  const ctas = page.locator(selector);
  result.found = await ctas.count();
  if (result.found === 0) {
    result.errors.push(`No primary action matched ${selector}`);
    return result;
  }
  const cta = ctas.first();
  if (!(await cta.isVisible())) result.errors.push('The primary action is not visible');
  result.label = (await cta.getAttribute('aria-label')) ?? (await cta.innerText()).trim();
  if (!result.label) result.errors.push('The primary action has no readable label');
  result.keyboardFocusVisible = await visibleFocus(cta);
  if (!result.keyboardFocusVisible) {
    result.errors.push('The primary action has no visible keyboard focus');
  }

  const href = await cta.getAttribute('href');
  if (href) {
    const destination = new URL(href, page.url());
    result.destination = destination.href;
    const pageOrigin = new URL(page.url()).origin;
    if (config.kind === 'internal' && destination.origin !== pageOrigin) {
      result.errors.push('The primary action should stay on this site, but points elsewhere');
    }
    if (config.kind === 'external' && destination.origin === pageOrigin) {
      result.errors.push('The primary action should open an external destination');
    }
    if (
      config.expectedDestination &&
      !exactDestination(destination, config.expectedDestination, pageOrigin)
    ) {
      result.errors.push(
        `The primary action points to ${destination.href}, not ${config.expectedDestination}`
      );
    }
    if (config.allowedOrigins?.length && !config.allowedOrigins.includes(destination.origin)) {
      result.errors.push(`The destination ${destination.origin} is not an approved origin`);
    }
  } else if (config.kind !== 'checkout') {
    result.errors.push('The primary action is missing its destination link');
  }

  if (config.kind === 'checkout') {
    const hasMarker = await cta.evaluate((element) =>
      [
        'data-checkout-trigger',
        'data-checkout-url',
        'data-dodo-checkout',
        'data-offer-checkout-trigger',
      ].some((attribute) => element.hasAttribute(attribute))
    );
    if (!href && !hasMarker) {
      result.errors.push('The checkout action needs a checkout data attribute or a checkout link');
    }
    if (config.activate) {
      const readySelector = config.readySelector ?? DEFAULT_CHECKOUT_READY_SELECTOR;
      result.readySelector = readySelector;
      try {
        await cta.click();
        await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 5_000 });
        result.activated = true;
      } catch {
        result.activated = false;
        result.errors.push(
          `The checkout action did not reveal ${readySelector} within five seconds`
        );
      }
    }
  }
  result.passed = result.errors.length === 0;
  return result;
}

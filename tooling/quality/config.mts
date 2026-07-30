import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import {
  DEFAULT_CAPTURES,
  DEFAULT_PROFILES,
  type CaptureKind,
  type CtaKind,
  type QualityConfig,
  type QualityRouteConfig,
  type ViewportName,
} from './contracts.mts';

const PROFILE_NAMES = new Set<ViewportName>(['desktop', 'tablet', 'mobile']);
const CAPTURE_KINDS = new Set<CaptureKind>(['first-fold', 'full-page']);
const CTA_KINDS = new Set<CtaKind>(['internal', 'external', 'checkout']);

function normalizedRoute(value: string): string {
  const pathname = new URL(value, 'https://quality.invalid').pathname;
  const route = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return route === '/' ? route : `${route}/`.replace(/\/$/, '');
}

function assertStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a list of text values`);
  }
  return value;
}

function parseRoute(value: unknown, index: number): QualityRouteConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`routes[${index}] must be an object`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.route !== 'string' || !input.route.startsWith('/')) {
    throw new Error(`routes[${index}].route must begin with /`);
  }
  const profiles = assertStringArray(input.profiles, `routes[${index}].profiles`);
  if (profiles?.some((item) => !PROFILE_NAMES.has(item as ViewportName))) {
    throw new Error(`routes[${index}].profiles contains an unknown viewport`);
  }
  const captures = assertStringArray(input.captures, `routes[${index}].captures`);
  if (captures?.some((item) => !CAPTURE_KINDS.has(item as CaptureKind))) {
    throw new Error(`routes[${index}].captures contains an unknown capture kind`);
  }

  let primaryCta: QualityRouteConfig['primaryCta'];
  if (input.primaryCta !== undefined) {
    if (!input.primaryCta || typeof input.primaryCta !== 'object') {
      throw new Error(`routes[${index}].primaryCta must be an object`);
    }
    const cta = input.primaryCta as Record<string, unknown>;
    if (typeof cta.kind !== 'string' || !CTA_KINDS.has(cta.kind as CtaKind)) {
      throw new Error(`routes[${index}].primaryCta.kind must be internal, external, or checkout`);
    }
    for (const field of ['selector', 'expectedDestination', 'readySelector'] as const) {
      if (cta[field] !== undefined && typeof cta[field] !== 'string') {
        throw new Error(`routes[${index}].primaryCta.${field} must be text`);
      }
    }
    if (cta.activate !== undefined && typeof cta.activate !== 'boolean') {
      throw new Error(`routes[${index}].primaryCta.activate must be true or false`);
    }
    primaryCta = {
      kind: cta.kind as CtaKind,
      ...(typeof cta.selector === 'string' && { selector: cta.selector }),
      ...(typeof cta.expectedDestination === 'string' && {
        expectedDestination: cta.expectedDestination,
      }),
      ...(assertStringArray(cta.allowedOrigins, `routes[${index}].primaryCta.allowedOrigins`) && {
        allowedOrigins: cta.allowedOrigins as string[],
      }),
      ...(typeof cta.activate === 'boolean' && { activate: cta.activate }),
      ...(typeof cta.readySelector === 'string' && {
        readySelector: cta.readySelector,
      }),
    };
  }

  return {
    route: normalizedRoute(input.route),
    ...(typeof input.name === 'string' && { name: input.name }),
    profiles: (profiles as ViewportName[] | undefined) ?? [...DEFAULT_PROFILES],
    captures: (captures as CaptureKind[] | undefined) ?? [...DEFAULT_CAPTURES],
    ...(primaryCta && { primaryCta }),
    ...(assertStringArray(
      input.ignoreResourcePatterns,
      `routes[${index}].ignoreResourcePatterns`
    ) && { ignoreResourcePatterns: input.ignoreResourcePatterns as string[] }),
  };
}

export function parseQualityConfig(value: unknown): QualityConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Quality configuration must be an object');
  }
  const input = value as Record<string, unknown>;
  const routes = input.routes;
  if (routes !== undefined && !Array.isArray(routes)) {
    throw new Error('routes must be a list');
  }
  const parsed: QualityConfig = {
    ...(typeof input.distDirectory === 'string' && {
      distDirectory: input.distDirectory,
    }),
    ...(typeof input.evidenceDirectory === 'string' && {
      evidenceDirectory: input.evidenceDirectory,
    }),
    ...(routes && { routes: routes.map(parseRoute) }),
    ...(assertStringArray(input.excludeRoutes, 'excludeRoutes') && {
      excludeRoutes: input.excludeRoutes as string[],
    }),
  };
  for (const field of ['maxFullPageHeight', 'maxImageBytes'] as const) {
    const value = input[field];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) <= 0)) {
      throw new Error(`${field} must be a positive whole number`);
    }
    if (typeof value === 'number') parsed[field] = value;
  }
  return parsed;
}

export async function loadQualityConfig(path: string): Promise<QualityConfig> {
  const raw = await readFile(path, 'utf8');
  try {
    return parseQualityConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Could not read ${path}: invalid JSON`, { cause: error });
    }
    throw error;
  }
}

async function walk(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function fileToRoute(root: string, file: string): string | undefined {
  if (extname(file) !== '.html') return undefined;
  let route = relative(root, file).split(sep).join('/');
  if (route === '404.html') return undefined;
  route = route.replace(/index\.html$/, '').replace(/\.html$/, '');
  return normalizedRoute(route);
}

function matchesRoutePattern(route: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '::DOUBLE_STAR::')
    .replaceAll('*', '[^/]*')
    .replaceAll('::DOUBLE_STAR::', '.*');
  return new RegExp(`^${escaped}$`).test(route);
}

export async function discoverBuiltRoutes(
  distDirectory: string,
  excludeRoutes: readonly string[] = []
): Promise<QualityRouteConfig[]> {
  const root = resolve(distDirectory);
  const routes = (await walk(root))
    .map((file) => fileToRoute(root, file))
    .filter((route): route is string => Boolean(route))
    .filter((route) => !excludeRoutes.some((pattern) => matchesRoutePattern(route, pattern)));
  return [...new Set(routes)].sort().map((route) => ({
    route,
    profiles: [...DEFAULT_PROFILES],
    captures: [...DEFAULT_CAPTURES],
  }));
}

export async function resolveQualityRoutes(
  config: QualityConfig,
  distDirectory: string
): Promise<QualityRouteConfig[]> {
  const routes = config.routes?.length
    ? config.routes
    : await discoverBuiltRoutes(distDirectory, config.excludeRoutes);
  if (routes.length === 0) {
    throw new Error(
      'No pages were found. Build the site first or list routes in the quality configuration.'
    );
  }
  const duplicates = routes
    .map((route) => route.route)
    .filter((route, index, all) => all.indexOf(route) !== index);
  if (duplicates.length) throw new Error(`Duplicate route: ${duplicates[0]}`);
  return routes;
}

export function configFingerprint(routes: readonly QualityRouteConfig[]): string {
  const canonical = JSON.stringify(
    [...routes].sort((left, right) => left.route.localeCompare(right.route))
  );
  return createHash('sha256').update(canonical).digest('hex');
}

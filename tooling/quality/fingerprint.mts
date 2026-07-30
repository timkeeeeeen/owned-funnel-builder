import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

export interface FingerprintedFile {
  path: string;
  sha256: string;
}

export interface RouteBuildFingerprint {
  fingerprint: string;
  files: FingerprintedFile[];
}

export function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function routeCandidates(root: string, route: string): string[] {
  const pathname = new URL(route, 'https://quality.invalid').pathname;
  const base = resolve(root, pathname.replace(/^\/+/, ''));
  if (!isInside(root, base)) return [];
  if (extname(base)) return [base];
  return [`${base}.html`, resolve(base, 'index.html')];
}

export function resolveBuiltRouteFile(rootDirectory: string, route: string): string {
  const root = resolve(rootDirectory);
  for (const candidate of routeCandidates(root, route)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`No built HTML file found for ${route}`);
}

function referencesFor(file: string, content: string): string[] {
  const extension = extname(file).toLowerCase();
  const references = new Set<string>();
  const addMatches = (pattern: RegExp) => {
    for (const match of content.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) references.add(value);
    }
  };
  if (extension === '.html') {
    addMatches(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    addMatches(/srcset\s*=\s*["']([^"']+)["']/gi);
  } else if (extension === '.css') {
    addMatches(/url\(\s*["']?([^"')]+)["']?\s*\)/gi);
    addMatches(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi);
  } else if (['.js', '.mjs'].includes(extension)) {
    addMatches(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g);
    addMatches(/import\(\s*["']([^"']+)["']\s*\)/g);
  }
  return [...references];
}

function localReference(root: string, fromFile: string, raw: string): string | undefined {
  const reference = raw.trim().split(/\s+/)[0] ?? '';
  if (
    !reference ||
    reference.startsWith('#') ||
    reference.startsWith('data:') ||
    reference.startsWith('mailto:') ||
    reference.startsWith('tel:') ||
    reference.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(reference)
  )
    return undefined;
  let pathname: string;
  try {
    pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0] ?? '');
  } catch {
    return undefined;
  }
  const candidate = pathname.startsWith('/')
    ? resolve(root, pathname.replace(/^\/+/, ''))
    : resolve(dirname(fromFile), pathname);
  return isInside(root, candidate) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : undefined;
}

export function computeRouteBuildFingerprint(
  rootDirectory: string,
  route: string
): RouteBuildFingerprint {
  const root = resolve(rootDirectory);
  const pending = [resolveBuiltRouteFile(root, route)];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!['.html', '.css', '.js', '.mjs'].includes(extname(file).toLowerCase())) continue;
    const content = readFileSync(file, 'utf8');
    for (const raw of referencesFor(file, content)) {
      for (const candidate of raw.split(',')) {
        const dependency = localReference(root, file, candidate);
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
    }
  }
  const files = [...visited]
    .map((file) => ({
      path: relative(root, file).split(sep).join('/'),
      sha256: sha256(readFileSync(file)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    fingerprint: sha256(files.map((file) => `${file.path}\0${file.sha256}`).join('\n')),
    files,
  };
}

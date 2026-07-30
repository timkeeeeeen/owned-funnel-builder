import { mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { pathExists, safeProjectPath } from './project.js';

const OFFER_DIRECTORIES = ['content/offers', 'src/content/offers', 'src/data/offers'];
const EDITABLE_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.md', '.mdx']);
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface OfferRecord {
  slug: string;
  path: string;
  format: string;
  editable: boolean;
  data?: Record<string, unknown>;
  note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeObject(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`The field name “${key}” is not allowed.`);
    if (isRecord(child)) assertSafeObject(child);
  }
}

function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  if (!source.startsWith('---\n')) return { data: {}, body: source };
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('The offer has an unfinished frontmatter section.');
  const parsed = YAML.parse(source.slice(4, end));
  if (!isRecord(parsed)) throw new Error('The offer frontmatter must contain named fields.');
  return { data: parsed, body: source.slice(end + 5) };
}

async function parseOfferFile(path: string): Promise<{ data: Record<string, unknown>; body?: string }> {
  const source = await readFile(path, 'utf8');
  const extension = extname(path).toLowerCase();
  if (extension === '.json') {
    const parsed: unknown = JSON.parse(source);
    if (!isRecord(parsed)) throw new Error('The offer file must contain named fields.');
    return { data: parsed };
  }
  if (extension === '.yaml' || extension === '.yml') {
    const parsed: unknown = YAML.parse(source);
    if (!isRecord(parsed)) throw new Error('The offer file must contain named fields.');
    return { data: parsed };
  }
  return parseFrontmatter(source);
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(path)));
    else if (entry.isFile() && EDITABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) results.push(path);
  }
  return results;
}

function slugFrom(path: string, data: Record<string, unknown>): string {
  if (typeof data.slug === 'string' && data.slug.trim()) return data.slug.trim();
  const name = basename(path, extname(path));
  return name === 'index' || name === 'offer' ? basename(dirname(path)) : name;
}

export async function listOffers(root: string): Promise<OfferRecord[]> {
  const actualRoot = await realpath(root);
  const offers: OfferRecord[] = [];
  for (const relativeDir of OFFER_DIRECTORIES) {
    const dir = await safeProjectPath(root, relativeDir);
    if (!(await pathExists(dir))) continue;
    for (const file of await walk(dir)) {
      try {
        const parsed = await parseOfferFile(file);
        offers.push({
          slug: slugFrom(file, parsed.data),
          path: relative(actualRoot, file),
          format: extname(file).slice(1),
          editable: true,
          data: parsed.data,
        });
      } catch (error) {
        offers.push({
          slug: basename(file, extname(file)),
          path: relative(actualRoot, file),
          format: extname(file).slice(1),
          editable: false,
          note: error instanceof Error ? error.message : 'This file could not be read.',
        });
      }
    }
  }

  const legacy = join(root, 'src/data/offers.ts');
  if (offers.length === 0 && (await pathExists(legacy))) {
    const source = await readFile(legacy, 'utf8');
    for (const match of source.matchAll(/\bslug:\s*['"]([^'"]+)['"]/g)) {
      offers.push({
        slug: match[1] ?? 'offer',
        path: 'src/data/offers.ts',
        format: 'typescript',
        editable: false,
        note: 'This is a legacy code-based offer. Ask the agent to migrate it to a content offer before using the editor.',
      });
    }
  }
  return offers.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function findOffer(root: string, slug: string): Promise<OfferRecord> {
  const normalized = slug.trim().toLowerCase();
  const offer = (await listOffers(root)).find((item) => item.slug.toLowerCase() === normalized);
  if (!offer) throw new Error(`I could not find an offer named “${slug}”. Use list_offers to see the available offers.`);
  return offer;
}

function mergeUpdates(target: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(updates)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`The field name “${key}” is not allowed.`);
    if (isRecord(value) && isRecord(result[key])) result[key] = mergeUpdates(result[key] as Record<string, unknown>, value);
    else result[key] = value;
  }
  return result;
}

export async function updateOffer(
  root: string,
  slug: string,
  updates: Record<string, unknown>
): Promise<OfferRecord> {
  assertSafeObject(updates);
  const offer = await findOffer(root, slug);
  if (!offer.editable) throw new Error(offer.note ?? 'This offer is not safely editable yet.');
  const path = await safeProjectPath(root, offer.path);
  const parsed = await parseOfferFile(path);
  const next = mergeUpdates(parsed.data, updates);
  if (typeof next.slug === 'string' && next.slug !== offer.slug) {
    throw new Error('Changing an offer address is a separate operation. The slug was not changed.');
  }

  const extension = extname(path).toLowerCase();
  let serialized: string;
  if (extension === '.json') serialized = `${JSON.stringify(next, null, 2)}\n`;
  else if (extension === '.yaml' || extension === '.yml') serialized = YAML.stringify(next, { lineWidth: 100 });
  else serialized = `---\n${YAML.stringify(next, { lineWidth: 100 }).trimEnd()}\n---\n${parsed.body ?? ''}`;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return { ...offer, data: next };
}

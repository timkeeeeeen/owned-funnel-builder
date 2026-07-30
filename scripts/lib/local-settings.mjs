import { readFile, writeFile } from 'node:fs/promises';

export async function readLocalSettings(pathname = '.dev.vars') {
  try {
    const source = await readFile(pathname, 'utf8');
    return Object.fromEntries(
      source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const separator = line.indexOf('=');
          const key = line.slice(0, separator).trim();
          const raw = line.slice(separator + 1).trim();
          try {
            return [key, JSON.parse(raw)];
          } catch {
            return [key, raw];
          }
        })
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeLocalSettings(settings, pathname = '.dev.vars') {
  const source =
    Object.entries(settings)
      .filter(([, value]) => typeof value === 'string' && value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n';
  await writeFile(pathname, source, { mode: 0o600 });
}

export function requireSetting(settings, key) {
  const value = settings[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Setup is missing ${key}. Open the setup screen and save it first.`);
  }
  return value.trim();
}

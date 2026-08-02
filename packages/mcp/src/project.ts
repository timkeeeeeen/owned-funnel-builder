import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const SECRET_NAME = /(secret|token|password|private|api[_-]?key|credential|dodo|stripe|postmark)/i;

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(start = process.cwd()): Promise<string> {
  const configured = process.env.FUNNEL_PROJECT_ROOT?.trim();
  let current = resolve(configured || start);

  while (true) {
    if (
      (await pathExists(join(current, 'package.json'))) &&
      ((await pathExists(join(current, 'astro.config.mjs'))) ||
        (await pathExists(join(current, 'astro.config.ts'))))
    ) {
      return realpath(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        'I could not find the funnel project. Open the funnel folder first, or set FUNNEL_PROJECT_ROOT to that folder.'
      );
    }
    current = parent;
  }
}

export function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

export async function safeProjectPath(root: string, relativePath: string): Promise<string> {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('That file location is not allowed.');
  }
  const actualRoot = await realpath(root);
  const candidate = resolve(actualRoot, relativePath);
  if (!isInside(actualRoot, candidate)) {
    throw new Error('That file is outside this funnel project.');
  }

  let existing = candidate;
  while (!(await pathExists(existing))) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const actualParent = await realpath(existing);
  if (!isInside(actualRoot, actualParent)) {
    throw new Error('That file passes through a link outside this funnel project.');
  }
  if (await pathExists(candidate)) {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      const actual = await realpath(candidate);
      if (!isInside(actualRoot, actual)) {
        throw new Error('That file points outside this funnel project.');
      }
    }
  }
  return candidate;
}

export interface CommandResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  summary: string;
  timedOut: boolean;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SECRET_NAME.test(name))
  );
}

export function redactOutput(value: string): string {
  return value
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[hidden]')
    .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[hidden]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}/g, '[hidden credential]')
    .slice(-6_000);
}

export async function runProjectCommand(
  root: string,
  executable: string,
  args: readonly string[],
  timeoutMs = 120_000
): Promise<CommandResult> {
  const command = [executable, ...args].join(' ');
  return new Promise((resolveResult) => {
    const child = spawn(executable, [...args], {
      cwd: root,
      env: safeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 30_000) output = output.slice(-30_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveResult({ command, ok: false, exitCode: null, timedOut, summary: error.message });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const cleaned = redactOutput(output).trim();
      resolveResult({
        command,
        ok: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        summary: timedOut
          ? 'The check took too long and was stopped.'
          : cleaned || (exitCode === 0 ? 'Passed.' : 'Failed without a message.'),
      });
    });
  });
}

export async function readPackageScripts(root: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  return Object.fromEntries(
    Object.entries(parsed.scripts ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

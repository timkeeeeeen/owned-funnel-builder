import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface RunningStaticServer {
  origin: string;
  close: () => Promise<void>;
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function resolveFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const direct = resolve(root, decoded.replace(/^[/\\]+/, '') || 'index.html');
  if (!isInside(root, direct)) return undefined;
  const candidates = extname(direct)
    ? [direct]
    : [direct, `${direct}.html`, join(direct, 'index.html')];
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const canonical = realpathSync(candidate);
    if (isInside(root, canonical)) return canonical;
  }
  return undefined;
}

export async function startStaticServer(directory: string): Promise<RunningStaticServer> {
  const requestedRoot = resolve(directory);
  if (!existsSync(requestedRoot) || !statSync(requestedRoot).isDirectory()) {
    throw new Error(`Built site directory does not exist: ${requestedRoot}`);
  }
  const root = realpathSync(requestedRoot);
  const server: Server = createServer((request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' });
        response.end('Method not allowed');
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const file = resolveFile(root, url.pathname);
      if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': statSync(file).size,
        'content-type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('Bad request');
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local preview did not start');
  let closed = false;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
        server.closeAllConnections?.();
      });
    },
  };
}

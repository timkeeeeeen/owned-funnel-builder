import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const clientDirectory = resolve('dist/client');
const serverDirectory = resolve('dist/server');

await mkdir(serverDirectory, { recursive: true });
await copyFile(
  resolve(clientDirectory, 'sitemap-index.xml'),
  resolve(clientDirectory, 'sitemap.xml')
);
await copyFile(resolve('worker/index.js'), resolve(serverDirectory, 'index.js'));

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error('Owned Funnel Builder MCP is ready on stdio.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The MCP server could not start.');
  process.exitCode = 1;
});

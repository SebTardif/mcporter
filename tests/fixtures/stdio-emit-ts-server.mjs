#!/usr/bin/env node

// Stdio MCP server for emit-ts proof: every tool answers with the arguments it received, so a
// generated client can be checked end to end. The schemas are raw JSON Schema so that `default`
// values and a property literally named `function` are advertised exactly as written.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tools = [
  {
    name: 'click',
    description: 'Click an element on a page',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page identifier' },
        uid: { type: 'string', description: 'Element uid' },
      },
      required: ['pageId', 'uid'],
    },
  },
  {
    name: 'search',
    description: 'Search pages',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        limit: { type: 'number', description: 'Maximum results', default: 10 },
        verbose: { type: 'boolean', description: 'Include snippets', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_pages',
    description: 'List open pages',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'evaluate_script',
    description: 'Evaluate a function on a page',
    inputSchema: {
      type: 'object',
      properties: {
        function: { type: 'string', description: 'Function source' },
        pageId: { type: 'string', description: 'Page identifier' },
      },
      required: ['function'],
    },
  },
];

const server = new Server({ name: 'emit-ts-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: received = {} } = request.params;
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify({ tool: name, received }) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
await new Promise((resolve, reject) => {
  transport.onclose = resolve;
  transport.onerror = reject;
});

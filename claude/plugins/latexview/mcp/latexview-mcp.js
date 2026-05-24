#!/usr/bin/env node
import { toolMap, tools } from './latexview-tools.js';

function send(id, result, error = undefined) {
  const message = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (message.id === undefined) return;

  try {
    if (message.method === 'initialize') {
      send(message.id, {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'latexview', version: '0.1.2' }
      });
      return;
    }

    if (message.method === 'ping') {
      send(message.id, {});
      return;
    }

    if (message.method === 'tools/list') {
      send(message.id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      });
      return;
    }

    if (message.method === 'tools/call') {
      const tool = toolMap.get(message.params?.name);
      if (!tool) {
        send(message.id, undefined, { code: -32602, message: `Unknown tool: ${message.params?.name}` });
        return;
      }
      const result = await tool.handler(message.params?.arguments || {});
      send(message.id, result);
      return;
    }

    send(message.id, undefined, { code: -32601, message: `Unknown method: ${message.method}` });
  } catch (error) {
    send(message.id, {
      content: [{ type: 'text', text: error.message }],
      isError: true
    });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      try {
        void handle(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`Invalid JSON-RPC message: ${error.message}\n`);
      }
    }
    newlineIndex = buffer.indexOf('\n');
  }
});

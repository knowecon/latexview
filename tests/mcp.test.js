import { afterEach, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf } from './pdf-fixture.js';

const processes = [];

afterEach(() => {
  for (const child of processes.splice(0)) {
    child.kill('SIGTERM');
  }
});

function startMcpServer() {
  const child = spawn(process.execPath, [
    'codex/plugins/latexview/mcp/latexview-mcp.js'
  ], {
    cwd: new URL('../', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  processes.push(child);

  const responses = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) responses.push(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  });

  let nextId = 1;

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);

    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const index = responses.findIndex((response) => response.id === id);
        if (index !== -1) {
          clearInterval(timer);
          resolve(responses.splice(index, 1)[0]);
          return;
        }
        if (Date.now() - started > 3000) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${method}`));
        }
      }, 10);
    });
  }

  return { child, request };
}

describe('latexview MCP server', () => {
  test('lists and calls the full latexview tool surface', async () => {
    const server = startMcpServer();

    const initialized = await server.request('initialize', {
      protocolVersion: '2024-11-05'
    });
    expect(initialized.result.serverInfo.name).toBe('latexview');

    const list = await server.request('tools/list');
    const toolNames = list.result.tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual([
      'latexview_capture',
      'latexview_find',
      'latexview_help',
      'latexview_jump',
      'latexview_serve'
    ]);

    const help = await server.request('tools/call', {
      name: 'latexview_help',
      arguments: {}
    });
    expect(help.result.content[0].text).toContain('Usage: latexview');
  });

  test('serves a PDF and captures a page through MCP tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-mcp-'));
    const pdfPath = join(dir, 'main.pdf');
    const outPath = join(dir, 'page-2.png');
    const webpPath = join(dir, 'page-2.webp');
    let serverPid;

    try {
      await writeFile(pdfPath, makePdf(['page one', 'page two']));
      const server = startMcpServer();

      await server.request('initialize', {
        protocolVersion: '2024-11-05'
      });

      const served = await server.request('tools/call', {
        name: 'latexview_serve',
        arguments: {
          pdfPath,
          page: 2,
          port: 0
        }
      });
      serverPid = served.result.structuredContent.pid;
      expect(served.result.content[0].text).toContain('?page=2');

      const response = await fetch(served.result.structuredContent.url);
      expect(response.status).toBe(200);

      const captured = await server.request('tools/call', {
        name: 'latexview_capture',
        arguments: {
          pdfPath,
          page: 2,
          outPath
        }
      });
      expect(captured.result.structuredContent.outPath).toBe(webpPath);

      const bytes = await readFile(webpPath);
      expect(bytes.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(bytes.slice(8, 12).toString('ascii')).toBe('WEBP');
    } finally {
      if (serverPid) {
        try {
          process.kill(serverPid, 'SIGTERM');
        } catch {
          // The server may already have exited.
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});

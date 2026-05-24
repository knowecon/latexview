import { afterEach, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf } from './pdf-fixture.js';

const processes = [];

afterEach(() => {
  for (const child of processes.splice(0)) {
    child.kill('SIGTERM');
  }
});

function startMcpServer(scriptPath = 'codex/plugins/latexview/mcp/latexview-mcp.js', options = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: new URL('../', import.meta.url),
    env: options.env || process.env,
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

describe('latexview MCP tools', () => {
  async function expectLatexviewToolList(server) {
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
      'latexview_info',
      'latexview_inspect',
      'latexview_jump',
      'latexview_list',
      'latexview_serve',
      'latexview_status',
      'latexview_stop'
    ]);

    const help = await server.request('tools/call', {
      name: 'latexview_help',
      arguments: {}
    });
    expect(help.result.content[0].text).toContain('Usage: latexview');
  }

  test('lists script-backed latexview tools', async () => {
    const server = startMcpServer();

    await expectLatexviewToolList(server);
  });

  test('lists Claude plugin MCP tools', async () => {
    const server = startMcpServer('claude/plugins/latexview/mcp/latexview-mcp.js');

    await expectLatexviewToolList(server);
  });

  test('runs from a Codex cache-style mcp-only copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-mcp-cache-'));
    const home = join(dir, 'home');
    const binDir = join(home, '.local', 'bin');
    const fakeCliPath = join(binDir, 'latexview');

    try {
      await cp(new URL('../codex/plugins/latexview/mcp', import.meta.url), join(dir, 'mcp'), {
        recursive: true
      });
      await mkdir(binDir, { recursive: true });
      await writeFile(fakeCliPath, [
        '#!/usr/bin/env node',
        "if (process.argv.includes('--help')) {",
        "  console.log('Usage: latexview fake');",
        '  process.exit(0);',
        '}',
        "console.error(`unexpected args: ${process.argv.slice(2).join(' ')}`);",
        'process.exit(1);'
      ].join('\n'));
      await chmod(fakeCliPath, 0o755);

      const server = startMcpServer(join(dir, 'mcp', 'latexview-mcp.js'), {
        env: {
          ...process.env,
          HOME: home,
          PATH: '/usr/bin:/bin'
        }
      });

      await expectLatexviewToolList(server);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('serves a PDF and captures a page through registered tools', async () => {
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

      const captured = await server.request('tools/call', {
        name: 'latexview_capture',
        arguments: {
          pdfPath,
          page: 2,
          outPath
        }
      });
      expect(captured.result.structuredContent.outPath).toBe(webpPath);
      expect(captured.result.structuredContent.ok).toBe(true);

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

  test('starts without an explicit port and exposes info/status/list/inspect tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-mcp-tools-'));
    const pdfPath = join(dir, 'main.pdf');
    let firstPid;
    let secondPid;

    try {
      await writeFile(pdfPath, makePdf(['page one', 'page two', 'page three']));
      const server = startMcpServer();

      await server.request('initialize', {
        protocolVersion: '2024-11-05'
      });

      const info = await server.request('tools/call', {
        name: 'latexview_info',
        arguments: { pdfPath }
      });
      expect(info.result.structuredContent.pdf.numPages).toBe(3);

      const first = await server.request('tools/call', {
        name: 'latexview_serve',
        arguments: { pdfPath, page: 1 }
      });
      const second = await server.request('tools/call', {
        name: 'latexview_serve',
        arguments: { pdfPath, page: 2 }
      });
      firstPid = first.result.structuredContent.pid;
      secondPid = second.result.structuredContent.pid;
      expect(first.result.structuredContent.url).not.toBe(second.result.structuredContent.url);

      const status = await server.request('tools/call', {
        name: 'latexview_status',
        arguments: { viewerUrl: first.result.structuredContent.url }
      });
      expect(status.result.structuredContent.ok).toBe(true);

      const listed = await server.request('tools/call', {
        name: 'latexview_list',
        arguments: {}
      });
      expect(listed.result.structuredContent.entries.length).toBeGreaterThanOrEqual(2);

      const inspected = await server.request('tools/call', {
        name: 'latexview_inspect',
        arguments: { pdfPath, pages: 'first,last' }
      });
      expect(inspected.result.structuredContent.pages.map((page) => page.page)).toEqual([1, 3]);
    } finally {
      for (const pid of [firstPid, secondPid]) {
        if (pid) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // The server may already have exited.
          }
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});

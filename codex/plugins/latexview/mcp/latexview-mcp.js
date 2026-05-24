#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '../../../../bin/latexview.js');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4545;
const DEFAULT_PAGE = 1;
const DEFAULT_DPI = 216;

function textResult(text, details = undefined) {
  return {
    content: [{ type: 'text', text }],
    ...(details === undefined ? {} : { structuredContent: details })
  };
}

function resolvePath(cwd, value) {
  return resolve(cwd || process.cwd(), value);
}

function normalizeWebpPath(cwd, pdfPath, page, requestedPath) {
  if (!requestedPath) {
    const stem = basename(pdfPath, extname(pdfPath));
    return resolve(cwd || process.cwd(), `${stem}-page-${page}.webp`);
  }

  const absolutePath = resolve(cwd || process.cwd(), requestedPath);
  const extension = extname(absolutePath);
  if (extension.toLowerCase() === '.webp') return absolutePath;
  return extension ? `${absolutePath.slice(0, -extension.length)}.webp` : `${absolutePath}.webp`;
}

function runLatexview(args, cwd = process.cwd()) {
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [cliPath, ...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function startLatexviewServer(params) {
  return new Promise((resolvePromise, reject) => {
    const cwd = params.cwd || process.cwd();
    const pdfPath = resolvePath(cwd, params.pdfPath);
    const page = Math.trunc(params.page ?? DEFAULT_PAGE);
    const args = [
      cliPath,
      '--host',
      params.host || DEFAULT_HOST,
      '--port',
      String(params.port ?? DEFAULT_PORT),
      '--page',
      String(page)
    ];

    if (params.open) args.push('--open');
    else args.push('--no-open');
    args.push(pdfPath);

    const child = spawn(process.execPath, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Timed out waiting for latexview server to start.${stderr ? ` ${stderr}` : ''}`));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Viewer:\s*(\S+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolvePromise({
        pid: child.pid,
        pdfPath,
        page,
        url: match[1],
        output: stdout.trim()
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`latexview exited before serving (code ${code}). ${stderr}`.trim()));
    });
  });
}

const tools = [
  {
    name: 'latexview_serve',
    description: 'Start a latexview browser preview server for a PDF and return the viewer URL and process id.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' },
        host: { type: 'string', default: DEFAULT_HOST },
        port: { type: 'integer', default: DEFAULT_PORT, minimum: 0, maximum: 65535 },
        page: { type: 'integer', default: DEFAULT_PAGE, minimum: 1 },
        open: { type: 'boolean', default: false }
      },
      required: ['pdfPath']
    },
    async handler(params) {
      const result = await startLatexviewServer(params);
      return textResult(`latexview serving page ${result.page}: ${result.url}\npid: ${result.pid}`, result);
    }
  },
  {
    name: 'latexview_find',
    description: 'Run latexview find and return candidate pages for rendered text.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        query: { type: 'string', description: 'Rendered text to search for.' },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' },
        viewerUrl: { type: 'string', description: 'Optional viewer URL/origin used to include jump links.' },
        json: { type: 'boolean', default: true }
      },
      required: ['pdfPath', 'query']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const pdfPath = resolvePath(cwd, params.pdfPath);
      const args = ['find'];
      if (params.json !== false) args.push('--json');
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      args.push(pdfPath, params.query);
      const { stdout } = await runLatexview(args, cwd);
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = { raw: stdout };
      }
      return textResult(stdout.trim(), { pdfPath, query: params.query, result: parsed });
    }
  },
  {
    name: 'latexview_jump',
    description: 'Run latexview jump to move an open viewer to a page.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        viewerUrl: { type: 'string', description: 'Viewer origin or URL.', default: 'http://127.0.0.1:4545' },
        cwd: { type: 'string', description: 'Working directory.' }
      },
      required: ['page']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const { stdout } = await runLatexview([
        'jump',
        '--url',
        params.viewerUrl || 'http://127.0.0.1:4545',
        String(Math.trunc(params.page))
      ], cwd);
      return textResult(stdout.trim(), { page: Math.trunc(params.page), viewerUrl: params.viewerUrl });
    }
  },
  {
    name: 'latexview_capture',
    description: 'Run latexview capture and write one PDF page as WebP.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        page: { type: 'integer', minimum: 1 },
        outPath: { type: 'string', description: 'Output image path. Normalized to .webp.' },
        dpi: { type: 'integer', default: DEFAULT_DPI, minimum: 1 },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' }
      },
      required: ['pdfPath', 'page']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const pdfPath = resolvePath(cwd, params.pdfPath);
      const page = Math.trunc(params.page);
      const dpi = Math.trunc(params.dpi ?? DEFAULT_DPI);
      const outPath = normalizeWebpPath(cwd, pdfPath, page, params.outPath);
      const { stdout } = await runLatexview([
        'capture',
        pdfPath,
        String(page),
        '--out',
        outPath,
        '--dpi',
        String(dpi)
      ], cwd);
      return textResult(stdout.trim(), { pdfPath, page, outPath, dpi });
    }
  },
  {
    name: 'latexview_help',
    description: 'Return latexview CLI help text.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory.' }
      }
    },
    async handler(params) {
      const { stdout } = await runLatexview(['--help'], params.cwd || process.cwd());
      return textResult(stdout.trim());
    }
  }
];

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

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
        serverInfo: { name: 'latexview', version: '0.1.0' }
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

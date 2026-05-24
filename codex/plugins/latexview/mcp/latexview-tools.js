import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoCliPath = resolve(__dirname, '../../../../bin/latexview.js');
const pluginCliPath = resolve(__dirname, '../bin/latexview.js');
const homeLocalCliPath = process.env.HOME
  ? resolve(process.env.HOME, '.local/bin/latexview')
  : undefined;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4545;
const DEFAULT_PAGE = 1;
const DEFAULT_DPI = 216;

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveNodeCommand() {
  const candidates = [
    process.env.LATEXVIEW_NODE,
    process.env.HOME ? resolve(process.env.HOME, '.asdf/shims/node') : undefined,
    process.env.HOME ? resolve(process.env.HOME, '.local/share/mise/shims/node') : undefined,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    process.execPath
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return 'node';
}

function resolveCliPath() {
  if (process.env.LATEXVIEW_CLI) {
    return resolve(process.cwd(), process.env.LATEXVIEW_CLI);
  }
  if (existsSync(pluginCliPath)) {
    return pluginCliPath;
  }
  if (existsSync(repoCliPath)) {
    return repoCliPath;
  }
  if (homeLocalCliPath && existsSync(homeLocalCliPath)) {
    return homeLocalCliPath;
  }
  return undefined;
}

function latexviewCommand(args) {
  const cliPath = resolveCliPath();
  if (cliPath) {
    if (isExecutable(cliPath)) {
      return {
        command: cliPath,
        args
      };
    }

    return {
      command: resolveNodeCommand(),
      args: [cliPath, ...args]
    };
  }
  return {
    command: 'latexview',
    args
  };
}

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

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout };
  }
}

function runLatexview(args, cwd = process.cwd()) {
  return new Promise((resolvePromise, reject) => {
    const invocation = latexviewCommand(args);
    execFile(invocation.command, invocation.args, {
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
      '--host',
      params.host || DEFAULT_HOST,
      '--page',
      String(page)
    ];

    if (params.port !== undefined) {
      args.push('--port', String(params.port));
    }

    if (params.open) args.push('--open');
    else args.push('--no-open');
    args.push(pdfPath);

    const invocation = latexviewCommand(args);
    const child = spawn(invocation.command, invocation.args, {
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

export const tools = [
  {
    name: 'latexview_serve',
    description: 'Start a latexview browser preview server for a PDF and return the viewer URL and process id.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' },
        host: { type: 'string', default: DEFAULT_HOST },
        port: { type: 'integer', minimum: 0, maximum: 65535 },
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
    name: 'latexview_info',
    description: 'Read static PDF metadata including page count and dimensions.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' }
      },
      required: ['pdfPath']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const pdfPath = resolvePath(cwd, params.pdfPath);
      const { stdout } = await runLatexview(['info', '--json', pdfPath], cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
    }
  },
  {
    name: 'latexview_status',
    description: 'Check a running latexview viewer by URL/origin.',
    inputSchema: {
      type: 'object',
      properties: {
        viewerUrl: { type: 'string', description: 'Viewer URL or origin. Defaults to http://127.0.0.1:4545.' },
        cwd: { type: 'string', description: 'Working directory.' }
      }
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const args = ['status', '--json'];
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      const { stdout } = await runLatexview(args, cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
    }
  },
  {
    name: 'latexview_list',
    description: 'List live latexview preview servers from the local lifecycle registry.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory.' }
      }
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const { stdout } = await runLatexview(['list', '--json'], cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
    }
  },
  {
    name: 'latexview_stop',
    description: 'Stop latexview preview servers through the registry without relying on pid alone.',
    inputSchema: {
      type: 'object',
      properties: {
        viewerUrl: { type: 'string', description: 'Viewer URL/origin to stop.' },
        port: { type: 'integer', minimum: 0, maximum: 65535 },
        pid: { type: 'integer', minimum: 1 },
        all: { type: 'boolean', description: 'Stop all live latexview servers.' },
        cwd: { type: 'string', description: 'Working directory.' }
      }
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const args = ['stop', '--json'];
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      else if (params.port !== undefined) args.push('--port', String(params.port));
      else if (params.pid !== undefined) args.push('--pid', String(params.pid));
      else if (params.all) args.push('--all');
      else throw new Error('latexview_stop requires viewerUrl, port, pid, or all.');
      const { stdout } = await runLatexview(args, cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
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
      return textResult(stdout.trim(), {
        pdfPath,
        query: params.query,
        result: parseJsonOutput(stdout)
      });
    }
  },
  {
    name: 'latexview_inspect',
    description: 'Inspect selected PDF pages and return stable QA warnings without returning page images.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: { type: 'string', description: 'PDF path, relative to cwd or absolute.' },
        cwd: { type: 'string', description: 'Working directory for resolving relative paths.' },
        pages: { type: 'string', description: 'Comma-separated page spec such as first,middle,last.' },
        range: { type: 'string', description: 'Range spec such as 1-5 or middle-last.' },
        from: { type: 'string', description: 'Range start endpoint.' },
        to: { type: 'string', description: 'Range end endpoint.' },
        all: { type: 'boolean', description: 'Inspect all pages; large PDFs require maxPages.' },
        capture: { type: 'boolean', description: 'Render pages temporarily for pixel-backed blank detection.' },
        dpi: { type: 'integer', minimum: 1, default: 72 },
        maxPages: { type: 'integer', minimum: 1 }
      },
      required: ['pdfPath']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const pdfPath = resolvePath(cwd, params.pdfPath);
      const args = ['inspect', '--json'];
      if (params.pages) args.push('--pages', params.pages);
      if (params.range) args.push('--range', params.range);
      if (params.from) args.push('--from', params.from);
      if (params.to) args.push('--to', params.to);
      if (params.all) args.push('--all');
      if (params.capture) args.push('--capture');
      if (params.dpi) args.push('--dpi', String(Math.trunc(params.dpi)));
      if (params.maxPages) args.push('--max-pages', String(Math.trunc(params.maxPages)));
      args.push(pdfPath);
      const { stdout } = await runLatexview(args, cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
    }
  },
  {
    name: 'latexview_jump',
    description: 'Run latexview jump to move an open viewer to a page.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        viewerUrl: { type: 'string', description: 'Viewer origin or URL.', default: `http://${DEFAULT_HOST}:${DEFAULT_PORT}` },
        cwd: { type: 'string', description: 'Working directory.' }
      },
      required: ['page']
    },
    async handler(params) {
      const cwd = params.cwd || process.cwd();
      const page = Math.trunc(params.page);
      const viewerUrl = params.viewerUrl || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
      const { stdout } = await runLatexview([
        'jump',
        '--url',
        viewerUrl,
        String(page)
      ], cwd);
      return textResult(stdout.trim(), { page, viewerUrl });
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
        '--json',
        pdfPath,
        String(page),
        '--out',
        outPath,
        '--dpi',
        String(dpi)
      ], cwd);
      return textResult(stdout.trim(), parseJsonOutput(stdout));
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

export const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

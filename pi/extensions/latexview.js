import { execFile, spawn } from 'node:child_process';
import { basename, extname, resolve } from 'node:path';
import { Type } from 'typebox';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PAGE = 1;
const DEFAULT_DPI = 216;

function runLatexview(args, cwd, signal) {
  return new Promise((resolvePromise, reject) => {
    execFile('latexview', args, {
      cwd,
      signal,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr?.trim() || error.message;
        reject(new Error(`latexview failed: ${detail}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout };
  }
}

async function runJsonTool(args, cwd, signal) {
  const { stdout } = await runLatexview(args, cwd, signal);
  return {
    text: stdout.trim(),
    details: parseJsonOutput(stdout)
  };
}

function startLatexviewServer(params, cwd) {
  return new Promise((resolvePromise, reject) => {
    const pdfPath = resolve(cwd, params.pdfPath);
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

    const child = spawn('latexview', args, {
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

function normalizeWebpPath(cwd, pdfPath, page, requestedPath) {
  if (!requestedPath) {
    const stem = basename(pdfPath, extname(pdfPath));
    return resolve(cwd, `${stem}-page-${page}.webp`);
  }

  const absolutePath = resolve(cwd, requestedPath);
  const extension = extname(absolutePath);
  if (extension.toLowerCase() === '.webp') return absolutePath;
  return extension ? `${absolutePath.slice(0, -extension.length)}.webp` : `${absolutePath}.webp`;
}

async function executeFind(params, signal, ctx) {
  const pdfPath = resolve(ctx.cwd, params.pdfPath);
  const args = ['find', '--json'];
  if (params.viewerUrl) args.push('--url', params.viewerUrl);
  if (params.jumpIfUnique) args.push('--jump-if-unique');
  args.push(pdfPath, params.query);
  const result = await runJsonTool(args, ctx.cwd, signal);
  return {
    content: [{ type: 'text', text: result.text }],
    details: {
      pdfPath,
      query: params.query,
      result: result.details
    }
  };
}

async function executeCapture(params, signal, ctx) {
  const pdfPath = resolve(ctx.cwd, params.pdfPath);
  const page = Math.trunc(params.page);
  const dpi = Math.trunc(params.dpi ?? DEFAULT_DPI);
  const outPath = normalizeWebpPath(ctx.cwd, pdfPath, page, params.outPath);
  const result = await runJsonTool([
    'capture',
    '--json',
    pdfPath,
    String(page),
    '--out',
    outPath,
    '--dpi',
    String(dpi)
  ], ctx.cwd, signal);

  return {
    content: [{ type: 'text', text: result.text || `Captured page ${page}: ${outPath}` }],
    details: result.details
  };
}

function inspectArgs(params, pdfPath) {
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
  return args;
}

export default function latexviewExtension(pi) {
  pi.registerTool({
    name: 'latexview_serve',
    label: 'latexview serve',
    description: 'Start a latexview browser preview server for a PDF and return the viewer URL and process id.',
    parameters: Type.Object({
      pdfPath: Type.String({ description: 'PDF path, relative to the current workspace or absolute.' }),
      host: Type.Optional(Type.String({ description: 'Host to bind. Defaults to 127.0.0.1.' })),
      port: Type.Optional(Type.Number({ minimum: 0, maximum: 65535, description: 'Optional port. Omit to allow fallback.' })),
      page: Type.Optional(Type.Number({ minimum: 1, description: 'Initial one-based page. Defaults to 1.' })),
      open: Type.Optional(Type.Boolean({ description: 'Open the viewer in the default browser. Defaults to false.' }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await startLatexviewServer(params, ctx.cwd);
      return {
        content: [{ type: 'text', text: `latexview serving page ${result.page}: ${result.url}\npid: ${result.pid}` }],
        details: result
      };
    }
  });

  pi.registerTool({
    name: 'latexview_info',
    label: 'latexview info',
    description: 'Read static PDF metadata including page count and dimensions.',
    parameters: Type.Object({
      pdfPath: Type.String({ description: 'PDF path, relative to the current workspace or absolute.' })
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const result = await runJsonTool(['info', '--json', pdfPath], ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    }
  });

  pi.registerTool({
    name: 'latexview_status',
    label: 'latexview status',
    description: 'Check a running latexview viewer by URL/origin.',
    parameters: Type.Object({
      viewerUrl: Type.Optional(Type.String({ description: 'Viewer URL or origin. Defaults to http://127.0.0.1:4545.' }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ['status', '--json'];
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      const result = await runJsonTool(args, ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    }
  });

  pi.registerTool({
    name: 'latexview_list',
    label: 'latexview list',
    description: 'List live latexview preview servers from the local lifecycle registry.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const result = await runJsonTool(['list', '--json'], ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    }
  });

  pi.registerTool({
    name: 'latexview_stop',
    label: 'latexview stop',
    description: 'Stop latexview preview servers through the registry without relying on pid alone.',
    parameters: Type.Object({
      viewerUrl: Type.Optional(Type.String()),
      port: Type.Optional(Type.Number({ minimum: 0, maximum: 65535 })),
      pid: Type.Optional(Type.Number({ minimum: 1 })),
      all: Type.Optional(Type.Boolean())
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ['stop', '--json'];
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      else if (params.port !== undefined) args.push('--port', String(params.port));
      else if (params.pid !== undefined) args.push('--pid', String(params.pid));
      else if (params.all) args.push('--all');
      else throw new Error('latexview_stop requires viewerUrl, port, pid, or all.');
      const result = await runJsonTool(args, ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    }
  });

  pi.registerTool({
    name: 'latexview_find',
    label: 'latexview find',
    description: 'Find candidate PDF pages containing rendered text with the latexview CLI.',
    parameters: Type.Object({
      pdfPath: Type.String({ description: 'PDF path, relative to the current workspace or absolute.' }),
      query: Type.String({ description: 'Rendered text to search for. Longer snippets are more precise.' }),
      viewerUrl: Type.Optional(Type.String({ description: 'Optional viewer origin or URL used to include jump links.' })),
      jumpIfUnique: Type.Optional(Type.Boolean({ description: 'Jump the viewer when exactly one match is found.' }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeFind(params, signal, ctx);
    }
  });

  pi.registerTool({
    name: 'latexview_inspect',
    label: 'latexview inspect',
    description: 'Inspect selected PDF pages and return stable QA warnings without returning page images.',
    parameters: Type.Object({
      pdfPath: Type.String(),
      pages: Type.Optional(Type.String()),
      range: Type.Optional(Type.String()),
      from: Type.Optional(Type.String()),
      to: Type.Optional(Type.String()),
      all: Type.Optional(Type.Boolean()),
      capture: Type.Optional(Type.Boolean()),
      dpi: Type.Optional(Type.Number({ minimum: 1 })),
      maxPages: Type.Optional(Type.Number({ minimum: 1 }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const result = await runJsonTool(inspectArgs(params, pdfPath), ctx.cwd, signal);
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    }
  });

  pi.registerTool({
    name: 'latexview_jump',
    label: 'latexview jump',
    description: 'Move an open latexview viewer to a page.',
    parameters: Type.Object({
      page: Type.Number({ minimum: 1, description: 'One-based page number.' }),
      viewerUrl: Type.Optional(Type.String({ description: 'Viewer origin or URL. Defaults to http://127.0.0.1:4545.' }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const page = Math.trunc(params.page);
      const viewerUrl = params.viewerUrl || 'http://127.0.0.1:4545';
      const { stdout } = await runLatexview(['jump', '--url', viewerUrl, String(page)], ctx.cwd, signal);
      return {
        content: [{ type: 'text', text: stdout.trim() }],
        details: { page, viewerUrl }
      };
    }
  });

  pi.registerTool({
    name: 'latexview_capture',
    label: 'latexview capture',
    description: 'Capture exactly one PDF page as a WebP image with the latexview CLI.',
    parameters: Type.Object({
      pdfPath: Type.String({ description: 'PDF path, relative to the current workspace or absolute.' }),
      page: Type.Number({ minimum: 1, description: 'One-based PDF page number to capture.' }),
      outPath: Type.Optional(Type.String({ description: 'Output image path. The extension normalizes it to .webp.' })),
      dpi: Type.Optional(Type.Number({ minimum: 1, description: 'Render DPI. Defaults to 216.' }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeCapture(params, signal, ctx);
    }
  });

  pi.registerTool({
    name: 'latexview_help',
    label: 'latexview help',
    description: 'Return latexview CLI help text.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const { stdout } = await runLatexview(['--help'], ctx.cwd, signal);
      return { content: [{ type: 'text', text: stdout.trim() }], details: {} };
    }
  });

  pi.registerTool({
    name: 'latexview_capture_page',
    label: 'latexview capture page',
    description: 'Compatibility alias for latexview_capture.',
    parameters: Type.Object({
      pdfPath: Type.String(),
      page: Type.Number({ minimum: 1 }),
      outPath: Type.Optional(Type.String()),
      dpi: Type.Optional(Type.Number({ minimum: 1 }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeCapture(params, signal, ctx);
    }
  });

  pi.registerTool({
    name: 'latexview_find_text',
    label: 'latexview find text',
    description: 'Compatibility alias for latexview_find.',
    parameters: Type.Object({
      pdfPath: Type.String(),
      query: Type.String(),
      viewerUrl: Type.Optional(Type.String()),
      jumpIfUnique: Type.Optional(Type.Boolean())
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeFind(params, signal, ctx);
    }
  });
}

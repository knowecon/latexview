import { execFile, spawn } from 'node:child_process';
import { basename, extname, resolve } from 'node:path';
import { Type } from 'typebox';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4545;
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

function startLatexviewServer(params, cwd, signal) {
  return new Promise((resolvePromise, reject) => {
    const pdfPath = resolve(cwd, params.pdfPath);
    const page = Math.trunc(params.page ?? DEFAULT_PAGE);
    const args = [
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

    const child = spawn('latexview', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
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
  if (extension.toLowerCase() === '.webp') {
    return absolutePath;
  }
  return extension
    ? `${absolutePath.slice(0, -extension.length)}.webp`
    : `${absolutePath}.webp`;
}

function parseFindOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout };
  }
}

export default function latexviewExtension(pi) {
  pi.registerTool({
    name: 'latexview_serve',
    label: 'latexview serve',
    description: 'Start a latexview browser preview server for a PDF and return the viewer URL and process id.',
    parameters: Type.Object({
      pdfPath: Type.String({
        description: 'PDF path, relative to the current workspace or absolute.'
      }),
      host: Type.Optional(Type.String({
        description: 'Host to bind. Defaults to 127.0.0.1.'
      })),
      port: Type.Optional(Type.Number({
        minimum: 0,
        maximum: 65535,
        description: 'Port to bind. Defaults to 4545. Use 0 for an available port.'
      })),
      page: Type.Optional(Type.Number({
        minimum: 1,
        description: 'Initial one-based page. Defaults to 1.'
      })),
      open: Type.Optional(Type.Boolean({
        description: 'Open the viewer in the default browser. Defaults to false.'
      }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await startLatexviewServer(params, ctx.cwd, signal);

      return {
        content: [{
          type: 'text',
          text: `latexview serving page ${result.page}: ${result.url}\npid: ${result.pid}`
        }],
        details: result
      };
    }
  });

  pi.registerTool({
    name: 'latexview_find',
    label: 'latexview find',
    description: 'Find candidate PDF pages containing rendered text with the latexview CLI.',
    parameters: Type.Object({
      pdfPath: Type.String({
        description: 'PDF path, relative to the current workspace or absolute.'
      }),
      query: Type.String({
        description: 'Rendered text to search for. Longer snippets are more precise.'
      }),
      viewerUrl: Type.Optional(Type.String({
        description: 'Optional viewer origin or URL used to include jump links.'
      })),
      json: Type.Optional(Type.Boolean({
        description: 'Return latexview JSON output. Defaults to true.'
      }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const args = ['find'];
      if (params.json !== false) args.push('--json');
      if (params.viewerUrl) {
        args.push('--url', params.viewerUrl);
      }
      args.push(pdfPath, params.query);

      const { stdout } = await runLatexview(args, ctx.cwd, signal);
      const parsed = parseFindOutput(stdout);

      return {
        content: [{
          type: 'text',
          text: stdout.trim()
        }],
        details: {
          pdfPath,
          query: params.query,
          result: parsed
        }
      };
    }
  });

  pi.registerTool({
    name: 'latexview_jump',
    label: 'latexview jump',
    description: 'Move an open latexview viewer to a page.',
    parameters: Type.Object({
      page: Type.Number({
        minimum: 1,
        description: 'One-based page number.'
      }),
      viewerUrl: Type.Optional(Type.String({
        description: 'Viewer origin or URL. Defaults to http://127.0.0.1:4545.'
      }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const page = Math.trunc(params.page);
      const viewerUrl = params.viewerUrl || 'http://127.0.0.1:4545';
      const { stdout } = await runLatexview([
        'jump',
        '--url',
        viewerUrl,
        String(page)
      ], ctx.cwd, signal);

      return {
        content: [{
          type: 'text',
          text: stdout.trim()
        }],
        details: {
          page,
          viewerUrl
        }
      };
    }
  });

  pi.registerTool({
    name: 'latexview_capture',
    label: 'latexview capture',
    description: 'Capture one PDF page as a crisp WebP image with the latexview CLI.',
    parameters: Type.Object({
      pdfPath: Type.String({
        description: 'PDF path, relative to the current workspace or absolute.'
      }),
      page: Type.Number({
        minimum: 1,
        description: 'One-based PDF page number to capture.'
      }),
      outPath: Type.Optional(Type.String({
        description: 'Output image path. The extension normalizes it to .webp.'
      })),
      dpi: Type.Optional(Type.Number({
        minimum: 1,
        description: 'Render DPI. Defaults to 216 for readable text.'
      }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const page = Math.trunc(params.page);
      const dpi = Math.trunc(params.dpi ?? DEFAULT_DPI);
      const outPath = normalizeWebpPath(ctx.cwd, pdfPath, page, params.outPath);

      const { stdout } = await runLatexview([
        'capture',
        pdfPath,
        String(page),
        '--out',
        outPath,
        '--dpi',
        String(dpi)
      ], ctx.cwd, signal);

      return {
        content: [{
          type: 'text',
          text: stdout.trim() || `Captured page ${page}: ${outPath}`
        }],
        details: {
          pdfPath,
          page,
          outPath,
          dpi
        }
      };
    }
  });

  pi.registerTool({
    name: 'latexview_help',
    label: 'latexview help',
    description: 'Return latexview CLI help text.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const { stdout } = await runLatexview(['--help'], ctx.cwd, signal);
      return {
        content: [{
          type: 'text',
          text: stdout.trim()
        }],
        details: {}
      };
    }
  });

  pi.registerTool({
    name: 'latexview_capture_page',
    label: 'latexview capture page',
    description: 'Alias for latexview_capture.',
    parameters: Type.Object({
      pdfPath: Type.String(),
      page: Type.Number({ minimum: 1 }),
      outPath: Type.Optional(Type.String()),
      dpi: Type.Optional(Type.Number({ minimum: 1 }))
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = pi.getAllTools?.().find((candidate) => candidate.name === 'latexview_capture');
      if (tool?.execute) return tool.execute(toolCallId, params, signal, onUpdate, ctx);
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const page = Math.trunc(params.page);
      const dpi = Math.trunc(params.dpi ?? DEFAULT_DPI);
      const outPath = normalizeWebpPath(ctx.cwd, pdfPath, page, params.outPath);
      const { stdout } = await runLatexview(['capture', pdfPath, String(page), '--out', outPath, '--dpi', String(dpi)], ctx.cwd, signal);
      return { content: [{ type: 'text', text: stdout.trim() }], details: { pdfPath, page, outPath, dpi } };
    }
  });

  pi.registerTool({
    name: 'latexview_find_text',
    label: 'latexview find text',
    description: 'Alias for latexview_find.',
    parameters: Type.Object({
      pdfPath: Type.String(),
      query: Type.String(),
      viewerUrl: Type.Optional(Type.String()),
      json: Type.Optional(Type.Boolean())
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const pdfPath = resolve(ctx.cwd, params.pdfPath);
      const args = ['find'];
      if (params.json !== false) args.push('--json');
      if (params.viewerUrl) args.push('--url', params.viewerUrl);
      args.push(pdfPath, params.query);
      const { stdout } = await runLatexview(args, ctx.cwd, signal);
      return { content: [{ type: 'text', text: stdout.trim() }], details: { pdfPath, query: params.query, result: parseFindOutput(stdout) } };
    }
  });
}

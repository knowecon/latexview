import { spawn } from 'node:child_process';
import { parseCliArgs, helpText } from './args.js';
import { capturePageImage } from './capture.js';
import { findTextInPdf, formatFindResults, pageUrl } from './pdf-search.js';
import { createLatexViewServer } from './server.js';

const fallbackAttempts = 25;

function isAddressInUse(error) {
  return error && error.code === 'EADDRINUSE';
}

export function buildStartupMessage({ pdfPath, url }) {
  return [
    `latexview serving: ${pdfPath}`,
    `Viewer: ${url}`,
    'Press Ctrl+C to stop.'
  ].join('\n');
}

function openInDefaultBrowser(url) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

export async function startPreview(config) {
  let currentPort = config.port;
  let lastError;

  for (let attempt = 0; attempt < fallbackAttempts; attempt += 1) {
    const preview = createLatexViewServer({ pdfPath: config.pdfPath });
    try {
      await preview.listen({ host: config.host, port: currentPort });
      const viewerUrl = preview.url({ page: config.page });
      return {
        close: preview.close,
        pdfPath: config.pdfPath,
        port: preview.address().port,
        server: preview.server,
        url: viewerUrl
      };
    } catch (error) {
      await preview.close();
      lastError = error;
      if (config.requestedPort || !isAddressInUse(error)) {
        throw error;
      }
      currentPort += 1;
    }
  }

  throw lastError ?? new Error(`Unable to bind a port near ${config.port}`);
}

export async function runCli(argv = process.argv.slice(2), io = {}, lifecycle = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const keepAlive = lifecycle.keepAlive ?? true;

  let config;
  try {
    config = parseCliArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }

  if (config.command === 'help') {
    stdout.write(helpText());
    return { exitCode: 0 };
  }

  if (config.command === 'find') {
    try {
      const matches = await findTextInPdf(config.pdfPath, config.query);
      const output = config.json
        ? `${JSON.stringify({ query: config.query, matches }, null, 2)}\n`
        : formatFindResults({
          query: config.query,
          matches,
          baseUrl: config.baseUrl
        });
      stdout.write(output);
      return { exitCode: 0, matches };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  if (config.command === 'jump') {
    try {
      const result = await jumpViewer(config);
      stdout.write(`Jumped viewer to page ${result.page}: ${result.url}\n`);
      return { exitCode: 0, jump: result };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  if (config.command === 'capture') {
    try {
      const capture = await capturePageImage(config);
      stdout.write(`Captured page ${capture.page}: ${capture.outPath}\n`);
      return { exitCode: 0, capture };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  try {
    const preview = await startPreview(config);
    stdout.write(`${buildStartupMessage(preview)}\n`);
    if (config.open) {
      openInDefaultBrowser(preview.url);
    }

    if (!keepAlive) {
      return { exitCode: 0, preview };
    }

    return await new Promise((resolve) => {
      const shutdown = async () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        await preview.close();
        resolve({ exitCode: 0 });
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return { exitCode: 1 };
  }
}

export async function jumpViewer({ baseUrl, page }) {
  const jumpUrl = new URL('/jump', baseUrl);
  jumpUrl.searchParams.set('page', String(page));
  const response = await fetch(jumpUrl);
  if (!response.ok) {
    throw new Error(`Viewer rejected jump request: HTTP ${response.status}`);
  }
  return {
    page,
    url: pageUrl(baseUrl, page)
  };
}

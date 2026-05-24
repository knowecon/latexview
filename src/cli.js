import { spawn } from 'node:child_process';
import { parseCliArgs, helpText } from './args.js';
import { capturePageImage } from './capture.js';
import { formatInspectResult, inspectPdf } from './inspect.js';
import { formatPdfInfo, readPdfInfo } from './pdf-info.js';
import { findTextInPdf, formatFindResults, pageUrl } from './pdf-search.js';
import {
  getStatus,
  listLiveEntries,
  makeRegistryEntry,
  removeRegistryEntry,
  stopEntries,
  writeRegistryEntry
} from './registry.js';
import { createLatexViewServer } from './server.js';

const fallbackAttempts = 25;

function isAddressInUse(error) {
  return error && error.code === 'EADDRINUSE';
}

export function buildStartupMessage({ pdfPath, url }) {
  return [
    `latexview serving: ${pdfPath}`,
    `Viewer: ${url}`,
    `PID: ${process.pid}`,
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
      const result = {
        async close() {
          try {
            await preview.close();
          } finally {
            await removeRegistryEntry(result.port, { stateDir: config.stateDir });
          }
        },
        pdfPath: config.pdfPath,
        port: preview.address().port,
        url: viewerUrl
      };
      try {
        await writeRegistryEntry(makeRegistryEntry({ preview: result, config }), { stateDir: config.stateDir });
      } catch (error) {
        result.registryWarning = error.message;
      }
      return result;
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
    return { exitCode: 1 };
  }

  if (config.command === 'help') {
    stdout.write(helpText());
    return { exitCode: 0 };
  }

  if (config.command === 'find') {
    try {
      const matches = await findTextInPdf(config.pdfPath, config.query, {
        baseUrl: config.baseUrl
      });
      let jump = { attempted: false };
      if (config.jumpIfUnique && config.baseUrl && matches.length === 1) {
        try {
          const result = await jumpViewer({ baseUrl: config.baseUrl, page: matches[0].page });
          jump = { attempted: true, ok: true, url: result.url };
        } catch (error) {
          jump = { attempted: true, ok: false, error: error.message };
        }
      }
      const structured = {
        query: config.query,
        count: matches.length,
        matches,
        jump
      };
      const output = config.json
        ? `${JSON.stringify(structured, null, 2)}\n`
        : formatFindResults({
          query: config.query,
          matches,
          baseUrl: config.baseUrl
        });
      stdout.write(output);
      return { exitCode: 0, ...structured };
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
      stdout.write(config.json
        ? `${JSON.stringify(capture, null, 2)}\n`
        : `Captured page ${capture.page}: ${capture.outPath}\n`);
      return { exitCode: 0, capture };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  if (config.command === 'info') {
    try {
      const info = await readPdfInfo(config.pdfPath);
      stdout.write(config.json ? `${JSON.stringify(info, null, 2)}\n` : `${formatPdfInfo(info)}\n`);
      return { exitCode: 0, info };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  if (config.command === 'inspect') {
    try {
      const inspection = await inspectPdf(config.pdfPath, config);
      stdout.write(config.json ? `${JSON.stringify(inspection, null, 2)}\n` : formatInspectResult(inspection));
      return { exitCode: 0, inspection };
    } catch (error) {
      stderr.write(`${error.message}\n`);
      return { exitCode: 1 };
    }
  }

  if (config.command === 'status') {
    const status = await getStatus(config.baseUrl, { stateDir: lifecycle.stateDir });
    stdout.write(config.json
      ? `${JSON.stringify(status, null, 2)}\n`
      : `${status.ok ? `latexview ok: ${status.url}` : `${status.error}: ${status.url}`}\n`);
    return { exitCode: status.ok ? 0 : 1, status };
  }

  if (config.command === 'list') {
    const listed = await listLiveEntries({ stateDir: lifecycle.stateDir });
    if (config.json) {
      stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
    } else if (listed.entries.length === 0) {
      stdout.write('No live latexview servers.\n');
    } else {
      stdout.write(`${listed.entries.map((entry) => `${entry.pid} ${entry.url} ${entry.pdfPath}`).join('\n')}\n`);
    }
    return { exitCode: 0, list: listed };
  }

  if (config.command === 'stop') {
    const stopped = await stopEntries(config.target, { stateDir: lifecycle.stateDir });
    const failed = stopped.results.some((result) => result.status === 'failed');
    const exitCode = stopped.results.length === 0 || failed ? 1 : 0;
    stdout.write(config.json
      ? `${JSON.stringify(stopped, null, 2)}\n`
      : `${stopped.results.length === 0 ? 'No matching latexview servers.' : stopped.results.map((result) => `${result.status}: ${result.url}`).join('\n')}\n`);
    return { exitCode, stop: stopped };
  }

  try {
    config.stateDir = lifecycle.stateDir;
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

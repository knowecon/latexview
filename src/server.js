import { createReadStream, statSync, unwatchFile, watchFile } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(rootDir, 'public');
const pdfjsDir = join(rootDir, 'node_modules', 'pdfjs-dist', 'build');
const pdfjsCmapsDir = join(rootDir, 'node_modules', 'pdfjs-dist', 'cmaps');
const pdfjsStandardFontsDir = join(rootDir, 'node_modules', 'pdfjs-dist', 'standard_fonts');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.svg': 'image/svg+xml; charset=utf-8'
};

export function formatSseEvent(name, payload) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function noStoreHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    pragma: 'no-cache',
    expires: '0'
  };
}

function sendText(response, status, contentType, body) {
  response.writeHead(status, noStoreHeaders(contentType));
  response.end(body);
}

function sendJson(response, status, body) {
  sendText(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader?.startsWith('bytes=')) return null;
  const [startText, endText] = rangeHeader.slice('bytes='.length).split('-');
  const start = startText === '' ? 0 : Number(startText);
  const end = endText === '' ? size - 1 : Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function serveFile(response, filePath, contentType) {
  const body = await readFile(filePath);
  response.writeHead(200, noStoreHeaders(contentType));
  response.end(body);
}

function safeVendorPath(baseDir, pathname, prefix) {
  const rawName = decodeURIComponent(pathname.slice(prefix.length));
  if (!rawName || rawName.includes('..') || rawName.includes('/')) {
    return null;
  }
  return join(baseDir, rawName);
}

async function servePdf(request, response, pdfPath) {
  const pdfStat = await stat(pdfPath);
  const range = parseRange(request.headers.range, pdfStat.size);

  if (range) {
    response.writeHead(206, {
      ...noStoreHeaders('application/pdf'),
      'accept-ranges': 'bytes',
      'content-range': `bytes ${range.start}-${range.end}/${pdfStat.size}`,
      'content-length': String(range.end - range.start + 1)
    });
    createReadStream(pdfPath, range).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...noStoreHeaders('application/pdf'),
    'accept-ranges': 'bytes',
    'content-length': String(pdfStat.size)
  });
  createReadStream(pdfPath).pipe(response);
}

function isViewerRoute(pathname) {
  return pathname === '/'
    || pathname === '/index.html'
    || pathname === '/viewer'
    || pathname.startsWith('/page/');
}

function initialVersion(pdfPath) {
  try {
    const pdfStat = statSync(pdfPath);
    return Math.max(1, Math.trunc(pdfStat.mtimeMs));
  } catch {
    return Date.now();
  }
}

export function createLatexViewServer(options) {
  const pdfPath = resolve(options.pdfPath);
  const pdfName = options.pdfName ?? pdfPath.split('/').at(-1);
  const clients = new Set();
  const watch = options.watch ?? true;
  const watchIntervalMs = options.watchIntervalMs ?? 350;
  let version = initialVersion(pdfPath);
  let server;

  function broadcast(name, payload) {
    const message = formatSseEvent(name, payload);
    for (const client of clients) {
      client.write(message);
    }
  }

  function broadcastUpdate(payload = {}) {
    version = payload.version ?? Date.now();
    broadcast('update', {
      version,
      pdfName,
      ...payload
    });
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end();
        return;
      }

      if (url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          app: 'latexview',
          schemaVersion: 2,
          version,
          pdfName
        });
        return;
      }

      if (url.pathname === '/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        response.write(formatSseEvent('ready', { version, pdfName }));
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }

      if (url.pathname === '/jump') {
        const page = Number(url.searchParams.get('page'));
        if (!Number.isInteger(page) || page < 1) {
          sendJson(response, 400, { ok: false, error: 'page must be a positive integer' });
          return;
        }
        broadcast('jump', { page, version, pdfName });
        sendJson(response, 200, { ok: true, page, url: `/?page=${page}` });
        return;
      }

      if (url.pathname === '/document.pdf') {
        await servePdf(request, response, pdfPath);
        return;
      }

      if (url.pathname === '/client.js') {
        await serveFile(response, join(publicDir, 'client.js'), mimeTypes['.js']);
        return;
      }

      if (url.pathname === '/styles.css') {
        await serveFile(response, join(publicDir, 'styles.css'), mimeTypes['.css']);
        return;
      }

      if (url.pathname === '/vendor/pdf.mjs') {
        await serveFile(response, join(pdfjsDir, 'pdf.mjs'), mimeTypes['.mjs']);
        return;
      }

      if (url.pathname === '/vendor/pdf.worker.mjs') {
        await serveFile(response, join(pdfjsDir, 'pdf.worker.mjs'), mimeTypes['.mjs']);
        return;
      }

      if (url.pathname.startsWith('/vendor/cmaps/')) {
        const filePath = safeVendorPath(pdfjsCmapsDir, url.pathname, '/vendor/cmaps/');
        if (!filePath) {
          response.writeHead(404, noStoreHeaders('text/plain; charset=utf-8'));
          response.end('Not found');
          return;
        }
        await serveFile(response, filePath, mimeTypes[extname(filePath)] ?? 'application/octet-stream');
        return;
      }

      if (url.pathname.startsWith('/vendor/standard_fonts/')) {
        const filePath = safeVendorPath(pdfjsStandardFontsDir, url.pathname, '/vendor/standard_fonts/');
        if (!filePath) {
          response.writeHead(404, noStoreHeaders('text/plain; charset=utf-8'));
          response.end('Not found');
          return;
        }
        await serveFile(response, filePath, mimeTypes[extname(filePath)] ?? 'application/octet-stream');
        return;
      }

      if (isViewerRoute(url.pathname)) {
        await serveFile(response, join(publicDir, 'index.html'), mimeTypes['.html']);
        return;
      }

      const ext = extname(url.pathname);
      if (ext && mimeTypes[ext]) {
        response.writeHead(404, noStoreHeaders('text/plain; charset=utf-8'));
        response.end('Not found');
        return;
      }

      await serveFile(response, join(publicDir, 'index.html'), mimeTypes['.html']);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  }

  async function listen({ host, port }) {
    await access(pdfPath);
    server = createServer(handleRequest);

    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, host, () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });

    if (watch) {
      watchFile(pdfPath, { interval: watchIntervalMs }, (current, previous) => {
        if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
          broadcastUpdate({
            version: Math.trunc(current.mtimeMs || Date.now()),
            mtimeMs: current.mtimeMs,
            size: current.size
          });
        }
      });
    }
  }

  async function close() {
    unwatchFile(pdfPath);
    for (const client of clients) {
      client.end();
    }
    clients.clear();
    if (!server?.listening) return;
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    });
  }

  function address() {
    return server?.address();
  }

  function url({ page = 1 } = {}) {
    const currentAddress = address();
    if (!currentAddress || typeof currentAddress === 'string') {
      throw new Error('Server is not listening.');
    }
    const host = currentAddress.address === '0.0.0.0' || currentAddress.address === '::'
      ? '127.0.0.1'
      : currentAddress.address;
    return `http://${host}:${currentAddress.port}/?page=${page}`;
  }

  return {
    address,
    broadcastUpdate,
    close,
    listen,
    url
  };
}

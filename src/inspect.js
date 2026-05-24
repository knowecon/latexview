import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPdfDocument, readPageText, readPdfInfo } from './pdf-info.js';
import { resolvePageSelection } from './page-selection.js';

function normalizeLength(text) {
  return text.normalize('NFKC').replace(/\s+/g, '').length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function execFilePromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parsePpm(buffer) {
  let index = 0;

  function skipWhitespaceAndComments() {
    while (index < buffer.length) {
      const byte = buffer[index];
      if (byte === 35) {
        while (index < buffer.length && buffer[index] !== 10) index += 1;
      } else if (byte === 9 || byte === 10 || byte === 13 || byte === 32) {
        index += 1;
      } else {
        break;
      }
    }
  }

  function readToken() {
    skipWhitespaceAndComments();
    const start = index;
    while (index < buffer.length) {
      const byte = buffer[index];
      if (byte === 9 || byte === 10 || byte === 13 || byte === 32) break;
      index += 1;
    }
    return buffer.toString('ascii', start, index);
  }

  const magic = readToken();
  if (magic !== 'P6') {
    throw new Error('Rendered page is not a binary PPM image.');
  }
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(maxValue) || maxValue < 1) {
    throw new Error('Rendered page has an invalid PPM header.');
  }
  skipWhitespaceAndComments();
  return {
    width,
    height,
    maxValue,
    dataOffset: index
  };
}

function pixelCoverageFromPpm(buffer) {
  const { width, height, maxValue, dataOffset } = parsePpm(buffer);
  const samples = 64;
  let visible = 0;
  let checked = 0;
  const whiteThreshold = Math.round((245 / 255) * maxValue);

  for (let sy = 0; sy < samples; sy += 1) {
    const y = Math.min(height - 1, Math.floor((sy + 0.5) * height / samples));
    for (let sx = 0; sx < samples; sx += 1) {
      const x = Math.min(width - 1, Math.floor((sx + 0.5) * width / samples));
      const offset = dataOffset + (y * width + x) * 3;
      if (offset + 2 >= buffer.length) continue;
      checked += 1;
      const r = buffer[offset];
      const g = buffer[offset + 1];
      const b = buffer[offset + 2];
      if (!(r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold)) {
        visible += 1;
      }
    }
  }

  return checked === 0 ? 0 : visible / checked;
}

async function renderPageCoverage(pdfPath, page, dpi) {
  const tempDir = await mkdtemp(join(tmpdir(), 'latexview-inspect-'));
  const prefix = join(tempDir, 'page');
  const ppmPath = `${prefix}.ppm`;

  try {
    await execFilePromise('pdftoppm', [
      '-f',
      String(page),
      '-l',
      String(page),
      '-singlefile',
      '-r',
      String(dpi),
      pdfPath,
      prefix
    ]);
    return pixelCoverageFromPpm(await readFile(ppmPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function blankWarnings(normalizedTextLength, pixelCoverage) {
  if (pixelCoverage === null) return [];
  if (normalizedTextLength < 16 && pixelCoverage < 0.005) return ['blank'];
  if (normalizedTextLength === 0 && pixelCoverage >= 0.02) return ['text-extraction-empty'];
  if (
    pixelCoverage < 0.02
    || (normalizedTextLength > 0 && normalizedTextLength < 64 && pixelCoverage < 0.10)
  ) {
    return ['near-blank'];
  }
  return [];
}

export async function inspectPdf(pdfPath, options = {}) {
  const info = await readPdfInfo(pdfPath);
  const selectedPages = resolvePageSelection(options.pageSelection ?? { type: 'default' }, {
    numPages: info.pdf.numPages
  });
  const medianWidth = median(info.pdf.pages.map((page) => page.width));
  const medianHeight = median(info.pdf.pages.map((page) => page.height));
  const document = await loadPdfDocument(pdfPath);
  const pages = [];

  try {
    for (const pageNumber of selectedPages) {
      const metadata = info.pdf.pages[pageNumber - 1];
      const text = await readPageText(document, pageNumber);
      const textLength = text.length;
      const normalizedTextLength = normalizeLength(text);
      let pixelCoverage = null;
      const warnings = [];

      if (Math.abs(metadata.width - medianWidth) / medianWidth > 0.2 || Math.abs(metadata.height - medianHeight) / medianHeight > 0.2) {
        warnings.push('oversize-page');
      }

      if (options.capture) {
        try {
          pixelCoverage = await renderPageCoverage(pdfPath, pageNumber, options.dpi ?? 72);
          warnings.push(...blankWarnings(normalizedTextLength, pixelCoverage));
        } catch {
          warnings.push('render-failed');
        }
      }

      pages.push({
        page: pageNumber,
        width: metadata.width,
        height: metadata.height,
        textLength,
        normalizedTextLength,
        pixelCoverage,
        warnings
      });
    }
  } finally {
    await document.destroy();
  }

  const warningSummary = {};
  for (const page of pages) {
    for (const warning of page.warnings) {
      warningSummary[warning] ??= [];
      warningSummary[warning].push(page.page);
    }
  }

  return {
    pdfPath,
    numPages: info.pdf.numPages,
    pages,
    summary: {
      checked: pages.length,
      warningCount: pages.filter((page) => page.warnings.length > 0).length,
      warnings: warningSummary
    }
  };
}

export function formatInspectResult(result) {
  const lines = [
    `${result.pdfPath.split('/').at(-1)}: checked ${result.summary.checked} of ${result.numPages} pages`
  ];
  if (result.summary.warningCount === 0) {
    lines.push('No warnings.');
    return `${lines.join('\n')}\n`;
  }
  for (const [warning, pages] of Object.entries(result.summary.warnings)) {
    lines.push(`${warning}: pages ${pages.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

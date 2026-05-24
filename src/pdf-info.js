import { readFile, stat } from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function loadPdfDocument(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath));
  return pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  }).promise;
}

export async function readPageText(document, pageNumber) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ');
}

export async function readPdfInfo(pdfPath) {
  const [file, document] = await Promise.all([
    stat(pdfPath),
    loadPdfDocument(pdfPath)
  ]);

  try {
    let metadata = {};
    try {
      const result = await document.getMetadata();
      metadata = result?.info ?? {};
    } catch {
      metadata = {};
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation
      });
    }

    return {
      pdfPath,
      file: {
        size: file.size,
        mtimeMs: file.mtimeMs
      },
      pdf: {
        numPages: document.numPages,
        fingerprint: document.fingerprints?.[0],
        metadata,
        pages
      }
    };
  } finally {
    await document.destroy();
  }
}

export function formatPdfInfo(info) {
  const firstPage = info.pdf.pages[0];
  const modified = new Date(info.file.mtimeMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const sizeMb = info.file.size / (1024 * 1024);
  return [
    info.pdfPath.split('/').at(-1),
    `Pages: ${info.pdf.numPages}`,
    firstPage ? `Page 1: ${firstPage.width} x ${firstPage.height} pt` : 'Page 1: unavailable',
    `Size: ${sizeMb >= 0.1 ? `${sizeMb.toFixed(1)} MB` : `${info.file.size} bytes`}`,
    `Modified: ${modified}`
  ].join('\n');
}

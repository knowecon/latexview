import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, startPreview } from '../src/cli.js';

function pdfStringLiteral(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function makePdf(pageTexts) {
  const objects = [];
  const pageObjectIds = [];
  const fontObjectId = 3 + pageTexts.length * 2;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '';

  pageTexts.forEach((text, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);

    objects[pageObjectId] = [
      '<< /Type /Page',
      '/Parent 2 0 R',
      '/MediaBox [0 0 612 792]',
      `/Contents ${contentObjectId} 0 R`,
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
      '>>'
    ].join(' ');

    const stream = `BT /F1 28 Tf 72 720 Td (${pdfStringLiteral(text)}) Tj ET`;
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`;
  objects[fontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) {
      throw error;
    }
    return await chromium.launch({ headless: true, channel: 'chrome' });
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canvasSignature(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('pdf-canvas');
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let signature = 0;
    for (let index = 0; index < data.length; index += 16) {
      signature = (signature + data[index] * 3 + data[index + 1] * 5 + data[index + 2] * 7) % 1000000007;
    }
    return signature;
  });
}

const dir = await mkdtemp(join(tmpdir(), 'latexview-smoke-'));
const pdfPath = join(dir, 'main.pdf');
let browser;
let preview;

try {
  await writeFile(pdfPath, makePdf(['page one', 'page two']));
  preview = await startPreview({
    pdfPath,
    host: '127.0.0.1',
    port: 0,
    page: 2,
    requestedPort: true
  });

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(preview.url, { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const canvas = document.getElementById('pdf-canvas');
    const input = document.getElementById('page-input');
    return canvas.width > 0 && canvas.height > 0 && input.value === '2';
  });

  await page.waitForFunction(() => {
    const rail = document.getElementById('thumbnail-rail');
    const rendered = document.querySelectorAll('.thumbnail-card canvas').length;
    return rail && rendered > 0 && rendered <= 12;
  }, null, { timeout: 10000 });

  await page.locator('.thumbnail-card[data-page="1"]').click();
  await page.waitForFunction(() => {
    return document.getElementById('page-input').value === '1' && window.location.search === '?page=1';
  }, null, { timeout: 5000 });

  await page.locator('.thumbnail-card[data-page="2"]').click();
  await page.waitForFunction(() => {
    return document.getElementById('page-input').value === '2' && window.location.search === '?page=2';
  }, null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const canvas = document.getElementById('pdf-canvas');
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
        return true;
      }
    }
    return false;
  }, null, { timeout: 5000 });

  const nonWhitePixels = await page.evaluate(() => {
    const canvas = document.getElementById('pdf-canvas');
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
        count += 1;
      }
    }
    return count;
  });

  if (nonWhitePixels < 50) {
    throw new Error(`Canvas looked blank: ${nonWhitePixels} non-white pixels`);
  }

  const initialVersion = await page.evaluate(() => document.documentElement.dataset.latexviewVersion);
  const initialSignature = await canvasSignature(page);
  await wait(600);
  await writeFile(pdfPath, makePdf(['updated one', 'updated two']));
  await page.waitForFunction((previousVersion) => {
    return document.documentElement.dataset.latexviewVersion !== previousVersion;
  }, initialVersion, { timeout: 10000 });
  await page.waitForFunction(() => {
    const input = document.getElementById('page-input');
    const status = document.getElementById('status');
    return input.value === '2' && status.textContent === 'live';
  }, null, { timeout: 5000 });
  await page.waitForFunction((previousSignature) => {
    const canvas = document.getElementById('pdf-canvas');
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let signature = 0;
    for (let index = 0; index < data.length; index += 16) {
      signature = (signature + data[index] * 3 + data[index + 1] * 5 + data[index + 2] * 7) % 1000000007;
    }
    return signature !== previousSignature;
  }, initialSignature, { timeout: 10000 });

  const currentUrl = page.url();
  if (!currentUrl.endsWith('/?page=2')) {
    throw new Error(`Expected page URL to stay on page 2, got ${currentUrl}`);
  }

  const jumpResult = await runCli([
    'jump',
    '--url',
    new URL(preview.url).origin,
    '1'
  ], {
    stdout: { write() {} },
    stderr: { write(text) { throw new Error(text); } }
  }, {
    keepAlive: false
  });
  if (jumpResult.exitCode !== 0) {
    throw new Error(`latexview jump failed with exit code ${jumpResult.exitCode}`);
  }
  await page.waitForFunction(() => {
    return document.getElementById('page-input').value === '1' && window.location.search === '?page=1';
  }, null, { timeout: 5000 });

  console.log(`smoke ok: ${preview.url}`);
} finally {
  await browser?.close();
  await preview?.close();
  await rm(dir, { recursive: true, force: true });
}

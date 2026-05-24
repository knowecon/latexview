import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStartupMessage, runCli, startPreview } from '../src/cli.js';
import { makePdf } from './pdf-fixture.js';

const previews = [];

afterEach(async () => {
  await Promise.all(previews.splice(0).map((preview) => preview.close()));
});

async function makePdfFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'latexview-cli-'));
  const pdfPath = join(dir, 'main.pdf');
  await writeFile(pdfPath, '%PDF-1.4\n% cli demo bytes\n%%EOF\n');
  return {
    pdfPath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

describe('cli startup', () => {
  test('starts a preview server and returns a page-specific URL', async () => {
    const fixture = await makePdfFixture();
    try {
      const preview = await startPreview({
        pdfPath: fixture.pdfPath,
        host: '127.0.0.1',
        port: 0,
        page: 9,
        requestedPort: true
      });
      previews.push(preview);

      expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?page=9$/);
      const response = await fetch(preview.url);
      expect(response.status).toBe(200);
    } finally {
      await fixture.cleanup();
    }
  });

  test('prints the PDF path, URL, and stop hint', () => {
    const message = buildStartupMessage({
      pdfPath: '/tmp/book/main.pdf',
      url: 'http://127.0.0.1:4545/?page=1'
    });

    expect(message).toContain('latexview serving');
    expect(message).toContain('/tmp/book/main.pdf');
    expect(message).toContain('http://127.0.0.1:4545/?page=1');
    expect(message).toContain('Ctrl+C');
  });

  test('runCli can start a server in non-blocking mode for tests', async () => {
    const fixture = await makePdfFixture();
    const output = [];
    const errors = [];

    try {
      const result = await runCli([
        '--port',
        '0',
        '--page',
        '4',
        fixture.pdfPath
      ], {
        stdout: { write: (text) => output.push(text) },
        stderr: { write: (text) => errors.push(text) }
      }, {
        keepAlive: false
      });

      previews.push(result.preview);

      expect(result.exitCode).toBe(0);
      expect(errors.join('')).toBe('');
      expect(output.join('')).toContain('?page=4');

      const response = await fetch(result.preview.url);
      expect(response.status).toBe(200);
    } finally {
      await fixture.cleanup();
    }
  });

  test('runCli find prints matching candidate pages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-cli-find-'));
    const pdfPath = join(dir, 'main.pdf');
    const output = [];
    const errors = [];

    try {
      await writeFile(pdfPath, makePdf([
        'first page',
        'shared phrase appears here',
        'shared phrase appears again'
      ]));

      const result = await runCli(['find', pdfPath, 'shared phrase'], {
        stdout: { write: (text) => output.push(text) },
        stderr: { write: (text) => errors.push(text) }
      }, {
        keepAlive: false
      });

      expect(result.exitCode).toBe(0);
      expect(errors.join('')).toBe('');
      expect(output.join('')).toContain('page 2');
      expect(output.join('')).toContain('page 3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('runCli capture writes a WebP for the requested page', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-cli-capture-'));
    const pdfPath = join(dir, 'main.pdf');
    const requestedOutPath = join(dir, 'page-2.png');
    const webpOutPath = join(dir, 'page-2.webp');
    const output = [];
    const errors = [];

    try {
      await writeFile(pdfPath, makePdf([
        'first page',
        'second page screenshot target'
      ]));

      const result = await runCli([
        'capture',
        pdfPath,
        '2',
        '--out',
        requestedOutPath
      ], {
        stdout: { write: (text) => output.push(text) },
        stderr: { write: (text) => errors.push(text) }
      }, {
        keepAlive: false
      });

      expect(result.exitCode).toBe(0);
      expect(errors.join('')).toBe('');
      expect(output.join('')).toContain('page 2');
      expect(output.join('')).toContain(webpOutPath);

      const bytes = await readFile(webpOutPath);
      expect(bytes.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(bytes.slice(8, 12).toString('ascii')).toBe('WEBP');
      expect(bytes.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

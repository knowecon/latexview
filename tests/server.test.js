import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLatexViewServer, formatSseEvent } from '../src/server.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((preview) => preview.close()));
});

async function makePdfFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'latexview-'));
  const pdfPath = join(dir, 'main.pdf');
  await writeFile(pdfPath, '%PDF-1.4\n% demo bytes\n%%EOF\n');
  return {
    dir,
    pdfPath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function listen(preview) {
  await preview.listen({ host: '127.0.0.1', port: 0 });
  servers.push(preview);
  return preview.url({ page: 3 });
}

async function readUntil(reader, expectedText) {
  const decoder = new TextDecoder();
  let text = '';
  for (let i = 0; i < 20; i += 1) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.includes(expectedText)) return text;
  }
  return text;
}

describe('server', () => {
  test('formats server-sent events as named JSON payloads', () => {
    expect(formatSseEvent('update', { version: 123 })).toBe(
      'event: update\ndata: {"version":123}\n\n'
    );
  });

  test('serves the viewer shell and the watched PDF bytes', async () => {
    const fixture = await makePdfFixture();
    try {
      const preview = createLatexViewServer({ pdfPath: fixture.pdfPath, watch: false });
      const url = await listen(preview);
      const baseUrl = new URL(url).origin;

      const shell = await fetch(`${baseUrl}/?page=3`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get('content-type')).toContain('text/html');
      expect(await shell.text()).toContain('id="pdf-canvas"');

      const pdf = await fetch(`${baseUrl}/document.pdf?version=1`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toContain('application/pdf');
      expect(await pdf.text()).toContain('%PDF-1.4');
    } finally {
      await fixture.cleanup();
    }
  });

  test('streams update events without changing the client page URL', async () => {
    const fixture = await makePdfFixture();
    try {
      const preview = createLatexViewServer({ pdfPath: fixture.pdfPath, watch: false });
      const url = await listen(preview);
      expect(url).toMatch(/\?page=3$/);

      const events = await fetch(`${new URL(url).origin}/events`);
      expect(events.status).toBe(200);
      const reader = events.body.getReader();

      preview.broadcastUpdate({ version: 456, reason: 'test' });
      const text = await readUntil(reader, '"version":456');
      await reader.cancel();

      expect(text).toContain('event: update');
      expect(text).toContain('"reason":"test"');
    } finally {
      await fixture.cleanup();
    }
  });

  test('jump endpoint streams page navigation events', async () => {
    const fixture = await makePdfFixture();
    try {
      const preview = createLatexViewServer({ pdfPath: fixture.pdfPath, watch: false });
      const url = await listen(preview);
      const baseUrl = new URL(url).origin;

      const events = await fetch(`${baseUrl}/events`);
      const reader = events.body.getReader();

      const response = await fetch(`${baseUrl}/jump?page=8`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, page: 8 });

      const text = await readUntil(reader, '"page":8');
      await reader.cancel();
      expect(text).toContain('event: jump');
    } finally {
      await fixture.cleanup();
    }
  });

  test('health endpoint exposes latexview identity without the absolute PDF path', async () => {
    const fixture = await makePdfFixture();
    try {
      const preview = createLatexViewServer({ pdfPath: fixture.pdfPath, watch: false });
      const url = await listen(preview);
      const baseUrl = new URL(url).origin;

      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      const health = await response.json();
      expect(health).toMatchObject({
        ok: true,
        app: 'latexview',
        schemaVersion: 2,
        pdfName: 'main.pdf'
      });
      expect(health).not.toHaveProperty('pdfPath');
      expect(Number.isInteger(health.version)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });
});

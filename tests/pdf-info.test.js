import { describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPdfInfo } from '../src/pdf-info.js';
import { makePdf } from './pdf-fixture.js';

describe('readPdfInfo', () => {
  test('returns file metadata, page count, and page dimensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-info-'));
    const pdfPath = join(dir, 'main.pdf');

    try {
      await writeFile(pdfPath, makePdf(['first page', 'second page']));
      const info = await readPdfInfo(pdfPath);

      expect(info.pdfPath).toBe(pdfPath);
      expect(info.file.size).toBeGreaterThan(0);
      expect(info.file.mtimeMs).toBeGreaterThan(0);
      expect(info.pdf.numPages).toBe(2);
      expect(info.pdf.pages).toHaveLength(2);
      expect(info.pdf.pages[0]).toMatchObject({
        page: 1,
        width: 612,
        height: 792,
        rotation: 0
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

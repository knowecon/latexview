import { describe, expect, test } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPdf } from '../src/inspect.js';
import { makePdf } from './pdf-fixture.js';

describe('inspectPdf', () => {
  test('inspects selected pages without returning image artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-inspect-'));
    const pdfPath = join(dir, 'main.pdf');

    try {
      await writeFile(pdfPath, makePdf(['first page', 'middle page', 'last page']));
      const result = await inspectPdf(pdfPath, {
        pageSelection: { type: 'pages', value: 'first,last' },
        capture: true,
        dpi: 72
      });

      expect(result.numPages).toBe(3);
      expect(result.pages.map((page) => page.page)).toEqual([1, 3]);
      expect(result.pages[0]).not.toHaveProperty('capturePath');
      expect(result.pages[0].pixelCoverage).not.toBeNull();
      expect(result.summary.checked).toBe(2);

      const files = await readdir(dir);
      expect(files.filter((name) => name.endsWith('.webp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTextInPdf, formatFindResults } from '../src/pdf-search.js';
import { makePdf } from './pdf-fixture.js';

async function withPdf(pageTexts, callback) {
  const dir = await mkdtemp(join(tmpdir(), 'latexview-search-'));
  const pdfPath = join(dir, 'main.pdf');
  await writeFile(pdfPath, makePdf(pageTexts));
  try {
    return await callback(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('PDF text search', () => {
  test('returns every page whose extracted text contains the query', async () => {
    await withPdf([
      'marketing channels and logistics',
      'rare exact phrase for search',
      'another rare exact phrase for search'
    ], async (pdfPath) => {
      const matches = await findTextInPdf(pdfPath, 'rare exact phrase');

      expect(matches.map((match) => match.page)).toEqual([2, 3]);
      expect(matches[0].snippet).toContain('rare exact phrase');
    });
  });

  test('matches across whitespace differences for copied TeX/PDF text', async () => {
    await withPdf(['alpha beta gamma'], async (pdfPath) => {
      const matches = await findTextInPdf(pdfPath, 'alpha   beta');

      expect(matches.map((match) => match.page)).toEqual([1]);
    });
  });

  test('formats candidate pages with optional viewer URLs', () => {
    const text = formatFindResults({
      query: 'needle',
      matches: [{ page: 4, snippet: '... needle ...' }],
      baseUrl: 'http://127.0.0.1:4545/?page=1'
    });

    expect(text).toContain('page 4');
    expect(text).toContain('http://127.0.0.1:4545/?page=4');
    expect(text).toContain('... needle ...');
  });

  test('preserves original-case snippets and includes URLs in JSON-ready matches', async () => {
    await withPdf(['Intro page', 'Rare Exact Phrase Lives Here'], async (pdfPath) => {
      const matches = await findTextInPdf(pdfPath, 'rare exact phrase', {
        baseUrl: 'http://127.0.0.1:4550/?page=1'
      });

      expect(matches).toEqual([
        expect.objectContaining({
          page: 2,
          snippet: expect.stringContaining('Rare Exact Phrase'),
          url: 'http://127.0.0.1:4550/?page=2'
        })
      ]);
    });
  });

  test('matches soft hyphen and line-end hyphenation differences', async () => {
    await withPdf(['micro\u00adeconomics and macro- economics'], async (pdfPath) => {
      expect((await findTextInPdf(pdfPath, 'microeconomics')).map((match) => match.page)).toEqual([1]);
      expect((await findTextInPdf(pdfPath, 'macroeconomics')).map((match) => match.page)).toEqual([1]);
    });
  });
});

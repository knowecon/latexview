import { readFile } from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function normalizeText(text) {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function compactText(text) {
  return normalizeText(text).replace(/\s+/g, '');
}

function makeSnippet(text, query) {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  let index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) index = 0;

  const start = Math.max(0, index - 48);
  const end = Math.min(normalizedText.length, index + normalizedQuery.length + 72);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

export function pageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  url.pathname = '/';
  url.searchParams.set('page', String(page));
  return url.toString();
}

export async function findTextInPdf(pdfPath, query) {
  const data = new Uint8Array(await readFile(pdfPath));
  const document = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  }).promise;
  const normalizedQuery = normalizeText(query);
  const compactQuery = compactText(query);
  const matches = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(' ');
      const normalized = normalizeText(text);
      const compact = compactText(text);

      if (normalized.includes(normalizedQuery) || compact.includes(compactQuery)) {
        matches.push({
          page: pageNumber,
          snippet: makeSnippet(text, query)
        });
      }
    }
  } finally {
    await document.destroy();
  }

  return matches;
}

export function formatFindResults({ query, matches, baseUrl }) {
  if (matches.length === 0) {
    return `No candidate pages found for "${query}".\n`;
  }

  const lines = [`Found ${matches.length} candidate page${matches.length === 1 ? '' : 's'} for "${query}":`];
  for (const match of matches) {
    const url = baseUrl ? `  ${pageUrl(baseUrl, match.page)}` : '';
    lines.push(`page ${match.page}${url}`);
    if (match.snippet) {
      lines.push(`  ${match.snippet}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

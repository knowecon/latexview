function parseEndpoint(value, numPages) {
  if (value === 'first') return 1;
  if (value === 'last') return numPages;
  if (value === 'middle') return Math.floor((numPages + 1) / 2);

  const page = Number(value);
  if (!Number.isInteger(page)) {
    throw new Error(`unknown page alias: ${value}`);
  }
  if (page < 1) {
    throw new Error(`page must be positive: ${value}`);
  }
  if (page > numPages) {
    throw new Error(`page ${page} is out of range; PDF has ${numPages} pages.`);
  }
  return page;
}

function expandAtom(atom, numPages) {
  const trimmed = atom.trim();
  if (!trimmed) {
    throw new Error('empty page atom in page selection.');
  }

  const rangeMatch = trimmed.match(/^([A-Za-z]+|\d+)-([A-Za-z]+|\d+)$/);
  if (!rangeMatch) {
    return [parseEndpoint(trimmed, numPages)];
  }

  const start = parseEndpoint(rangeMatch[1], numPages);
  const end = parseEndpoint(rangeMatch[2], numPages);
  if (end < start) {
    throw new Error(`reversed page range: ${trimmed}`);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function enforceMaxPages(pages, maxPages) {
  if (maxPages !== undefined && pages.length > maxPages) {
    throw new Error(`selected ${pages.length} pages; pass a larger --max-pages to inspect more than ${maxPages} pages.`);
  }
}

export function resolvePageSelection(selection = { type: 'default' }, { numPages }) {
  const maxPages = selection.maxPages;
  let pages;

  if (selection.type === 'default') {
    pages = [1, Math.floor((numPages + 1) / 2), numPages];
  } else if (selection.type === 'all') {
    if (numPages > 50 && maxPages === undefined) {
      throw new Error('--all requires an explicit --max-pages for PDFs with more than 50 pages.');
    }
    pages = Array.from({ length: numPages }, (_, index) => index + 1);
  } else if (selection.type === 'pages') {
    pages = selection.value.split(',').flatMap((atom) => expandAtom(atom, numPages));
  } else if (selection.type === 'range') {
    pages = expandAtom(selection.value, numPages);
  } else if (selection.type === 'fromTo') {
    const start = parseEndpoint(selection.from, numPages);
    const end = parseEndpoint(selection.to, numPages);
    if (end < start) {
      throw new Error(`reversed page range: ${selection.from}-${selection.to}`);
    }
    pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  } else {
    throw new Error(`unknown page selection type: ${selection.type}`);
  }

  const unique = [...new Set(pages)].sort((a, b) => a - b);
  enforceMaxPages(unique, maxPages);
  return unique;
}

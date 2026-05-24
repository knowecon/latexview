import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../src/args.js';

describe('parseCliArgs', () => {
  test('uses a resolved PDF path and conservative local defaults', () => {
    const parsed = parseCliArgs(['main.pdf'], { cwd: '/tmp/book' });

    expect(parsed).toEqual({
      command: 'serve',
      pdfPath: '/tmp/book/main.pdf',
      host: '127.0.0.1',
      port: 4545,
      page: 1,
      open: false,
      requestedPort: false
    });
  });

  test('accepts host, port, page, and open options', () => {
    const parsed = parseCliArgs([
      '--host',
      '0.0.0.0',
      '--port',
      '7788',
      '--page',
      '12',
      '--open',
      './draft.pdf'
    ], { cwd: '/tmp/book' });

    expect(parsed).toMatchObject({
      pdfPath: '/tmp/book/draft.pdf',
      host: '0.0.0.0',
      port: 7788,
      page: 12,
      open: true,
      requestedPort: true
    });
  });

  test('returns help instead of requiring a PDF when --help is present', () => {
    expect(parseCliArgs(['--help'])).toEqual({ command: 'help' });
  });

  test('parses find command with optional viewer URL', () => {
    const parsed = parseCliArgs([
      'find',
      '--url',
      'http://127.0.0.1:4545/?page=1',
      'main.pdf',
      'rare exact phrase'
    ], { cwd: '/tmp/book' });

    expect(parsed).toEqual({
      command: 'find',
      pdfPath: '/tmp/book/main.pdf',
      query: 'rare exact phrase',
      baseUrl: 'http://127.0.0.1:4545/?page=1',
      json: false
    });
  });

  test('parses jump command with default local viewer URL', () => {
    expect(parseCliArgs(['jump', '42'])).toEqual({
      command: 'jump',
      page: 42,
      baseUrl: 'http://127.0.0.1:4545'
    });
  });

  test('parses capture command with WebP output path and dpi', () => {
    expect(parseCliArgs([
      'capture',
      '--out',
      '/tmp/page-7.png',
      '--dpi',
      '144',
      'main.pdf',
      '7'
    ], { cwd: '/tmp/book' })).toEqual({
      command: 'capture',
      pdfPath: '/tmp/book/main.pdf',
      page: 7,
      outPath: '/tmp/page-7.webp',
      dpi: 144
    });
  });

  test('defaults capture output to a clear WebP image', () => {
    expect(parseCliArgs([
      'capture',
      'main.pdf',
      '7'
    ], { cwd: '/tmp/book' })).toEqual({
      command: 'capture',
      pdfPath: '/tmp/book/main.pdf',
      page: 7,
      outPath: '/tmp/book/main-page-7.webp',
      dpi: 216
    });
  });

  test('rejects missing or invalid page arguments', () => {
    expect(() => parseCliArgs([])).toThrow(/Usage: latexview/);
    expect(() => parseCliArgs(['--page', '0', 'main.pdf'])).toThrow(/page/i);
    expect(() => parseCliArgs(['jump', '0'])).toThrow(/page/i);
    expect(() => parseCliArgs(['capture', 'main.pdf', '0'])).toThrow(/page/i);
    expect(() => parseCliArgs(['capture', '--dpi', '0', 'main.pdf', '1'])).toThrow(/dpi/i);
  });
});

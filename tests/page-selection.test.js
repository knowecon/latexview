import { describe, expect, test } from 'vitest';
import { resolvePageSelection } from '../src/page-selection.js';

describe('page selection', () => {
  test('resolves default and aliases', () => {
    expect(resolvePageSelection({ type: 'default' }, { numPages: 9 })).toEqual([1, 5, 9]);
    expect(resolvePageSelection({ type: 'pages', value: 'last,first,middle' }, { numPages: 10 })).toEqual([1, 5, 10]);
  });

  test('resolves ranges and removes duplicates', () => {
    expect(resolvePageSelection({ type: 'pages', value: '1-3,2,last' }, { numPages: 5 })).toEqual([1, 2, 3, 5]);
    expect(resolvePageSelection({ type: 'range', value: 'middle-last' }, { numPages: 5 })).toEqual([3, 4, 5]);
    expect(resolvePageSelection({ type: 'fromTo', from: 'first', to: 'middle' }, { numPages: 6 })).toEqual([1, 2, 3]);
  });

  test('guards large all selections and max page counts', () => {
    expect(() => resolvePageSelection({ type: 'all' }, { numPages: 51 })).toThrow(/max-pages/i);
    expect(resolvePageSelection({ type: 'all', maxPages: 51 }, { numPages: 51 })).toHaveLength(51);
    expect(() => resolvePageSelection({ type: 'pages', value: '1-4', maxPages: 3 }, { numPages: 10 })).toThrow(/max-pages/i);
  });

  test('rejects invalid page specs before work starts', () => {
    expect(() => resolvePageSelection({ type: 'pages', value: '0' }, { numPages: 5 })).toThrow(/page/i);
    expect(() => resolvePageSelection({ type: 'range', value: '5-2' }, { numPages: 5 })).toThrow(/reversed/i);
    expect(() => resolvePageSelection({ type: 'pages', value: 'second' }, { numPages: 5 })).toThrow(/unknown/i);
  });
});

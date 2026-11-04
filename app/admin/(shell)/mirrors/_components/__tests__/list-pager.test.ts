import { describe, it, expect } from 'vitest';
import { parsePageParams } from '../ListPager';

describe('parsePageParams', () => {
  it('defaults to page 1 of 50', () => {
    expect(parsePageParams({}, 84)).toEqual({ page: 1, size: 50, pageCount: 2 });
  });
  it('accepts the offered sizes and all', () => {
    expect(parsePageParams({ size: '100' }, 84)).toEqual({ page: 1, size: 100, pageCount: 1 });
    expect(parsePageParams({ size: 'all', page: '3' }, 84)).toEqual({ page: 1, size: 'all', pageCount: 1 });
  });
  it('falls back to 50 for other sizes and clamps the page', () => {
    expect(parsePageParams({ size: '7', page: '9' }, 84)).toEqual({ page: 2, size: 50, pageCount: 2 });
    expect(parsePageParams({ page: '-1' }, 0)).toEqual({ page: 1, size: 50, pageCount: 1 });
  });
});

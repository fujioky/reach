// lib/blob/__tests__/presign.test.ts
// Plan 04-02, Task 1 — RED phase unit tests for lib/blob/presign.ts (D-39, SHRE-08).
//
// Validates:
// - extractPathname correctly extracts pathname from a Vercel Blob URL
// - presignImages filters null/empty-string blobUrls (filter(Boolean))
// - presignImages runs in parallel (Promise.all)
// - presignImage calls issueSignedToken + presignUrl with correct args
//
// @vercel/blob is mocked to avoid real API calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @vercel/blob — record calls for assertions.
// vi.hoisted ensures the mock functions exist before vi.mock's hoisted factory runs.
const { issueSignedToken, presignUrl } = vi.hoisted(() => ({
  issueSignedToken: vi.fn(async ({ pathname }: { pathname: string }) => `signed-${pathname}`),
  presignUrl: vi.fn(
    async (_token: string, opts: { operation: string; pathname: string; access: string }) => ({
      presignedUrl: `https://presigned.vercel-storage.com/${opts.pathname}?token=mock`,
    }),
  ),
}));

vi.mock('@vercel/blob', () => ({
  issueSignedToken,
  presignUrl,
}));

import { extractPathname, presignImage, presignImages } from '@/lib/blob/presign';

describe('extractPathname (D-39, PATTERNS landmine #17)', () => {
  it('extracts pathname from a Vercel Blob URL (strips leading slash)', () => {
    const url = 'https://store.blob.vercel-storage.com/images/abc-123.jpg';
    expect(extractPathname(url)).toBe('images/abc-123.jpg');
  });

  it('handles nested pathnames', () => {
    const url = 'https://my-store.blob.vercel-storage.com/images/sub/dir/file.png';
    expect(extractPathname(url)).toBe('images/sub/dir/file.png');
  });

  it('handles pathname with no subdirectory', () => {
    const url = 'https://store.blob.vercel-storage.com/file.jpg';
    expect(extractPathname(url)).toBe('file.jpg');
  });
});

describe('presignImage (D-39)', () => {
  beforeEach(() => {
    issueSignedToken.mockClear();
    presignUrl.mockClear();
  });

  it('calls issueSignedToken with extracted pathname', async () => {
    const url = 'https://store.blob.vercel-storage.com/images/test.jpg';
    await presignImage(url);
    expect(issueSignedToken).toHaveBeenCalledWith({ pathname: 'images/test.jpg' });
  });

  it('calls presignUrl with operation=get, access=private, and correct pathname', async () => {
    const url = 'https://store.blob.vercel-storage.com/images/test.jpg';
    await presignImage(url);
    expect(presignUrl).toHaveBeenCalledWith('signed-images/test.jpg', {
      operation: 'get',
      pathname: 'images/test.jpg',
      access: 'private',
    });
  });

  it('returns the presignedUrl from presignUrl', async () => {
    const url = 'https://store.blob.vercel-storage.com/images/test.jpg';
    const result = await presignImage(url);
    expect(result).toBe('https://presigned.vercel-storage.com/images/test.jpg?token=mock');
  });
});

describe('presignImages (D-39 — batch parallel + filter)', () => {
  beforeEach(() => {
    issueSignedToken.mockClear();
    presignUrl.mockClear();
  });

  it('filters out empty-string and null blobUrls (filter(Boolean))', async () => {
    const urls = ['', null as unknown as string, 'https://store.blob.vercel-storage.com/images/x.jpg'];
    const result = await presignImages(urls);
    // Only the non-empty URL should produce a presigned URL.
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://presigned.vercel-storage.com/images/x.jpg?token=mock');
    // issueSignedToken called only once (for the valid URL).
    expect(issueSignedToken).toHaveBeenCalledTimes(1);
  });

  it('returns empty array for all-empty input', async () => {
    const result = await presignImages(['', null as unknown as string, null as unknown as string]);
    expect(result).toEqual([]);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it('presigns all valid URLs in parallel (Promise.all)', async () => {
    const urls = [
      'https://store.blob.vercel-storage.com/images/a.jpg',
      'https://store.blob.vercel-storage.com/images/b.jpg',
      'https://store.blob.vercel-storage.com/images/c.jpg',
    ];
    const result = await presignImages(urls);
    expect(result).toHaveLength(3);
    expect(issueSignedToken).toHaveBeenCalledTimes(3);
    // Each URL gets its own pathname.
    expect(issueSignedToken).toHaveBeenCalledWith({ pathname: 'images/a.jpg' });
    expect(issueSignedToken).toHaveBeenCalledWith({ pathname: 'images/b.jpg' });
    expect(issueSignedToken).toHaveBeenCalledWith({ pathname: 'images/c.jpg' });
  });

  it('handles empty array input', async () => {
    const result = await presignImages([]);
    expect(result).toEqual([]);
  });
});

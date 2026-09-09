// lib/blob/__tests__/download-image.test.ts
// Plan 03-01, Task 2 — RED unit test for @/lib/blob/download-image (implemented in 03-04).
// Covers Pitfall 5 (size from Content-Length, not blob.put return) + high-entropy pathname.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @vercel/blob put before importing the unit under test.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}));

import { put } from '@vercel/blob';
import { downloadImageToBlob } from '@/lib/blob/download-image';

const FAKE_SIZE = 1234567;

function makeUpstreamResponse(): Response {
  return new Response('fake-image-bytes', {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(FAKE_SIZE),
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(put).mockResolvedValue({
    url: 'https://blob.example.com/images/stored-abc.jpg',
    pathname: 'images/stored-abc.jpg',
    contentType: 'image/jpeg',
  } as Awaited<ReturnType<typeof put>>);
});

describe('downloadImageToBlob — Pitfall 5: size from Content-Length', () => {
  it('returns blobUrl (permanent URL from put) and size (bytes from upstream)', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeUpstreamResponse(),
    );

    const result = await downloadImageToBlob('https://upstream.example.com/img.jpg');

    expect(result.blobUrl).toBe('https://blob.example.com/images/stored-abc.jpg');
    expect(result.size).toBe(FAKE_SIZE);
    expect(globalFetch).toHaveBeenCalledWith('https://upstream.example.com/img.jpg');
  });
});

describe('downloadImageToBlob — high-entropy pathname (SHRE-08 prereq)', () => {
  it('put pathname contains a high-entropy random segment (not enumerable)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeUpstreamResponse());

    await downloadImageToBlob('https://upstream.example.com/img.jpg');

    const pathnameArg = vi.mocked(put).mock.calls[0]?.[0];
    expect(typeof pathnameArg).toBe('string');
    // Pathname must contain a random/uuid-like segment beyond a timestamp.
    // Matches randomUUID/random style — at least 8 hex-ish chars after a separator.
    expect(pathnameArg).toMatch(/[a-f0-9-]{8,}/i);
  });
});

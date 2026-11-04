// lib/analytics/__tests__/replay-urls.test.ts — replay URL rewriting.
import { describe, it, expect } from 'vitest';
import { resignBlobImages } from '@/lib/analytics/resign-media';

describe('replay URL rewriting', () => {
  it('routes presigned private Blob images through the admin redirect', () => {
    const json = JSON.stringify({
      src: 'https://abc123.private.blob.vercel-storage.com/images/1f2e.jpg?vercel-blob-delegation=xyz&sig=1',
    });
    expect(JSON.parse(resignBlobImages(json)).src).toBe('/api/admin/blob-image?p=images%2F1f2e.jpg');
  });
});

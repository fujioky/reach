// lib/analytics/__tests__/resign-media.test.ts
// Replay-time re-signing of expired article-media tokens in rrweb payloads.

import { describe, it, expect, vi } from 'vitest';

vi.stubEnv('AUTH_SECRET', 'test-secret');

const { resignArticleMediaTokens } = await import('../resign-media');
const { signMediaToken, verifyMediaToken } = await import('@/lib/article/media-token');

const VIDEO_ID = 'd635bb4a-579e-48a9-8ab2-40903f5266fd';
const IMAGE_ID = '15c6a2e1-4f5a-4f7c-bbda-8bd7ac685d31';

function expiredToken(mediaId: string): string {
  return signMediaToken(mediaId, -60_000); // already expired
}

function extractToken(json: string, mediaId: string): string {
  const m = json.match(new RegExp(`${mediaId}\\.[a-z0-9]+\\?[^"]*?t=(\\d+\\.[0-9a-f]{32})`));
  if (!m) throw new Error('token not found');
  return m[1];
}

describe('resignArticleMediaTokens', () => {
  it('replaces an expired video token with a valid one (absolute URL, snapshot shape)', () => {
    const stale = expiredToken(VIDEO_ID);
    expect(verifyMediaToken(VIDEO_ID, stale)).toBe('expired');
    const json = JSON.stringify({
      attributes: {
        src: `https://reach.example.com/api/article-media/${VIDEO_ID}.mp4?t=${stale}`,
        poster: `/api/article-media/${VIDEO_ID}.mp4?t=${stale}&poster=1`,
      },
    });

    const out = resignArticleMediaTokens(json);
    expect(JSON.parse(out)).toBeTruthy(); // still valid JSON
    expect(out).not.toContain(stale);
    expect(out).toContain('&poster=1'); // trailing params preserved
    expect(verifyMediaToken(VIDEO_ID, extractToken(out, VIDEO_ID))).toBe('valid');
  });

  it('re-signs image URLs with extra query params after the token', () => {
    const stale = expiredToken(IMAGE_ID);
    const json = JSON.stringify({
      src: `https://reach.example.com/api/article-media/${IMAGE_ID}.jpg?t=${stale}&w=1000`,
    });
    const out = resignArticleMediaTokens(json);
    expect(out).toContain('&w=1000');
    expect(verifyMediaToken(IMAGE_ID, extractToken(out, IMAGE_ID))).toBe('valid');
  });

  it('leaves unrelated URLs and tokenless media URLs alone', () => {
    const json = JSON.stringify({
      a: `/api/article-media/${IMAGE_ID}.jpg`,
      b: 'https://example.com/x.mp4?t=123.abc',
      c: '/api/proxy-video?token=abc&mediaId=x',
    });
    expect(resignArticleMediaTokens(json)).toBe(json);
  });
});

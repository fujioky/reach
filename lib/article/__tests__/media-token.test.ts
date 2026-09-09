// lib/article/__tests__/media-token.test.ts
// Signed access tokens for non-public article media.
//
// This is the access boundary for any asset not marked 公开分享, so the cases
// that matter are the forgeries: a tampered expiry, a token minted for another
// asset, a truncated signature.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  MEDIA_TOKEN_PARAM,
  MEDIA_TOKEN_TTL_MS,
  signMediaToken,
  verifyMediaToken,
  withMediaToken,
} from '@/lib/article/media-token';

const MEDIA_A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const MEDIA_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-for-media-tokens';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signMediaToken / verifyMediaToken', () => {
  it('accepts a token for the asset it was minted for', () => {
    expect(verifyMediaToken(MEDIA_A, signMediaToken(MEDIA_A))).toBe('valid');
  });

  it('rejects a token minted for a different asset', () => {
    // Otherwise one shared article would unlock every other asset.
    expect(verifyMediaToken(MEDIA_B, signMediaToken(MEDIA_A))).toBe('invalid');
  });

  it('rejects a token whose expiry was extended', () => {
    const token = signMediaToken(MEDIA_A);
    const [, signature] = token.split('.');
    const forged = `${Date.now() + 10 ** 10}.${signature}`;
    expect(verifyMediaToken(MEDIA_A, forged)).toBe('invalid');
  });

  it('rejects a truncated or padded signature', () => {
    const token = signMediaToken(MEDIA_A);
    const [expires, signature] = token.split('.');
    expect(verifyMediaToken(MEDIA_A, `${expires}.${signature.slice(0, -1)}`)).toBe('invalid');
    expect(verifyMediaToken(MEDIA_A, `${expires}.${signature}0`)).toBe('invalid');
  });

  it('rejects malformed and missing tokens', () => {
    expect(verifyMediaToken(MEDIA_A, null)).toBe('invalid');
    expect(verifyMediaToken(MEDIA_A, '')).toBe('invalid');
    expect(verifyMediaToken(MEDIA_A, 'nonsense')).toBe('invalid');
    expect(verifyMediaToken(MEDIA_A, '123')).toBe('invalid');
    expect(verifyMediaToken(MEDIA_A, 'a.b.c')).toBe('invalid');
  });

  it('reports expiry separately once the signature checks out', () => {
    // The route turns this into a 403 with "reopen the article", instead of the
    // 404 a guessed URL gets.
    const token = signMediaToken(MEDIA_A);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + MEDIA_TOKEN_TTL_MS + 1000);
    expect(verifyMediaToken(MEDIA_A, token)).toBe('expired');
  });

  it('honours a custom ttl', () => {
    const token = signMediaToken(MEDIA_A, 1000);
    expect(verifyMediaToken(MEDIA_A, token)).toBe('valid');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    expect(verifyMediaToken(MEDIA_A, token)).toBe('expired');
  });
});

describe('withMediaToken', () => {
  it('appends the token as a query parameter', () => {
    const url = withMediaToken(`/api/article-media/${MEDIA_A}.mp4`, MEDIA_A);
    expect(url.startsWith(`/api/article-media/${MEDIA_A}.mp4?${MEDIA_TOKEN_PARAM}=`)).toBe(true);
  });

  it('uses & when the URL already has a query string', () => {
    const url = withMediaToken(`/api/article-media/${MEDIA_A}.mp4?v=2`, MEDIA_A);
    expect(url).toContain(`&${MEDIA_TOKEN_PARAM}=`);
  });

  it('produces a URL whose token verifies', () => {
    const url = withMediaToken(`/api/article-media/${MEDIA_A}.jpg`, MEDIA_A);
    const token = new URL(url, 'https://example.com').searchParams.get(MEDIA_TOKEN_PARAM);
    expect(verifyMediaToken(MEDIA_A, token)).toBe('valid');
  });
});

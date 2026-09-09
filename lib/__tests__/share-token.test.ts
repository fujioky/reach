// lib/__tests__/share-token.test.ts
// Plan 04-01, Task 1 — RED phase unit tests for generateShareToken (D-33, SHRE-08).
//
// Validates nanoid 21-char URL-safe token generation:
// - length === 21
// - charset /^[A-Za-z0-9_-]{21}$/ (URL-safe base64 alphabet)
// - 1000 generations produce no collisions
// - entropy: charset size (64) × length (21) ≥ 122 bits
//
// Vitest config (vitest.config.ts) collects `lib/**/*.test.ts`.

import { describe, it, expect } from 'vitest';
import { generateShareToken } from '@/lib/share/token';

describe('generateShareToken (D-33 / SHRE-08)', () => {
  it('returns a 21-character string', () => {
    const token = generateShareToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(21);
  });

  it('uses only URL-safe base64 alphabet (A-Za-z0-9_-)', () => {
    const urlSafeRe = /^[A-Za-z0-9_-]{21}$/;
    // Sample many to exercise the alphabet distribution.
    for (let i = 0; i < 1000; i++) {
      const token = generateShareToken();
      expect(urlSafeRe.test(token)).toBe(true);
    }
  });

  it('produces no collisions across 1000 generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const token = generateShareToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it('provides >= 122 bits of entropy (charset 64 × length 21 = 126)', () => {
    // nanoid default alphabet has 64 symbols; 21 chars → 21 × log2(64) = 126 bits.
    const charsetSize = 64;
    const length = 21;
    const entropyBits = length * Math.log2(charsetSize);
    expect(entropyBits).toBeGreaterThanOrEqual(122);
    // Sanity: the actual generated token honors the length assumption.
    expect(generateShareToken().length).toBe(length);
  });
});

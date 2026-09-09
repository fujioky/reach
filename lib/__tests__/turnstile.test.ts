// lib/__tests__/turnstile.test.ts
// Clearance-cookie signing for the Turnstile gate: roundtrip, expiry, tamper.

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-secret');
});

const { createClearanceValue, isClearanceValid } = await import('../turnstile');

describe('turnstile clearance cookie', () => {
  it('roundtrips a freshly issued value', () => {
    const value = createClearanceValue();
    expect(isClearanceValid(value)).toBe(true);
  });

  it('rejects an expired value', () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const value = createClearanceValue(past);
    expect(isClearanceValid(value)).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const value = createClearanceValue();
    const [, sig] = value.split('.');
    const forged = `${Date.now() + 999_999_999}.${sig}`;
    expect(isClearanceValid(forged)).toBe(false);
  });

  it('rejects garbage and empty values', () => {
    expect(isClearanceValid(undefined)).toBe(false);
    expect(isClearanceValid('')).toBe(false);
    expect(isClearanceValid('not-a-cookie')).toBe(false);
    expect(isClearanceValid('123.abc')).toBe(false);
  });
});

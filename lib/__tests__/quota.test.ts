// lib/__tests__/quota.test.ts
// Plan 03-01, Task 2 — RED unit test for @/lib/quota (implemented in 03-03).
// Covers D-16 (threshold values) + D-18 (warnings don't block, only flag).
import { describe, it, expect } from 'vitest';
import { LIMITS, evaluateQuota } from '@/lib/quota';

const MB = 1024 * 1024;

describe('LIMITS constants (D-16)', () => {
  it('perImage = 20MB', () => {
    expect(LIMITS.perImage).toBe(20 * MB);
  });

  it('perMirror = 200MB', () => {
    expect(LIMITS.perMirror).toBe(200 * MB);
  });

  it('totalQuota = 900MB', () => {
    expect(LIMITS.totalQuota).toBe(900 * MB);
  });
});

describe('evaluateQuota (D-18: warnings flag, never throw)', () => {
  it('returns exact shape with all warnings false when under all thresholds', () => {
    const result = evaluateQuota({
      usedBytes: 100 * MB,
      mirrorImageBytes: 50 * MB,
      largestImageBytes: 5 * MB,
    });
    expect(result).toEqual({
      usedBytes: 100 * MB,
      mirrorImageBytes: 50 * MB,
      largestImageBytes: 5 * MB,
      warnings: { perImage: false, perMirror: false, totalQuota: false },
    });
  });

  it('flags perImage warning when largestImageBytes exceeds 20MB (no throw)', () => {
    const result = evaluateQuota({
      usedBytes: 0,
      mirrorImageBytes: 0,
      largestImageBytes: 25 * MB,
    });
    expect(result.warnings.perImage).toBe(true);
    expect(result.warnings.perMirror).toBe(false);
    expect(result.warnings.totalQuota).toBe(false);
  });

  it('flags perMirror warning when mirrorImageBytes exceeds 200MB (no throw)', () => {
    const result = evaluateQuota({
      usedBytes: 0,
      mirrorImageBytes: 250 * MB,
      largestImageBytes: 10 * MB,
    });
    expect(result.warnings.perMirror).toBe(true);
    expect(result.warnings.perImage).toBe(false);
    expect(result.warnings.totalQuota).toBe(false);
  });

  it('flags totalQuota warning when usedBytes exceeds 900MB (no throw)', () => {
    const result = evaluateQuota({
      usedBytes: 950 * MB,
      mirrorImageBytes: 10 * MB,
      largestImageBytes: 5 * MB,
    });
    expect(result.warnings.totalQuota).toBe(true);
    expect(result.warnings.perImage).toBe(false);
    expect(result.warnings.perMirror).toBe(false);
  });

  it('flags all three warnings when every threshold exceeded', () => {
    const result = evaluateQuota({
      usedBytes: 950 * MB,
      mirrorImageBytes: 250 * MB,
      largestImageBytes: 25 * MB,
    });
    expect(result.warnings).toEqual({
      perImage: true,
      perMirror: true,
      totalQuota: true,
    });
  });
});

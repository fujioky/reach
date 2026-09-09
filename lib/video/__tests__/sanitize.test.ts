import { describe, it, expect } from 'vitest';
import { sanitizePublicError } from '@/lib/video/sanitize';

describe('sanitizePublicError', () => {
  it('strips URLs from visitor-facing errors', () => {
    expect(
      sanitizePublicError('HTTP 403 from https://proxy.example.com · 2026-07-08'),
    ).toBe('HTTP 403 from [已隐藏] · 2026-07-08');
  });

  it('returns null for empty input', () => {
    expect(sanitizePublicError(null)).toBeNull();
  });
});
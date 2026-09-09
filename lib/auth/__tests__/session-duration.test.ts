import { describe, it, expect } from 'vitest';
import {
  parseRememberMe,
  sessionMaxAgeSec,
  SESSION_EPHEMERAL_MAX_AGE_SEC,
  SESSION_REMEMBER_MAX_AGE_SEC,
} from '@/lib/auth/session-duration';

describe('parseRememberMe', () => {
  it('returns true for checkbox on/true/1', () => {
    expect(parseRememberMe('on')).toBe(true);
    expect(parseRememberMe('true')).toBe(true);
    expect(parseRememberMe('1')).toBe(true);
  });

  it('returns false for absent or false values', () => {
    expect(parseRememberMe(null)).toBe(false);
    expect(parseRememberMe(undefined)).toBe(false);
    expect(parseRememberMe('false')).toBe(false);
    expect(parseRememberMe('')).toBe(false);
  });
});

describe('sessionMaxAgeSec', () => {
  it('uses 30 days when remember is true', () => {
    expect(sessionMaxAgeSec(true)).toBe(SESSION_REMEMBER_MAX_AGE_SEC);
  });

  it('uses 8 hours when remember is false', () => {
    expect(sessionMaxAgeSec(false)).toBe(SESSION_EPHEMERAL_MAX_AGE_SEC);
  });
});
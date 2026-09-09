// lib/article/__tests__/captcha.test.ts
// The signed arithmetic challenge guarding the public comment form.

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { createChallenge, hashIp, verifyChallenge } from '@/lib/article/captcha';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-for-captcha-signing';
});

afterEach(() => {
  vi.useRealTimers();
});

/** The token embeds the expected answer as its first dot-separated field. */
function answerOf(token: string): string {
  return token.split('.')[0];
}

describe('createChallenge', () => {
  it('asks a question a human can read and answer', () => {
    const challenge = createChallenge();
    expect(challenge.question).toMatch(/^[一二三四五六七八九] (加|减) [一二三四五六七八九] 等于几？$/);
  });

  it('never poses a subtraction with a negative answer', () => {
    for (let i = 0; i < 200; i++) {
      const challenge = createChallenge();
      expect(Number(answerOf(challenge.token))).toBeGreaterThanOrEqual(0);
    }
  });

  it('issues a distinct token each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createChallenge().token));
    expect(tokens.size).toBeGreaterThan(1);
  });
});

describe('verifyChallenge', () => {
  it('accepts the correct answer', () => {
    const challenge = createChallenge();
    expect(verifyChallenge(challenge.token, answerOf(challenge.token))).toEqual({ ok: true });
  });

  it('tolerates padded and zero-prefixed input', () => {
    const challenge = createChallenge();
    const answer = answerOf(challenge.token);
    expect(verifyChallenge(challenge.token, `  ${answer} `).ok).toBe(true);
    expect(verifyChallenge(challenge.token, `0${answer}`).ok).toBe(true);
  });

  it('rejects a wrong answer', () => {
    const challenge = createChallenge();
    const wrong = String(Number(answerOf(challenge.token)) + 1);
    expect(verifyChallenge(challenge.token, wrong)).toEqual({
      ok: false,
      reason: 'wrong_answer',
    });
  });

  it('rejects non-numeric input', () => {
    const challenge = createChallenge();
    const wrongAnswer = { ok: false, reason: 'wrong_answer' };
    expect(verifyChallenge(challenge.token, 'three')).toEqual(wrongAnswer);
    expect(verifyChallenge(challenge.token, '')).toEqual(wrongAnswer);
  });

  it('rejects a token whose answer was tampered with', () => {
    // The whole point of the signature: editing the answer must not let the
    // edited answer verify.
    const challenge = createChallenge();
    const [, expires, signature] = challenge.token.split('.');
    const forged = `99.${expires}.${signature}`;
    expect(verifyChallenge(forged, '99')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a token whose expiry was extended', () => {
    const challenge = createChallenge();
    const [answer, , signature] = challenge.token.split('.');
    const forged = `${answer}.${Date.now() + 10 ** 9}.${signature}`;
    expect(verifyChallenge(forged, answer)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects malformed tokens', () => {
    const malformed = { ok: false, reason: 'malformed' };
    expect(verifyChallenge('', '1')).toEqual(malformed);
    expect(verifyChallenge('nonsense', '1')).toEqual(malformed);
    expect(verifyChallenge('1.2', '1')).toEqual(malformed);
  });

  it('rejects an expired challenge', () => {
    const challenge = createChallenge();
    const answer = answerOf(challenge.token);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000); // TTL is 15 min
    expect(verifyChallenge(challenge.token, answer)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('hashIp', () => {
  it('is stable for the same address and different across addresses', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'));
  });

  it('does not leak the address it hashed', () => {
    const hash = hashIp('203.0.113.7');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203');
  });
});

// lib/article/captcha.ts
// Stateless arithmetic challenge for the visitor comment form.
//
// Comments publish immediately (no review queue), so the form needs something
// between it and a scripted flood. This is deliberately the lightest thing that
// works: a signed arithmetic question, no third-party service, no stored state.
//
// The token carries the expected answer and an expiry, HMAC-signed with
// AUTH_SECRET. Nothing is written server-side, so the challenge survives a
// serverless cold start and costs no database round-trip. It stops naive bots,
// not a targeted attacker — that's the intended trade.

import { createHmac, timingSafeEqual, randomInt } from 'crypto';

/** How long a challenge stays valid. Long enough to write a comment. */
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

/** Chinese numerals make the question harder to parse than "3 + 5". */
const CHINESE_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export interface Challenge {
  /** Human-readable question, e.g. 「三 加 五 等于几？」 */
  question: string;
  /** Signed token that must be submitted alongside the answer. */
  token: string;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error('AUTH_SECRET is required to sign comment challenges');
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

/** Generate a fresh challenge. Call this on every render of the comment form. */
export function createChallenge(): Challenge {
  const a = randomInt(1, 10); // 1..9
  const b = randomInt(1, 10);
  const subtract = a > b && randomInt(0, 2) === 1; // only when it stays positive
  const answer = subtract ? a - b : a + b;
  const operator = subtract ? '减' : '加';

  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${answer}.${expiresAt}`;
  return {
    question: `${CHINESE_NUMERALS[a]} ${operator} ${CHINESE_NUMERALS[b]} 等于几？`,
    token: `${payload}.${sign(payload)}`,
  };
}

export type ChallengeVerdict =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'expired' | 'wrong_answer' };

/**
 * Verify a submitted answer against its token.
 *
 * The answer is compared as a number so "05" and " 5 " both pass — a visitor
 * shouldn't fail on formatting. The signature comparison is constant-time.
 */
export function verifyChallenge(token: string, answer: string): ChallengeVerdict {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [answerPart, expiresPart, signature] = parts;
  const expected = sign(`${answerPart}.${expiresPart}`);

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: 'malformed' };
  if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: 'malformed' };

  const expiresAt = Number(expiresPart);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  if (Date.now() > expiresAt) return { ok: false, reason: 'expired' };

  const submitted = Number(answer.trim());
  if (!Number.isFinite(submitted)) return { ok: false, reason: 'wrong_answer' };
  if (submitted !== Number(answerPart)) return { ok: false, reason: 'wrong_answer' };

  return { ok: true };
}

/**
 * Keyed hash of a visitor IP, stored for rate limiting.
 *
 * Keyed rather than plain SHA-256: the IPv4 space is small enough to brute
 * force an unkeyed digest, and this value is only ever compared against itself.
 */
export function hashIp(ip: string): string {
  return createHmac('sha256', secret()).update(`ip:${ip}`).digest('hex');
}

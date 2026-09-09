// lib/article/__tests__/comments.test.ts
// Validation of visitor comment submissions.
//
// Only the pure part is covered here; checkRateLimit and the list queries hit
// the database and belong to an integration pass.

import { describe, it, expect } from 'vitest';
import {
  BODY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  validateComment,
} from '@/lib/article/comments';

const valid = { authorName: '路人甲', body: '写得不错。' };

describe('validateComment', () => {
  it('accepts a normal submission', () => {
    const result = validateComment(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        authorName: '路人甲',
        authorEmail: null,
        body: '写得不错。',
      });
    }
  });

  it('collapses whitespace in the name', () => {
    const result = validateComment({ ...valid, authorName: '  路人   甲  ' });
    expect(result.ok && result.value.authorName).toBe('路人 甲');
  });

  it('rejects a blank or whitespace-only name', () => {
    expect(validateComment({ ...valid, authorName: '' }).ok).toBe(false);
    expect(validateComment({ ...valid, authorName: '   ' }).ok).toBe(false);
  });

  it('rejects an over-long name', () => {
    const result = validateComment({ ...valid, authorName: 'a'.repeat(NAME_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
  });

  it('rejects a body that is too short or too long', () => {
    expect(validateComment({ ...valid, body: 'x' }).ok).toBe(false);
    expect(validateComment({ ...valid, body: 'x'.repeat(BODY_MAX_LENGTH + 1) }).ok).toBe(false);
  });

  it('preserves paragraph breaks but squeezes long blank runs', () => {
    const result = validateComment({ ...valid, body: '第一段\n\n\n\n第二段' });
    expect(result.ok && result.value.body).toBe('第一段\n\n第二段');
  });

  it('normalizes CRLF line endings', () => {
    const result = validateComment({ ...valid, body: 'a\r\nb' });
    expect(result.ok && result.value.body).toBe('a\nb');
  });

  it('treats an empty email as absent rather than invalid', () => {
    const result = validateComment({ ...valid, authorEmail: '   ' });
    expect(result.ok && result.value.authorEmail).toBeNull();
  });

  it('lowercases a valid email', () => {
    const result = validateComment({ ...valid, authorEmail: ' Someone@Example.COM ' });
    expect(result.ok && result.value.authorEmail).toBe('someone@example.com');
  });

  it('rejects a malformed email', () => {
    expect(validateComment({ ...valid, authorEmail: 'not-an-email' }).ok).toBe(false);
    expect(validateComment({ ...valid, authorEmail: 'a@b' }).ok).toBe(false);
    expect(validateComment({ ...valid, authorEmail: 'a b@c.com' }).ok).toBe(false);
  });
});

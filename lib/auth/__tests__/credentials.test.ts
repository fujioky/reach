// lib/auth/__tests__/credentials.test.ts
// Plan 03-01, Task 2 — RED unit test for @/lib/auth/credentials-schema (implemented in 03-02).
// Covers AUTH-01 (input validation for credentials login).
// The schema is reused by both the normal login form and the first-install setup
// form (D-28: first admin created via login-page transform, no env vars/seed).
import { describe, it, expect } from 'vitest';
import { credsSchema } from '@/lib/auth/credentials-schema';

describe('credsSchema — AUTH-01 input validation', () => {
  it('accepts a valid username + password', () => {
    const parsed = credsSchema.safeParse({
      username: 'admin',
      password: 's3cret-pass',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty username', () => {
    const parsed = credsSchema.safeParse({ username: '', password: 's3cret-pass' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const parsed = credsSchema.safeParse({ username: 'admin', password: '' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing username', () => {
    const parsed = credsSchema.safeParse({ password: 's3cret-pass' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing password', () => {
    const parsed = credsSchema.safeParse({ username: 'admin' });
    expect(parsed.success).toBe(false);
  });
});

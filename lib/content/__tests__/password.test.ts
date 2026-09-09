// lib/content/__tests__/password.test.ts
// Password mode resolution — which hash actually guards an item.
//
// The cookie side needs a request context, so it's covered by the end-to-end
// pass; what's testable in isolation is the decision table, and that is where a
// mistake silently unlocks content.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSetting = vi.fn();
vi.mock('@/lib/settings', () => ({ getSetting: (k: string) => getSetting(k) }));

const { readPasswordMode, resolveGuardHash } = await import('@/lib/content/password');

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue('');
});

describe('readPasswordMode', () => {
  it('treats null and unknown values as open', () => {
    // Every row that predates the column has null here — those must stay open.
    expect(readPasswordMode(null)).toBe('none');
    expect(readPasswordMode(undefined)).toBe('none');
    expect(readPasswordMode('')).toBe('none');
    expect(readPasswordMode('nonsense')).toBe('none');
  });

  it('passes through the real modes', () => {
    expect(readPasswordMode('none')).toBe('none');
    expect(readPasswordMode('inherit')).toBe('inherit');
    expect(readPasswordMode('custom')).toBe('custom');
  });
});

describe('resolveGuardHash', () => {
  it('returns null for an open item', async () => {
    expect(await resolveGuardHash({ passwordMode: 'none', passwordHash: null })).toBeNull();
    expect(await resolveGuardHash({ passwordMode: null, passwordHash: null })).toBeNull();
  });

  it('ignores a leftover hash when the mode is none', async () => {
    // Switching back to 'none' must open the item even if a hash lingers.
    expect(
      await resolveGuardHash({ passwordMode: 'none', passwordHash: '$2a$10$leftover' }),
    ).toBeNull();
  });

  it('uses the item hash in custom mode', async () => {
    expect(
      await resolveGuardHash({ passwordMode: 'custom', passwordHash: '$2a$10$own' }),
    ).toBe('$2a$10$own');
  });

  it('falls back to open when custom mode has no hash', async () => {
    // Otherwise a half-saved item would be permanently unreachable.
    expect(await resolveGuardHash({ passwordMode: 'custom', passwordHash: null })).toBeNull();
    expect(await resolveGuardHash({ passwordMode: 'custom', passwordHash: '  ' })).toBeNull();
  });

  it('uses the site hash in inherit mode', async () => {
    getSetting.mockResolvedValue('$2a$10$site');
    expect(
      await resolveGuardHash({ passwordMode: 'inherit', passwordHash: null }),
    ).toBe('$2a$10$site');
  });

  it('inherit with no site password leaves the item open', async () => {
    // Open is the safe failure: an item must not become unreachable because a
    // setting is missing, and the admin can see both in the UI.
    getSetting.mockResolvedValue('');
    expect(await resolveGuardHash({ passwordMode: 'inherit', passwordHash: null })).toBeNull();
  });

  it('inherit ignores any hash stored on the item', async () => {
    getSetting.mockResolvedValue('$2a$10$site');
    expect(
      await resolveGuardHash({ passwordMode: 'inherit', passwordHash: '$2a$10$stale' }),
    ).toBe('$2a$10$site');
  });
});

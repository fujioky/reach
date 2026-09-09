// lib/article/__tests__/slug.test.ts
// Slug generation and validation for the public /p/<slug> URL.

import { describe, it, expect } from 'vitest';
import {
  generateRandomSlug,
  generateUniqueSlug,
  isValidSlug,
  MAX_SLUG_LENGTH,
  normalizeRequestedSlug,
  slugify,
} from '@/lib/article/slug';

const free = async () => false;

describe('generateRandomSlug', () => {
  it('produces a lowercase alphanumeric slug', () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateRandomSlug();
      expect(slug).toMatch(/^[a-z0-9]{10}$/);
    }
  });

  it('never produces a slug isValidSlug would reject', () => {
    // nanoid's default alphabet can start or end with a hyphen, which the
    // validator rejects — the custom alphabet exists to prevent that.
    for (let i = 0; i < 200; i++) {
      expect(isValidSlug(generateRandomSlug())).toBe(true);
    }
  });

  it('is URL-safe as-is — encoding must not change it', () => {
    // The whole point of dropping title-derived slugs: no percent-encoding, so
    // the value in the URL is the value in the database.
    for (let i = 0; i < 100; i++) {
      const slug = generateRandomSlug();
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it('does not repeat itself', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateRandomSlug()));
    expect(slugs.size).toBe(500);
  });
});

describe('generateUniqueSlug', () => {
  it('returns a free slug', async () => {
    const slug = await generateUniqueSlug(free);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('retries past a collision', async () => {
    let calls = 0;
    const isTaken = async () => ++calls === 1; // first candidate taken
    const slug = await generateUniqueSlug(isTaken);
    expect(calls).toBe(2);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('terminates even when everything looks taken', async () => {
    // A broken isTaken must not spin forever.
    const slug = await generateUniqueSlug(async () => true);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe('slugify', () => {
  it('lowercases latin titles and joins words with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Trailing   Spaces  ')).toBe('trailing-spaces');
  });

  it('keeps CJK characters instead of dropping them', () => {
    expect(slugify('写在春天的一封信')).toBe('写在春天的一封信');
  });

  it('collapses punctuation and emoji into single separators', () => {
    expect(slugify('a...b')).toBe('a-b');
    expect(slugify('ship it 🚀 today')).toBe('ship-it-today');
  });

  it('never emits a leading or trailing hyphen', () => {
    expect(slugify('!!! hello !!!')).toBe('hello');
    expect(slugify('---')).toBe('');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});

describe('isValidSlug', () => {
  it('accepts what slugify produces', () => {
    for (const title of ['Hello World', '写在春天的一封信', 'v2-release-notes']) {
      expect(isValidSlug(slugify(title))).toBe(true);
    }
  });

  it('rejects empty, over-long, and edge-hyphenated slugs', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
  });

  it('rejects characters that would need escaping in a URL path', () => {
    expect(isValidSlug('a/b')).toBe(false);
    expect(isValidSlug('a b')).toBe(false);
    expect(isValidSlug('a?b')).toBe(false);
    expect(isValidSlug('Upper')).toBe(false); // slugs are stored lowercased
  });
});

describe('normalizeRequestedSlug', () => {
  it('normalizes rather than rejects a human-typed slug', () => {
    // "My First Post" should become my-first-post, not an error about spaces.
    expect(normalizeRequestedSlug('My First Post', free)).resolves.toEqual({
      ok: true,
      slug: 'my-first-post',
    });
  });

  it('accepts an already-clean slug unchanged', async () => {
    expect(await normalizeRequestedSlug('release-notes-v2', free)).toEqual({
      ok: true,
      slug: 'release-notes-v2',
    });
  });

  it('reports a slug that normalizes to nothing', async () => {
    expect(await normalizeRequestedSlug('!!!', free)).toEqual({ ok: false, reason: 'invalid' });
    expect(await normalizeRequestedSlug('   ', free)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports a collision separately from a format problem', async () => {
    expect(await normalizeRequestedSlug('taken-slug', async () => true)).toEqual({
      ok: false,
      reason: 'taken',
    });
  });

  it('checks uniqueness against the normalized form, not the raw input', async () => {
    const seen: string[] = [];
    await normalizeRequestedSlug('My Post', async (s) => {
      seen.push(s);
      return false;
    });
    expect(seen).toEqual(['my-post']);
  });
});

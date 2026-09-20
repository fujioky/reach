// lib/__tests__/post-url.test.ts
// parsePostUrl — the link a visitor has open (or right-clicked) resolved to a
// single post: platform-native ID for dedup, canonical URL for the fetch.

import { describe, it, expect } from 'vitest';

import { identifyPlatform, parsePostUrl } from '@/lib/fetcher/platforms';

describe('parsePostUrl — X / Twitter', () => {
  it.each([
    ['https://x.com/jack/status/20', 'https://x.com/jack/status/20'],
    ['https://twitter.com/jack/status/20?s=20&t=abc', 'https://x.com/jack/status/20'],
    ['https://mobile.twitter.com/jack/status/20', 'https://x.com/jack/status/20'],
    ['https://x.com/jack/status/20/photo/1', 'https://x.com/jack/status/20'],
    ['https://x.com/jack/statuses/20', 'https://x.com/jack/status/20'],
    ['https://x.com/i/web/status/20', 'https://x.com/i/status/20'],
    ['https://x.com/i/status/20#m', 'https://x.com/i/status/20'],
  ])('%s', (input, url) => {
    expect(parsePostUrl(input)).toEqual({ platform: 'x', sourceId: '20', url });
  });

  it.each([
    'https://x.com/home',
    'https://x.com/jack',
    'https://x.com/jack/status/',
    'https://x.com/search?q=status/20',
    'https://t.co/abc123',
    'https://notx.com/jack/status/20',
  ])('is not a post: %s', (input) => {
    expect(parsePostUrl(input)).toBeNull();
  });
});

describe('parsePostUrl — YouTube', () => {
  const canonical = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123',
    'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ?si=xyz',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=xyz',
  ])('%s', (input) => {
    expect(parsePostUrl(input)).toEqual({ platform: 'youtube', sourceId: 'dQw4w9WgXcQ', url: canonical });
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/playlist?list=PL123',
    'https://youtu.be/',
  ])('is not a video: %s', (input) => {
    expect(parsePostUrl(input)).toBeNull();
  });
});

describe('parsePostUrl — anything else', () => {
  it.each(['not a url', '', 'ftp://x.com/jack/status/20', 'https://example.com/watch?v=dQw4w9WgXcQ'])(
    '%j',
    (input) => {
      expect(parsePostUrl(input)).toBeNull();
    },
  );

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parsePostUrl('  https://x.com/jack/status/20\n')?.sourceId).toBe('20');
  });
});


describe('YouTube 域名识别', () => {
  it.each(['youtube.com', 'www.youtube.com', 'm.youtube.com'])('识别 %s 的视频链接', (host) => {
    expect(identifyPlatform(`https://${host}/watch?v=xxxxxxxxxxx`).platform).toBe('youtube');
  });

  it.each([
    'https://youtube.com.evil.test/watch?v=xxxxxxxxxxx',
    'https://www.youtube.com@evil.test/watch?v=xxxxxxxxxxx',
    'https://notyoutube.com/watch?v=xxxxxxxxxxx',
    'ftp://youtube.com/watch?v=xxxxxxxxxxx',
  ])('拒绝非受信任域名或协议：%s', (url) => {
    expect(() => identifyPlatform(url)).toThrow();
  });
});

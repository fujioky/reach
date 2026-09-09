// lib/article/__tests__/remote-fetch.test.ts
// SSRF containment for remote media import.
//
// This is the one server-side fetch in the app that aims at a user-supplied
// host, so the address filter is the security boundary. The cases below are the
// standard bypasses: cloud metadata, loopback in its many spellings, private
// ranges, IPv4-mapped IPv6, and non-http schemes.

import { describe, it, expect } from 'vitest';
import {
  assertSafeUrl,
  extractEmbeddedMediaUrl,
  guessTypeFromUrl,
  isAmbiguousContentType,
  isBlockedAddress,
  isHtmlContentType,
  RemoteImportError,
} from '@/lib/article/remote-fetch';

describe('isBlockedAddress', () => {
  it('blocks the cloud metadata endpoint', () => {
    // The single most valuable SSRF target on any cloud host.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
  });

  it('blocks loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.1.2.3')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
  });

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.254')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
  });

  it('does not over-block the public neighbours of private ranges', () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 is private.
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('192.167.1.1')).toBe(false);
    expect(isBlockedAddress('11.0.0.1')).toBe(false);
  });

  it('blocks CGNAT, unspecified, multicast and broadcast', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
  });

  it('blocks IPv6 unique-local and link-local', () => {
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('ff02::1')).toBe(true);
  });

  it('sees through IPv4-mapped IPv6', () => {
    // ::ffff:169.254.169.254 reaches metadata just as well as the bare address.
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('ignores an IPv6 zone index', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('2606:4700::1111')).toBe(false);
  });

  it('rejects anything that is not an IP', () => {
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  const expectRejected = async (url: string, kind: string) => {
    await expect(assertSafeUrl(url)).rejects.toSatisfy(
      (err: unknown) => err instanceof RemoteImportError && err.kind === kind,
    );
  };

  it('rejects non-http schemes', async () => {
    await expectRejected('file:///etc/passwd', 'blocked_scheme');
    await expectRejected('ftp://example.com/x.jpg', 'blocked_scheme');
    await expectRejected('gopher://example.com/', 'blocked_scheme');
  });

  it('rejects malformed URLs', async () => {
    await expectRejected('not a url', 'invalid_url');
    await expectRejected('', 'invalid_url');
  });

  it('rejects literal private and loopback addresses', async () => {
    await expectRejected('http://127.0.0.1/x.jpg', 'blocked_host');
    await expectRejected('http://169.254.169.254/latest/meta-data/', 'blocked_host');
    await expectRejected('http://10.0.0.1/x.png', 'blocked_host');
    await expectRejected('http://[::1]/x.png', 'blocked_host');
  });

  it('rejects a private address regardless of port', async () => {
    await expectRejected('http://192.168.1.1:8080/admin', 'blocked_host');
  });

  it('accepts a public literal address', async () => {
    const url = await assertSafeUrl('https://1.1.1.1/logo.png');
    expect(url.hostname).toBe('1.1.1.1');
  });

  it('rejects a hostname that resolves to loopback', async () => {
    // localhost is the plainest form of the DNS-based bypass.
    await expectRejected('http://localhost:3000/x.jpg', 'blocked_host');
  });
});

describe('guessTypeFromUrl', () => {
  it('derives a type from the file extension', () => {
    expect(guessTypeFromUrl('https://a.com/photo.jpg')).toBe('image/jpeg');
    expect(guessTypeFromUrl('https://a.com/clip.MP4')).toBe('video/mp4');
    expect(guessTypeFromUrl('https://a.com/x.webp')).toBe('image/webp');
  });

  it('ignores query strings', () => {
    expect(guessTypeFromUrl('https://a.com/photo.png?w=800&h=600')).toBe('image/png');
  });

  it('returns empty for unknown or missing extensions', () => {
    expect(guessTypeFromUrl('https://a.com/download')).toBe('');
    expect(guessTypeFromUrl('https://a.com/archive.zip')).toBe('');
  });
});

describe('isAmbiguousContentType', () => {
  it('treats the octet-stream family as carrying no information', () => {
    expect(isAmbiguousContentType('')).toBe(true);
    expect(isAmbiguousContentType('application/octet-stream')).toBe(true);
    expect(isAmbiguousContentType('binary/octet-stream')).toBe(true);
    expect(isAmbiguousContentType('application/force-download')).toBe(true);
  });

  it('treats any stated type as informative — including text/html', () => {
    // This is the guard against storing an HTML player page as a video just
    // because the URL ends in .mp4.
    expect(isAmbiguousContentType('text/html')).toBe(false);
    expect(isAmbiguousContentType('text/html;charset=UTF-8')).toBe(false);
    expect(isAmbiguousContentType('image/jpeg')).toBe(false);
    expect(isAmbiguousContentType('video/mp4')).toBe(false);
  });
});

describe('isHtmlContentType', () => {
  it('recognizes html responses regardless of charset', () => {
    expect(isHtmlContentType('text/html')).toBe(true);
    expect(isHtmlContentType('text/html;charset=UTF-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
  });

  it('does not flag media types', () => {
    expect(isHtmlContentType('video/mp4')).toBe(false);
    expect(isHtmlContentType('image/png')).toBe(false);
  });
});

describe('extractEmbeddedMediaUrl', () => {
  const base = 'https://cdn.twimg.quest/GEbnrgw61.mp4';

  it('pulls the file out of a <source> inside <video>', () => {
    // The shape served by Twitter/X mirror CDNs at a .mp4 URL.
    const html = `<!DOCTYPE html><html><body>
      <video controls autoplay playsinline>
        <source src="https://cdn.slicedrive.com/GEbnrgw61.mp4" type="video/mp4">
      </video></body></html>`;
    expect(extractEmbeddedMediaUrl(html, base)).toBe('https://cdn.slicedrive.com/GEbnrgw61.mp4');
  });

  it('handles src directly on the video element', () => {
    const html = `<video src="https://cdn.example.com/a.mp4" controls></video>`;
    expect(extractEmbeddedMediaUrl(html, base)).toBe('https://cdn.example.com/a.mp4');
  });

  it('resolves a relative src against the page URL', () => {
    const html = `<video><source src="/files/a.mp4" type="video/mp4"></video>`;
    expect(extractEmbeddedMediaUrl(html, base)).toBe('https://cdn.twimg.quest/files/a.mp4');
  });

  it('falls back to an og:video meta tag', () => {
    const html = `<meta property="og:video" content="https://cdn.example.com/v.mp4">`;
    expect(extractEmbeddedMediaUrl(html, base)).toBe('https://cdn.example.com/v.mp4');
  });

  it('falls back to an image for photo pages', () => {
    const html = `<html><body><img src="https://cdn.example.com/p.jpg"></body></html>`;
    expect(extractEmbeddedMediaUrl(html, base)).toBe('https://cdn.example.com/p.jpg');
  });

  it('returns null when the page embeds nothing usable', () => {
    expect(extractEmbeddedMediaUrl('<html><body>404 Not Found</body></html>', base)).toBeNull();
  });

  it('returns null rather than throwing on an unparseable src', () => {
    expect(extractEmbeddedMediaUrl('<video src="::::">', 'not-a-base')).toBeNull();
  });
});

// lib/__tests__/import-client.test.ts
// The browser side of the streaming import.
//
// The parser reads NDJSON off a network stream, so the interesting cases are
// all about framing: a chunk that ends mid-line, an event split across two
// chunks, a stream that dies before the verdict. Every one of those looks like
// a normal import until it isn't, and the failure mode — a batch that reports
// success for an item that never finished — is exactly what this display was
// built to make impossible.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { importRemoteWithProgress, formatBytes } from '@/app/admin/(shell)/articles/_components/import-client';

/** Serve `chunks` as the response body, byte-for-byte as given. */
function mockStream(chunks: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importRemoteWithProgress', () => {
  it('reports every stage and returns the verdict', async () => {
    mockStream([
      '{"type":"stage","phase":"resolving","url":"https://a.example/x.mp4"}\n',
      '{"type":"stage","phase":"downloading","percent":40,"received":400,"total":1000}\n',
      '{"type":"stage","phase":"uploading","percent":80}\n',
      '{"type":"done","ok":true,"url":"/api/article-media/abc.mp4","mediaId":"m1","kind":"video","size":1000}\n',
    ]);

    const seen: string[] = [];
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.mp4', (p) =>
      seen.push(`${p.phase}:${p.percent}`),
    );

    expect(seen).toEqual(['resolving:0', 'downloading:40', 'uploading:80']);
    expect(result).toEqual({
      ok: true,
      url: '/api/article-media/abc.mp4',
      mediaId: 'm1',
      kind: 'video',
      size: 1000,
      viaAi: false,
      resolvedFrom: undefined,
    });
  });

  it('reassembles an event split across chunk boundaries', async () => {
    mockStream([
      '{"type":"stage","phase":"downl',
      'oading","percent":55}\n{"type":"do',
      'ne","ok":true,"url":"/u.jpg","kind":"image"}\n',
    ]);

    const seen: number[] = [];
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.jpg', (p) =>
      seen.push(p.percent),
    );

    expect(seen).toEqual([55]);
    expect(result.ok).toBe(true);
  });

  it('reads a final line that arrives without a trailing newline', async () => {
    mockStream(['{"type":"done","ok":true,"url":"/u.jpg","kind":"image"}']);
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.jpg', () => {});
    expect(result.ok).toBe(true);
  });

  it('surfaces a server-side failure as a result, not a throw', async () => {
    mockStream(['{"type":"done","ok":false,"error":"源站返回 HTTP 403"}\n']);
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.mp4', () => {});
    expect(result).toEqual({ ok: false, error: '源站返回 HTTP 403', viaAi: false });
  });

  it('treats a stream that ends without a verdict as a failure', async () => {
    // What a function timeout looks like from the browser: progress, then
    // silence. Reporting this as success would put a half-imported file in the
    // article.
    mockStream([
      '{"type":"stage","phase":"downloading","percent":70}\n',
      '{"type":"stage","phase":"downloading","percent":90}\n',
    ]);
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.mp4', () => {});
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error');
    if (!result.ok) expect(result.error).toContain('超时');
  });

  it('remembers that the AI stage ran when the stream is cut short', async () => {
    mockStream(['{"type":"stage","phase":"ai","url":"https://a.example/p"}\n']);
    const result = await importRemoteWithProgress('a1', 'https://a.example/p', () => {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.viaAi).toBe(true);
  });

  it('reads the error out of a non-streaming rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.mp4', () => {});
    expect(result).toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('skips a malformed line instead of failing the import', async () => {
    mockStream([
      'not json at all\n',
      '{"type":"done","ok":true,"url":"/u.jpg","kind":"image"}\n',
    ]);
    const result = await importRemoteWithProgress('a1', 'https://a.example/x.jpg', () => {});
    expect(result.ok).toBe(true);
  });
});

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('returns an empty string for nothing worth showing', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(NaN)).toBe('');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInChunks, parseRangeHeader } from '@/lib/video/chunked-fetch';

const FILE = new Uint8Array(Array.from({ length: 10_000 }, (_, i) => i % 251));

/** Mimics googlevideo: 403 for open-ended or oversized ranges, 206 otherwise. */
function googlevideoLike(maxChunk: number) {
  const calls: string[] = [];
  const impl = async (_url: string | URL | Request, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string>)?.Range ?? '';
    calls.push(range);
    const m = range.match(/^bytes=(\d+)-(\d+)$/);
    if (!m) return new Response(null, { status: 403 });
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), FILE.length - 1);
    if (end - start + 1 > maxChunk || start >= FILE.length) return new Response(null, { status: 403 });
    return new Response(FILE.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${FILE.length}`,
      },
    });
  };
  return { calls, impl };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseRangeHeader', () => {
  it('parses open-ended and bounded ranges', () => {
    expect(parseRangeHeader('bytes=0-')).toEqual({ start: 0, end: null });
    expect(parseRangeHeader('bytes=100-199')).toEqual({ start: 100, end: 199 });
  });

  it('rejects malformed, suffix and multi ranges', () => {
    expect(parseRangeHeader(null)).toBeNull();
    expect(parseRangeHeader('bytes=-500')).toBeNull();
    expect(parseRangeHeader('bytes=0-1,5-9')).toBeNull();
    expect(parseRangeHeader('bytes=9-5')).toBeNull();
  });
});

describe('fetchInChunks', () => {
  it('serves an open-ended range as bounded chunks concatenated in order', async () => {
    const { calls, impl } = googlevideoLike(3000);
    vi.stubGlobal('fetch', vi.fn(impl));

    const res = await fetchInChunks('https://cdn/video.mp4', { range: { start: 0, end: null }, chunkBytes: 3000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe(206);
    expect(res).toMatchObject({ start: 0, end: FILE.length - 1, total: FILE.length, contentType: 'video/mp4' });
    expect(await drain(res.body)).toEqual(FILE);
    expect(calls).toEqual(['bytes=0-2999', 'bytes=3000-5999', 'bytes=6000-8999', 'bytes=9000-9999']);
  });

  it('honours a bounded range that spans several chunks and clamps to the file', async () => {
    const { calls, impl } = googlevideoLike(3000);
    vi.stubGlobal('fetch', vi.fn(impl));

    const res = await fetchInChunks('https://cdn/video.mp4', { range: { start: 2500, end: 20_000 }, chunkBytes: 3000 });
    if (!res.ok) throw new Error(res.error);
    expect(res).toMatchObject({ start: 2500, end: FILE.length - 1, total: FILE.length });
    expect(await drain(res.body)).toEqual(FILE.slice(2500));
    expect(calls[0]).toBe('bytes=2500-5499');
    expect(calls.at(-1)).toBe('bytes=8500-9999');
  });

  it('makes a single request for a small bounded range', async () => {
    const { calls, impl } = googlevideoLike(3000);
    vi.stubGlobal('fetch', vi.fn(impl));

    const res = await fetchInChunks('https://cdn/video.mp4', { range: { start: 0, end: 1 }, chunkBytes: 3000 });
    if (!res.ok) throw new Error(res.error);
    expect(await drain(res.body)).toEqual(FILE.slice(0, 2));
    expect(calls).toEqual(['bytes=0-1']);
  });

  it('passes a 200 whole-body upstream through untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(FILE, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(FILE.length) } })),
    );
    const res = await fetchInChunks('https://cdn/video.mp4', { range: { start: 0, end: null } });
    if (!res.ok) throw new Error(res.error);
    expect(res.status).toBe(200);
    expect(res.total).toBe(FILE.length);
    expect(await drain(res.body)).toEqual(FILE);
  });

  it('reports upstream failures on the first chunk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    const res = await fetchInChunks('https://cdn/video.mp4', { range: null });
    expect(res).toEqual({ ok: false, status: 403, error: 'Upstream HTTP 403' });
  });

  it('errors the stream when a later chunk fails', async () => {
    const { impl } = googlevideoLike(3000);
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => (++n === 2 ? new Response(null, { status: 403 }) : impl(url, init))),
    );
    const res = await fetchInChunks('https://cdn/video.mp4', { range: null, chunkBytes: 3000 });
    if (!res.ok) throw new Error(res.error);
    await expect(drain(res.body)).rejects.toThrow('Upstream HTTP 403 for bytes 3000-5999');
  });
});

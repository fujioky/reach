// lib/__tests__/remote-import-resolve.test.ts
// Covers the two layers that were added so a pasted link resolves past a
// player page: the page-level redirect rules, and the sanitising the AI
// fallback's answers go through before anything is fetched.
//
// The point of the AI tests is not that the model is right — it is that a wrong
// or hostile answer can't get anywhere. A model returning `file:///etc/passwd`,
// a relative path, or the page it was just shown must not turn into a fetch.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractPageRedirect } from '@/lib/article/remote-fetch';
import { askAiForMedia, condenseHtml } from '@/lib/article/ai-resolver';

const BASE = 'https://mirror.example/AbC123.mp4';
const AI_CONFIG = { baseUrl: 'https://ai.example/v3', apiKey: 'k', model: 'm' };

/** Stub the Responses API with a single assistant message. */
function mockAiReply(payload: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(payload) }],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

async function ask(payload: unknown) {
  mockAiReply(payload);
  return askAiForMedia(AI_CONFIG, {
    requestedUrl: BASE,
    finalUrl: BASE,
    contentType: 'text/html',
    html: '<html></html>',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractPageRedirect', () => {
  it('follows a meta refresh', () => {
    const html = `<meta http-equiv="refresh" content="0;url=https://tinyurl.com/AbC">`;
    expect(extractPageRedirect(html, BASE)).toBe('https://tinyurl.com/AbC');
  });

  it('follows a meta refresh with the attributes reversed', () => {
    const html = `<meta content="3; URL=/watch/9f3a" http-equiv="Refresh">`;
    expect(extractPageRedirect(html, BASE)).toBe('https://mirror.example/watch/9f3a');
  });

  it('follows a literal location assignment', () => {
    const html = `<script>window.location.href = "https://cdn.example/real.mp4";</script>`;
    expect(extractPageRedirect(html, BASE)).toBe('https://cdn.example/real.mp4');
  });

  it('follows location.replace with an escaped path', () => {
    const html = `<script>location.replace("\\/media\\/clip.mp4")</script>`;
    expect(extractPageRedirect(html, BASE)).toBe('https://mirror.example/media/clip.mp4');
  });

  // The shape the ad interstitials in the wild actually ship.
  it('resolves location.href = <variable> through the variable', () => {
    const html = `<script>
      const destination = "https://ads.example/r?key=abc&amp;mg=1";
      setTimeout(() => { window.location.href = destination; }, 0);
    </script>`;
    expect(extractPageRedirect(html, BASE)).toBe('https://ads.example/r?key=abc&mg=1');
  });

  it('ignores a redirect back to the same page', () => {
    const html = `<meta http-equiv="refresh" content="5;url=${BASE}">`;
    expect(extractPageRedirect(html, BASE)).toBeNull();
  });

  it('rejects non-http schemes', () => {
    expect(extractPageRedirect(`<script>location.href="file:///etc/passwd"</script>`, BASE)).toBeNull();
    expect(extractPageRedirect(`<script>location.href="javascript:alert(1)"</script>`, BASE)).toBeNull();
  });

  it('returns null for a page that goes nowhere', () => {
    expect(extractPageRedirect('<html><body><h1>404</h1></body></html>', BASE)).toBeNull();
  });
});

describe('condenseHtml', () => {
  it('drops stylesheets, inline SVG and base64 payloads', () => {
    const html = `
      <style>${'a{color:red}'.repeat(200)}</style>
      <svg><path d="${'M0 0L1 1'.repeat(200)}"/></svg>
      <img src="data:image/png;base64,${'A'.repeat(500)}">
      <video src="/real.mp4"></video>`;
    const out = condenseHtml(html);
    expect(out).not.toContain('a{color:red}');
    expect(out).not.toContain('<path');
    expect(out).not.toContain('A'.repeat(200));
    // The one thing worth sending survives.
    expect(out).toContain('/real.mp4');
  });

  it('keeps both ends of an oversized document', () => {
    const html = `<video src="/head.mp4">${'x'.repeat(120_000)}<script>src="/tail.mp4"</script>`;
    const out = condenseHtml(html);
    expect(out.length).toBeLessThan(60_000);
    expect(out).toContain('/head.mp4');
    expect(out).toContain('/tail.mp4');
    expect(out).toContain('省略');
  });
});

describe('askAiForMedia — sanitising the model\'s answer', () => {
  it('absolutises relative candidates against the final URL', async () => {
    const result = await ask({
      candidates: [{ url: '/video/real.mp4', kind: 'video', confidence: 0.9 }],
      nextPageUrl: null,
      reason: 'ok',
    });
    expect(result?.candidates[0].url).toBe('https://mirror.example/video/real.mp4');
  });

  it('drops candidates that are not http(s)', async () => {
    const result = await ask({
      candidates: [
        { url: 'file:///etc/passwd', kind: 'video', confidence: 0.9 },
        { url: 'javascript:fetch("/x")', kind: 'video', confidence: 0.9 },
        { url: 'https://cdn.example/ok.mp4', kind: 'video', confidence: 0.5 },
      ],
      nextPageUrl: null,
      reason: '',
    });
    expect(result?.candidates.map((c) => c.url)).toEqual(['https://cdn.example/ok.mp4']);
  });

  it('deduplicates and caps the candidate list', async () => {
    const result = await ask({
      candidates: [
        { url: 'https://cdn.example/a.mp4', kind: 'video', confidence: 0.9 },
        { url: 'https://cdn.example/a.mp4', kind: 'video', confidence: 0.8 },
        { url: 'https://cdn.example/b.mp4', kind: 'video', confidence: 0.7 },
        { url: 'https://cdn.example/c.mp4', kind: 'video', confidence: 0.6 },
        { url: 'https://cdn.example/d.mp4', kind: 'video', confidence: 0.5 },
        { url: 'https://cdn.example/e.mp4', kind: 'video', confidence: 0.4 },
      ],
      nextPageUrl: null,
      reason: '',
    });
    expect(result?.candidates).toHaveLength(4);
    expect(result?.candidates[0].url).toBe('https://cdn.example/a.mp4');
  });

  it('refuses a nextPageUrl pointing at the page just read', async () => {
    const result = await ask({ candidates: [], nextPageUrl: BASE, reason: '循环' });
    expect(result?.nextPageUrl).toBeNull();
  });

  it('survives a reply wrapped in a markdown fence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text:
            '```json\n{"candidates":[{"url":"https://cdn.example/x.mp4","kind":"video","confidence":1}],"nextPageUrl":null,"reason":"找到了"}\n```',
        }),
        { status: 200 },
      ),
    );
    const result = await askAiForMedia(AI_CONFIG, {
      requestedUrl: BASE,
      finalUrl: BASE,
      contentType: 'text/html',
      html: '<html></html>',
    });
    expect(result?.candidates[0].url).toBe('https://cdn.example/x.mp4');
    expect(result?.reason).toBe('找到了');
  });

  it('returns null when the endpoint errors, so the rules stay the last word', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await askAiForMedia(AI_CONFIG, {
      requestedUrl: BASE,
      finalUrl: BASE,
      contentType: 'text/html',
      html: '<html></html>',
    });
    expect(result).toBeNull();
  });

  it('returns null when the reply is not JSON at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ output_text: '我找不到视频。' }), { status: 200 }),
    );
    const result = await askAiForMedia(AI_CONFIG, {
      requestedUrl: BASE,
      finalUrl: BASE,
      contentType: 'text/html',
      html: '<html></html>',
    });
    expect(result).toBeNull();
  });

  it('ignores the reasoning item and reads the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking…' }] },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"candidates":[{"url":"https://cdn.example/z.mp4","kind":"video","confidence":0.9}],"nextPageUrl":null,"reason":"r"}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await askAiForMedia(AI_CONFIG, {
      requestedUrl: BASE,
      finalUrl: BASE,
      contentType: 'text/html',
      html: '<html></html>',
    });
    expect(result?.candidates[0].url).toBe('https://cdn.example/z.mp4');
  });
});

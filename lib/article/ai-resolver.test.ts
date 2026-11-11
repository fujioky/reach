import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => '') }));

import { askAiForMedia, isGeminiBase, probeAiParser, readGeminiText } from './ai-resolver';

const input = {
  requestedUrl: 'https://x.example/p',
  finalUrl: 'https://x.example/p',
  contentType: 'text/html',
  html: '<video src="/v/a.mp4"></video>',
};

afterEach(() => vi.unstubAllGlobals());

describe('ai-resolver providers', () => {
  it('recognises the Gemini API host only', () => {
    expect(isGeminiBase('https://generativelanguage.googleapis.com/v1beta')).toBe(true);
    expect(isGeminiBase('https://api.openai.com/v1')).toBe(false);
    expect(isGeminiBase('not a url')).toBe(false);
  });

  it('speaks Gemini natively and reads the non-thought text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'thinking…', thought: true },
            { text: '{"candidates":[{"url":"/v/a.mp4","kind":"video","confidence":0.9}]}' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'k', model: 'gemini-3.8-flash' };
    const out = await askAiForMedia(config, input);
    expect(out?.candidates[0]?.url).toBe('https://x.example/v/a.mp4');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toContain('媒体直链提取器');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } });
    expect(readGeminiText({ candidates: [{ content: { parts: [{ text: 'a', thought: true }, { text: 'b' }] } }] })).toBe('b');
  });

  it('keeps the OpenAI Responses request unchanged for other providers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: '{"candidates":[]}' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await askAiForMedia({ baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm' }, input);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body)).toEqual(['model', 'input', 'text', 'thinking', 'max_output_tokens', 'stream']);
    expect(body).toMatchObject({ model: 'm', text: { format: { type: 'json_object' } }, thinking: { type: 'disabled' },
      max_output_tokens: 2048, stream: false });
  });

  it('probes Gemini with generateContent', async () => {
    const fetchMock = vi.fn(async () => new Response('{"candidates":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await probeAiParser({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'k', model: 'gemini-3.8-flash' });
    expect(r.ok).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(':generateContent');
  });
});

// app/api/extension/share/__tests__/route.test.ts
// /api/extension/share — the browser extension's share button.
//
// - OPTIONS preflight and every response carry open CORS headers
// - POST: 401 without a token, 400 on bad input, then NDJSON — stage lines
//   followed by exactly one done line, with absolute share/admin URLs
// - A new mirror's video upload is deferred with after(); a reused one has none

import { describe, it, expect, beforeEach, vi } from 'vitest';

let principal: { tokenId: string; userId: string; username: string } | null = null;
let quickShareInputs: Array<Record<string, unknown>> = [];
let quickShareImpl: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
let afterCallbacks: Array<() => Promise<void>> = [];
let uploadedMirrors: string[] = [];

vi.mock('@/lib/mirror/x-thread-expand', () => ({ prefetchMissingReplies: vi.fn() }));
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  },
}));

vi.mock('@/lib/auth/api-token', () => ({
  authenticateApiRequest: async () => principal,
}));

vi.mock('@/lib/mirror/create', async () => {
  const { z } = await import('zod');
  return {
    accessControlSchema: z.object({
      expiresAt: z.string().datetime().nullable().optional(),
      maxViews: z.number().int().positive().nullable().optional(),
      maxUniqueVisitors: z.number().int().positive().nullable().optional(),
      burnAfterRead: z.boolean().optional(),
    }),
    uploadMirrorVideos: async (mirrorId: string) => {
      uploadedMirrors.push(mirrorId);
      return [];
    },
  };
});

vi.mock('@/lib/mirror/quick-share', () => ({
  quickShare: async (input: Record<string, unknown>) => {
    quickShareInputs.push(input);
    return quickShareImpl(input);
  },
}));

const { POST, OPTIONS } = await import('@/app/api/extension/share/route');

const ENDPOINT = 'https://reach.test/api/extension/share';

function post(body: unknown, token = 'reach_token') {
  return POST(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

async function readEvents(response: Response) {
  const text = await response.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('/api/extension/share', () => {
  beforeEach(() => {
    principal = { tokenId: 'token-1', userId: 'user-1', username: 'admin' };
    quickShareInputs = [];
    afterCallbacks = [];
    uploadedMirrors = [];
    delete process.env.NEXT_PUBLIC_SITE_URL;
    quickShareImpl = async (input) => {
      const onStage = input.onStage as (stage: Record<string, unknown>) => void;
      onStage({ phase: 'fetching' });
      onStage({ phase: 'images', done: 0, total: 1 });
      onStage({ phase: 'saving' });
      return {
        ok: true,
        mirrorId: 'mirror-1',
        shareToken: 'abcdefghijklmnopqrstu',
        title: 'Hello',
        reused: false,
        fetchedAt: new Date('2026-09-15T10:00:00.000Z'),
        passwordMode: 'custom',
        warnings: [],
      };
    };
  });

  it('answers the CORS preflight', async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
  });

  it('rejects a missing or revoked token with 401 and CORS headers', async () => {
    principal = null;
    const response = await post({ url: 'https://x.com/jack/status/20' });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(quickShareInputs).toHaveLength(0);
  });

  it('POST rejects malformed input with 400', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ url: 'https://x.com/a/status/1', accessControl: { maxViews: 0 } })).status).toBe(400);
    expect((await post({ url: 'https://x.com/a/status/1', password: { mode: 'custom', value: '   ' } })).status).toBe(400);
    expect((await post({ url: 'https://x.com/a/status/1', password: { mode: 'none' } })).status).toBe(400);
    expect(quickShareInputs).toHaveLength(0);
  });

  it('streams stages then a done line with absolute URLs, deferring the video upload', async () => {
    const response = await post({
      url: 'https://x.com/jack/status/20',
      accessControl: { expiresAt: '2026-09-22T10:00:00.000Z', burnAfterRead: true },
      password: { mode: 'custom', value: '  open sesame ' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const events = await readEvents(response);
    expect(events).toEqual([
      { type: 'stage', phase: 'fetching' },
      { type: 'stage', phase: 'images', done: 0, total: 1 },
      { type: 'stage', phase: 'saving' },
      {
        type: 'done',
        ok: true,
        shareUrl: 'https://reach.test/s/abcdefghijklmnopqrstu',
        adminUrl: 'https://reach.test/admin/mirrors/mirror-1',
        title: 'Hello',
        reused: false,
        fetchedAt: '2026-09-15T10:00:00.000Z',
        passwordMode: 'custom',
        warnings: [],
      },
    ]);
    expect(quickShareInputs[0]).toMatchObject({
      url: 'https://x.com/jack/status/20',
      accessControl: { expiresAt: '2026-09-22T10:00:00.000Z', burnAfterRead: true },
      password: { mode: 'custom', value: 'open sesame' },
      createdBy: 'admin',
    });

    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(uploadedMirrors).toEqual(['mirror-1']);
  });

  it('builds links on NEXT_PUBLIC_SITE_URL when it is set, and skips uploads for a reused mirror', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://reach.example.com/';
    quickShareImpl = async () => ({
      ok: true,
      mirrorId: 'mirror-2',
      shareToken: 'zyxwvutsrqponmlkjihgf',
      title: 'Again',
      reused: true,
      fetchedAt: null,
      passwordMode: 'none',
      warnings: [],
    });

    const events = await readEvents(await post({ url: 'https://x.com/jack/status/20' }));
    expect(events).toEqual([
      {
        type: 'done',
        ok: true,
        shareUrl: 'https://reach.example.com/s/zyxwvutsrqponmlkjihgf',
        adminUrl: 'https://reach.example.com/admin/mirrors/mirror-2',
        title: 'Again',
        reused: true,
        fetchedAt: null,
        passwordMode: 'none',
        warnings: [],
      },
    ]);
    expect(afterCallbacks).toHaveLength(0);
    expect(quickShareInputs[0]!.password).toBeUndefined();
  });

  it('describes a fetch failure in user-facing words', async () => {
    quickShareImpl = async () => ({ ok: false, error: 'Tweet 20 not found', kind: 'not_found' });
    const events = await readEvents(await post({ url: 'https://x.com/jack/status/20' }));
    expect(events).toEqual([{ type: 'done', ok: false, error: '内容不存在或已删除' }]);
  });

  it('turns an unexpected exception into a failed done line instead of a dead stream', async () => {
    quickShareImpl = async () => {
      throw new Error('connection reset');
    };
    const events = await readEvents(await post({ url: 'https://x.com/jack/status/20' }));
    expect(events).toEqual([{ type: 'done', ok: false, error: '分享失败：connection reset' }]);
  });
});

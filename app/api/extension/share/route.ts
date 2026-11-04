// app/api/extension/share/route.ts
// The browser extension's share button: a post URL in, a share link out.
//
//   POST (Bearer) { url, accessControl?, password? } → NDJSON: `stage` lines, then one `done` line
//
// The token comes from signing in at ../session. A post that is already
// mirrored gets a new link on that mirror; otherwise a mirror is created the
// same way the admin wizard does it (lib/mirror/quick-share.ts). `password`
// sets the mirror's access password — every link to that mirror, not just this
// one; leaving it out keeps whatever the mirror has.
//
// The response streams for the same reason /api/article-import does, plus one
// more: a new mirror spends most of its time in the upstream fetch, and Chrome
// shuts down an extension service worker whose fetch() gets no response within
// 30s — so headers go out as soon as the token checks out. A stream that ends
// without a `done` line is a failure (that is what a function timeout looks like).

export const runtime = 'nodejs';
export const maxDuration = 300;

import { after } from 'next/server';
import { prefetchMissingReplies } from '@/lib/mirror/x-thread-expand';
import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/auth/api-token';
import { describeFetchError } from '@/lib/fetcher/error-message';
import { corsJson, corsPreflight, OPEN_CORS_HEADERS } from '@/lib/http/cors';
import {
  accessControlSchema,
  uploadMirrorVideos,
  type CreateMirrorStage,
} from '@/lib/mirror/create';
import { quickShare } from '@/lib/mirror/quick-share';

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  accessControl: accessControlSchema.optional(),
  password: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('inherit') }),
      z.object({ mode: z.literal('custom'), value: z.string().trim().min(1, '请填写访问密码').max(200) }),
    ])
    .optional(),
});

type ShareEvent =
  | ({ type: 'stage' } & CreateMirrorStage)
  | {
      type: 'done';
      ok: true;
      shareUrl: string;
      adminUrl: string;
      title: string;
      reused: boolean;
      fetchedAt: string | null;
      passwordMode: 'none' | 'inherit' | 'custom';
      warnings: string[];
    }
  | { type: 'done'; ok: false; error: string };

/** Share links point at the canonical site, not whichever host the extension was given. */
function siteOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(request.url).origin;
}

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  const principal = await authenticateApiRequest(request);
  if (!principal) return corsJson({ error: '登录已失效，请重新登录' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: 'Invalid JSON' }, 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return corsJson({ error: parsed.error.issues[0]?.message ?? '输入有误' }, 400);
  }

  const origin = siteOrigin(request);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ShareEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // the extension went away; the share still completes
        }
      };

      try {
        const outcome = await quickShare({
          url: parsed.data.url,
          accessControl: parsed.data.accessControl,
          password: parsed.data.password,
          createdBy: principal.username,
          onStage: (stage) => send({ type: 'stage', ...stage }),
        });

        if (outcome.ok) {
          if (!outcome.reused) {
            // Storage upload can take minutes; the link works without it.
            after(async () => {
              await prefetchMissingReplies(outcome.mirrorId);
              const warnings = await uploadMirrorVideos(outcome.mirrorId);
              for (const warning of warnings) console.warn(`[extension/share] ${warning}`);
            });
          }
          send({
            type: 'done',
            ok: true,
            shareUrl: `${origin}/s/${outcome.shareToken}`,
            adminUrl: `${origin}/admin/mirrors/${outcome.mirrorId}`,
            title: outcome.title,
            reused: outcome.reused,
            fetchedAt: outcome.fetchedAt?.toISOString() ?? null,
            passwordMode: outcome.passwordMode,
            warnings: outcome.warnings,
          });
        } else {
          send({
            type: 'done',
            ok: false,
            error: outcome.kind ? describeFetchError(outcome.kind, outcome.error) : outcome.error,
          });
        }
      } catch (err) {
        send({ type: 'done', ok: false, error: `分享失败：${(err as Error).message}` });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...OPEN_CORS_HEADERS,
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Proxies that buffer would defeat the point of streaming this at all.
      'X-Accel-Buffering': 'no',
    },
  });
}

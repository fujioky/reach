// app/api/article-import/route.ts
// Streaming counterpart to the importRemoteMedia Server Action.
//
// A Server Action answers once, at the end. That is fine for registering a file
// the browser already uploaded, and useless for a remote import: resolving the
// URL, downloading up to 500MB and re-uploading it to storage all happen on the
// server, and the author sees nothing until it is over — or until it fails,
// with a single toast that the next item's failure overwrites.
//
// This route runs the same import (lib/article/remote-import.ts) and reports it
// as NDJSON: one JSON object per line, flushed as it happens. NDJSON rather than
// SSE because the client is a fetch reader, not an EventSource — there is no
// reconnection to want, and `JSON.parse` per line is the whole parser.
//
// One URL per request. Batching them server-side would put the whole batch
// behind one function timeout and give the browser no way to retry a single
// failed item.

export const runtime = 'nodejs';
// Long enough for a large video on a slow origin. Plans below Pro cap this
// lower; the client surfaces whatever error the truncated stream produces.
export const maxDuration = 300;

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ImportStage } from '@/lib/article/remote-import';

const requestSchema = z.object({
  articleId: z.string().uuid(),
  url: z.string().trim().min(1).max(2048),
});

/** Minimum gap between progress lines — a chunk-by-chunk feed helps nobody. */
const PROGRESS_INTERVAL_MS = 250;

type ImportEvent =
  | ({ type: 'stage' } & ImportStage)
  | {
      type: 'done';
      ok: boolean;
      url?: string;
      mediaId?: string;
      kind?: 'image' | 'video';
      size?: number;
      viaAi?: boolean;
      resolvedFrom?: string;
      error?: string;
    };

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '输入有误' },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ImportEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // client went away mid-import
        }
      };

      let lastEmit = 0;
      let lastPercent = -1;

      try {
        const { importRemoteMediaToArticle } = await import('@/lib/article/remote-import');
        const outcome = await importRemoteMediaToArticle({
          articleId: parsed.data.articleId,
          url: parsed.data.url,
          onStage: (stage) => {
            // Percent-carrying stages fire per chunk; the rest are milestones
            // and always go out.
            if (stage.phase === 'downloading' || stage.phase === 'uploading') {
              const now = Date.now();
              if (stage.percent === lastPercent && now - lastEmit < PROGRESS_INTERVAL_MS) return;
              lastEmit = now;
              lastPercent = stage.percent;
            } else {
              lastPercent = -1;
            }
            send({ type: 'stage', ...stage });
          },
        });

        send({ type: 'done', ...outcome });
      } catch (err) {
        send({ type: 'done', ok: false, error: `导入失败：${(err as Error).message}` });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Proxies that buffer would defeat the point of streaming this at all.
      'X-Accel-Buffering': 'no',
    },
  });
}

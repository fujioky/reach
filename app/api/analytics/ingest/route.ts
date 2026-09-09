// app/api/analytics/ingest/route.ts
// Self-built analytics ingest — receives batches from the visitor-page
// Recorder: session metadata (device/screen), rrweb recording chunks, and
// structured events (view / click / scroll / video / dwell / …).
//
// Replaces both Vercel Analytics custom events and the old /api/track route.
// No auth (visitors are anonymous), defended in layers like /api/track was:
//   1. Body size cap — 3MB (rrweb full snapshots are large but bounded;
//      Vercel's own function body limit is 4.5MB)
//   2. Origin check — reject cross-origin posts
//   3. zod validation — shallow for rrweb events (opaque array), strict for
//      the envelope and structured events
//   4. Content existence check on session create
//   5. In-memory rate limit per visitorId
// Returns 204 (the final flush is a beacon and never reads the response).

export const runtime = 'nodejs';
export const maxDuration = 15;

import { z } from 'zod';
import { sql, eq, and, isNotNull, desc } from 'drizzle-orm';
import {
  db,
  visitEvents,
  analyticsSessions,
  analyticsChunks,
  contentItems,
} from '@/lib/db';
import { lookupGeo } from '@/lib/analytics/geo';

const MAX_BODY_BYTES = 3 * 1024 * 1024;

const structuredEventSchema = z.object({
  type: z.enum([
    'view',
    'dwell',
    'media_click',
    'outlink_click',
    'click',
    'scroll',
    'video',
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const chunkSchema = z.object({
  seq: z.number().int().min(0).max(100_000),
  // rrweb events are opaque to the server — validated only as an array.
  events: z.array(z.unknown()).min(1).max(20_000),
});

const ingestSchema = z.object({
  sessionId: z.string().uuid(),
  contentItemId: z.string().uuid(),
  shareId: z.string().uuid().nullish(),
  visitorId: z.string().min(1).max(100),
  // Present on the first batch of a session only.
  meta: z
    .object({
      screenW: z.number().int().min(0).max(20_000).optional(),
      screenH: z.number().int().min(0).max(20_000).optional(),
      viewportW: z.number().int().min(0).max(20_000).optional(),
      viewportH: z.number().int().min(0).max(20_000).optional(),
      dpr: z.number().min(0).max(10).optional(),
      lang: z.string().max(35).optional(),
      referrer: z.string().max(500).optional(),
    })
    .optional(),
  chunks: z.array(chunkSchema).max(20).optional(),
  events: z.array(structuredEventSchema).max(200).optional(),
  // Accumulated active time on the page, reported by the client.
  durationMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
});

// ── In-memory rate limit per visitorId (same MVP approach as /api/track) ──
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60; // 60 batches/min per visitor is generous
const rateMap = new Map<string, { count: number; windowStart: number }>();

function allowRequest(visitorId: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(visitorId);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(visitorId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_MAX_REQUESTS) return false;
  entry.count += 1;
  return true;
}

function checkOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') ?? request.headers.get('referer') ?? '';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  if (siteUrl) return origin.startsWith(siteUrl);
  try {
    const expected = new URL(request.url).origin;
    return !origin || origin.startsWith(expected);
  } catch {
    return true; // can't parse — best-effort
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }
    if (!checkOrigin(request)) return new Response(null, { status: 403 });

    let body: z.infer<typeof ingestSchema>;
    try {
      body = ingestSchema.parse(await request.json());
    } catch {
      return new Response(null, { status: 400 });
    }

    if (!allowRequest(body.visitorId)) return new Response(null, { status: 429 });

    const ua = request.headers.get('user-agent') ?? null;
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null;

    const eventCount = (body.events?.length ?? 0) +
      (body.chunks?.reduce((n, c) => n + c.events.length, 0) ?? 0);

    // ── Session upsert ──
    // First batch (meta present) verifies the content exists, then inserts.
    // Later batches just bump the rolling counters.
    if (body.meta) {
      const [item] = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.id, body.contentItemId))
        .limit(1);
      if (!item) return new Response(null, { status: 404 });

      // 地域：同 IP 的历史会话直接复用，新 IP 才查 ip.sb
      let geo = null;
      if (ip) {
        const [known] = await db
          .select({
            country: analyticsSessions.country,
            region: analyticsSessions.region,
            city: analyticsSessions.city,
          })
          .from(analyticsSessions)
          .where(and(eq(analyticsSessions.ip, ip), isNotNull(analyticsSessions.country)))
          .orderBy(desc(analyticsSessions.startedAt))
          .limit(1);
        geo = known ?? (await lookupGeo(ip));
      }

      await db
        .insert(analyticsSessions)
        .values({
          id: body.sessionId,
          contentItemId: body.contentItemId,
          shareId: body.shareId ?? null,
          visitorId: body.visitorId,
          ip,
          country: geo?.country ?? null,
          region: geo?.region ?? null,
          city: geo?.city ?? null,
          ua,
          screenW: body.meta.screenW ?? null,
          screenH: body.meta.screenH ?? null,
          viewportW: body.meta.viewportW ?? null,
          viewportH: body.meta.viewportH ?? null,
          dpr: body.meta.dpr != null ? Math.round(body.meta.dpr * 100) : null,
          lang: body.meta.lang ?? null,
          referrer: body.meta.referrer ?? null,
          durationMs: body.durationMs ?? 0,
          eventCount,
        })
        .onConflictDoNothing({ target: analyticsSessions.id });
    } else {
      await db
        .update(analyticsSessions)
        .set({
          lastEventAt: new Date(),
          ...(body.durationMs != null ? { durationMs: body.durationMs } : {}),
          eventCount: sql`${analyticsSessions.eventCount} + ${eventCount}`,
        })
        .where(eq(analyticsSessions.id, body.sessionId));
    }

    // ── rrweb chunks (idempotent on retries) ──
    if (body.chunks && body.chunks.length > 0) {
      await db
        .insert(analyticsChunks)
        .values(
          body.chunks.map((c) => ({
            sessionId: body.sessionId,
            seq: c.seq,
            events: c.events,
          })),
        )
        .onConflictDoNothing();
      await db
        .update(analyticsSessions)
        .set({ chunkCount: sql`${analyticsSessions.chunkCount} + ${body.chunks.length}` })
        .where(eq(analyticsSessions.id, body.sessionId));
    }

    // ── Structured events ──
    if (body.events && body.events.length > 0) {
      await db.insert(visitEvents).values(
        body.events.map((e) => ({
          contentItemId: body.contentItemId,
          shareId: body.shareId ?? null,
          sessionId: body.sessionId,
          visitorId: body.visitorId,
          type: e.type,
          payload: e.payload ?? null,
          ts: e.ts ? new Date(e.ts) : new Date(),
          ua,
          ip,
        })),
      );
    }

    return new Response(null, { status: 204 });
  } catch {
    // Tracking is best-effort — never throw at the visitor.
    return new Response(null, { status: 500 });
  }
}

// lib/analytics/queries.ts
// Aggregation queries for the self-built analytics system.
//
// System-level (content-first) since the Vercel Analytics removal: every query
// keys on content_item_id, so mirrors (visited via /s/<token> shares) and
// articles (visited at /p/<slug>) are treated uniformly. Data comes from:
//   - visit_events        structured events (view / dwell / click / scroll /
//                         video / media_click / outlink_click)
//   - analytics_sessions  one row per page open: device, screen/viewport
//                         size, real IP, rolling duration
//   - analytics_chunks    rrweb recording batches (replay/heatmap source)
//
// PostgreSQL-specific bits go through Drizzle's `sql` tagged template
// (jsonb `payload->>'key'`, extract(hour …), date_trunc). All ids are bound
// parameters — never string-concatenated. Queries are only called from admin
// RSC pages / admin API routes behind auth().

import {
  db,
  visitEvents,
  analyticsSessions,
  analyticsChunks,
  contentItems,
} from '@/lib/db';
import { sql, eq, desc, count, countDistinct } from 'drizzle-orm';

// Display-only: treat stored naive timestamps as UTC and project to CST.
// Does not rewrite rows — grouping/labels only.
function cstWallTime(col: typeof visitEvents.ts) {
  return sql`(${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai'`;
}

// ── Date helpers (previously in lib/analytics/vercel.ts) ────────────────

/** Date for N days ago (start of day, local server time). */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Start of the current week (Monday). */
export function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Overview (all content) ──────────────────────────────────────────────

/** Total view count + unique visitor count across ALL content. */
export async function getOverviewStats() {
  const [stats] = await db
    .select({
      totalViews: count(),
      uniqueVisitors: countDistinct(visitEvents.visitorId),
    })
    .from(visitEvents)
    .where(eq(visitEvents.type, 'view'));
  return {
    totalViews: Number(stats?.totalViews ?? 0),
    uniqueVisitors: Number(stats?.uniqueVisitors ?? 0),
  };
}

/** Views + unique visitors in a time window (dashboard weekly cards). */
export async function getViewsBetween(since: Date, until?: Date) {
  const untilClause = until ? sql` AND ${visitEvents.ts} < ${until}` : sql``;
  const [stats] = await db
    .select({
      views: count(),
      visitors: countDistinct(visitEvents.visitorId),
    })
    .from(visitEvents)
    .where(sql`${visitEvents.type} = 'view' AND ${visitEvents.ts} >= ${since}${untilClause}`);
  return {
    views: Number(stats?.views ?? 0),
    visitors: Number(stats?.visitors ?? 0),
  };
}

/**
 * Top N content items by views — mirrors and articles alike.
 * Single GROUP BY + JOIN (the old per-share N+1 died with the share scoping).
 */
export async function getTopContents(limit = 8) {
  const rows = await db
    .select({
      contentItemId: visitEvents.contentItemId,
      views: count(),
      visitors: countDistinct(visitEvents.visitorId),
      title: contentItems.title,
      type: contentItems.type,
      slug: contentItems.slug,
    })
    .from(visitEvents)
    .leftJoin(contentItems, eq(visitEvents.contentItemId, contentItems.id))
    .where(eq(visitEvents.type, 'view'))
    .groupBy(visitEvents.contentItemId, contentItems.title, contentItems.type, contentItems.slug)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({
    contentItemId: r.contentItemId,
    views: Number(r.views),
    visitors: Number(r.visitors),
    title: r.title ?? '（已删除）',
    type: r.type ?? 'mirror',
    slug: r.slug,
  }));
}

/** Total outlink clicks across all content. */
export async function getOverviewOutlinkClicks() {
  const [result] = await db
    .select({ total: count() })
    .from(visitEvents)
    .where(eq(visitEvents.type, 'outlink_click'));
  return Number(result?.total ?? 0);
}

/** Total media click count across all content. */
export async function getOverviewMediaInteractions() {
  const [result] = await db
    .select({ total: count() })
    .from(visitEvents)
    .where(eq(visitEvents.type, 'media_click'));
  return Number(result?.total ?? 0);
}

/** Daily views for the last N days across all content (sparkline). */
export async function getOverviewDailyViews(days = 30) {
  const dayCst = sql`date_trunc('day', ${cstWallTime(visitEvents.ts)})`;
  const rows = await db
    .select({
      day: sql<string>`to_char(${dayCst}, 'YYYY-MM-DD')`,
      views: count(),
    })
    .from(visitEvents)
    .where(
      sql`${visitEvents.type} = 'view' AND ${visitEvents.ts} >= now() - make_interval(days => ${days})`,
    )
    .groupBy(dayCst)
    .orderBy(dayCst);
  return rows.map((r) => ({ day: r.day, views: Number(r.views) }));
}

/**
 * Device class breakdown from sessions: viewport width buckets.
 * (< 768 mobile, < 1100 tablet, else desktop; unknown when unrecorded).
 */
export async function getDeviceBreakdown(contentItemId?: string) {
  const whereClause = contentItemId
    ? sql`WHERE ${analyticsSessions.contentItemId} = ${contentItemId}`
    : sql``;
  const rows = await db.execute<{ device: string; sessions: string }>(sql`
    SELECT CASE
             WHEN ${analyticsSessions.viewportW} IS NULL THEN '未知'
             WHEN ${analyticsSessions.viewportW} < 768 THEN '手机'
             WHEN ${analyticsSessions.viewportW} < 1100 THEN '平板'
             ELSE '桌面'
           END AS device,
           count(*) AS sessions
    FROM ${analyticsSessions}
    ${whereClause}
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  return rows.rows.map((r) => ({ device: r.device, sessions: Number(r.sessions) }));
}

/** Referrer hostname breakdown from sessions (top N). */
export async function getReferrerBreakdown(limit = 8) {
  const rows = await db.execute<{ referrer: string | null; sessions: string }>(sql`
    SELECT ${analyticsSessions.referrer} AS referrer, count(*) AS sessions
    FROM ${analyticsSessions}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT ${limit * 3}
  `);
  // Collapse to hostname in JS (URL parsing has no SQL equivalent worth it)
  const byHost = new Map<string, number>();
  for (const r of rows.rows) {
    let host = '(直接访问)';
    if (r.referrer) {
      try {
        host = new URL(r.referrer).hostname || '(直接访问)';
      } catch {
        host = r.referrer.slice(0, 50);
      }
    }
    byHost.set(host, (byHost.get(host) ?? 0) + Number(r.sessions));
  }
  return Array.from(byHost.entries())
    .map(([hostname, sessions]) => ({ hostname, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

// ── Per-content detail ──────────────────────────────────────────────────

/** View count + unique visitors for one content item. */
export async function getContentStats(contentItemId: string) {
  const [stats] = await db
    .select({
      totalViews: count(),
      uniqueVisitors: countDistinct(visitEvents.visitorId),
    })
    .from(visitEvents)
    .where(sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'view'`);
  return {
    totalViews: Number(stats?.totalViews ?? 0),
    uniqueVisitors: Number(stats?.uniqueVisitors ?? 0),
  };
}

/** Daily views for one content item (last 30 days). */
export async function getContentDailyViews(contentItemId: string) {
  const dayCst = sql`date_trunc('day', ${cstWallTime(visitEvents.ts)})`;
  const rows = await db
    .select({
      day: sql<string>`to_char(${dayCst}, 'YYYY-MM-DD')`,
      views: count(),
    })
    .from(visitEvents)
    .where(
      sql`${visitEvents.contentItemId} = ${contentItemId}
          AND ${visitEvents.type} = 'view'
          AND ${visitEvents.ts} >= now() - interval '30 days'`,
    )
    .groupBy(dayCst)
    .orderBy(dayCst);
  return rows.map((r) => ({ day: r.day, views: Number(r.views) }));
}

/** Hourly view distribution for one content item. */
export async function getContentHourlyViews(contentItemId: string) {
  const hourCst = sql`extract(hour from ${cstWallTime(visitEvents.ts)})`;
  const rows = await db
    .select({
      hour: sql<string>`${hourCst}::int::text`,
      views: count(),
    })
    .from(visitEvents)
    .where(sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'view'`)
    .groupBy(hourCst)
    .orderBy(hourCst);
  return rows.map((r) => ({ hour: r.hour, views: Number(r.views) }));
}

/** Per-block accumulated dwell time (BlockHeatmap data). */
export async function getBlockDwellTimes(contentItemId: string) {
  const rows = await db
    .select({
      blockId: sql<string>`${visitEvents.payload}->>'blockId'`,
      dwellMs: sql<number>`sum((${visitEvents.payload}->>'dwellMs')::int)`,
    })
    .from(visitEvents)
    .where(sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'dwell'`)
    .groupBy(sql`${visitEvents.payload}->>'blockId'`);
  return rows.map((r) => ({ ...r, dwellMs: Number(r.dwellMs) }));
}

/** Average session duration (ms) for one content item, from sessions. */
export async function getContentAvgDuration(contentItemId: string) {
  const [row] = await db
    .select({
      avgMs: sql<number>`coalesce(avg(${analyticsSessions.durationMs})::int, 0)`,
    })
    .from(analyticsSessions)
    .where(eq(analyticsSessions.contentItemId, contentItemId));
  return Number(row?.avgMs ?? 0);
}

/** Per-media click counts. */
export async function getMediaInteractions(contentItemId: string) {
  const rows = await db
    .select({
      mediaId: sql<string>`${visitEvents.payload}->>'mediaId'`,
      clicks: count(),
    })
    .from(visitEvents)
    .where(
      sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'media_click'`,
    )
    .groupBy(sql`${visitEvents.payload}->>'mediaId'`);
  return rows.map((r) => ({ mediaId: r.mediaId, clicks: Number(r.clicks) }));
}

/** Per-URL outlink click counts. */
export async function getOutlinkClicks(contentItemId: string) {
  const rows = await db
    .select({
      url: sql<string>`${visitEvents.payload}->>'url'`,
      clicks: count(),
    })
    .from(visitEvents)
    .where(sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'outlink_click'`)
    .groupBy(sql`${visitEvents.payload}->>'url'`)
    .orderBy(desc(count()));
  return rows.map((r) => ({ url: r.url, clicks: Number(r.clicks) }));
}

/** Outlink click total for one content item. */
export async function getContentOutlinkClickCount(contentItemId: string) {
  const [result] = await db
    .select({ total: count() })
    .from(visitEvents)
    .where(sql`${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'outlink_click'`);
  return Number(result?.total ?? 0);
}

// ── Video analytics ─────────────────────────────────────────────────────

/** Aggregate video interaction counts for one content item. */
export async function getVideoStats(contentItemId: string) {
  const rows = await db.execute<{ action: string; total: string }>(sql`
    SELECT ${visitEvents.payload}->>'action' AS action, count(*) AS total
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId} AND ${visitEvents.type} = 'video'
    GROUP BY 1
  `);
  const byAction = new Map(rows.rows.map((r) => [r.action, Number(r.total)]));
  return {
    plays: byAction.get('play') ?? 0,
    pauses: byAction.get('pause') ?? 0,
    seeks: byAction.get('seek') ?? 0,
    fullscreens: byAction.get('fullscreen_enter') ?? 0,
    completions: byAction.get('ended') ?? 0,
  };
}

/**
 * Video progress funnel: how many sessions reached each 10% decile.
 * A session's max reported progress counts for every decile below it.
 */
export async function getVideoProgressFunnel(contentItemId: string) {
  const rows = await db.execute<{ max_pct: string }>(sql`
    SELECT max((${visitEvents.payload}->>'pct')::int) AS max_pct
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId}
      AND ${visitEvents.type} = 'video'
      AND ${visitEvents.payload}->>'action' = 'progress'
    GROUP BY coalesce(${visitEvents.sessionId}::text, ${visitEvents.visitorId})
  `);
  const funnel = Array.from({ length: 10 }, (_, i) => ({ pct: (i + 1) * 10, sessions: 0 }));
  for (const r of rows.rows) {
    const maxPct = Number(r.max_pct);
    for (const step of funnel) if (maxPct >= step.pct) step.sessions += 1;
  }
  return funnel;
}

/** Recent pause positions (where do viewers stop?). */
export async function getVideoPausePoints(contentItemId: string, limit = 200) {
  const rows = await db.execute<{ position: string; duration: string | null }>(sql`
    SELECT ${visitEvents.payload}->>'position' AS position,
           ${visitEvents.payload}->>'duration' AS duration
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId}
      AND ${visitEvents.type} = 'video'
      AND ${visitEvents.payload}->>'action' = 'pause'
    ORDER BY ${visitEvents.ts} DESC
    LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({
    position: Number(r.position),
    duration: r.duration != null ? Number(r.duration) : null,
  }));
}

// ── Heatmap ─────────────────────────────────────────────────────────────

export interface ClickPoint {
  x: number;
  y: number;
  docW: number;
  docH: number;
  viewportW: number | null;
  sessionId: string | null;
}

/** Click coordinates for one content item (heatmap source). */
export async function getClickPoints(contentItemId: string, limit = 5000): Promise<ClickPoint[]> {
  const rows = await db.execute<{
    x: string;
    y: string;
    doc_w: string;
    doc_h: string;
    viewport_w: string | null;
    session_id: string | null;
  }>(sql`
    SELECT (${visitEvents.payload}->>'x') AS x,
           (${visitEvents.payload}->>'y') AS y,
           (${visitEvents.payload}->>'docW') AS doc_w,
           (${visitEvents.payload}->>'docH') AS doc_h,
           (${visitEvents.payload}->>'viewportW') AS viewport_w,
           ${visitEvents.sessionId}::text AS session_id
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId}
      AND ${visitEvents.type} = 'click'
      AND ${visitEvents.payload}->>'x' IS NOT NULL
    ORDER BY ${visitEvents.ts} DESC
    LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({
    x: Number(r.x),
    y: Number(r.y),
    docW: Number(r.doc_w),
    docH: Number(r.doc_h),
    viewportW: r.viewport_w != null ? Number(r.viewport_w) : null,
    sessionId: r.session_id,
  }));
}

/** Top clicked elements (selector + text), for the click table. */
export async function getTopClickTargets(contentItemId: string, limit = 12) {
  const rows = await db.execute<{ selector: string; text: string | null; clicks: string }>(sql`
    SELECT ${visitEvents.payload}->>'selector' AS selector,
           max(${visitEvents.payload}->>'text') AS text,
           count(*) AS clicks
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId}
      AND ${visitEvents.type} = 'click'
      AND ${visitEvents.payload}->>'selector' IS NOT NULL
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({
    selector: r.selector,
    text: r.text,
    clicks: Number(r.clicks),
  }));
}

/** Scroll depth distribution: how many sessions reached each depth decile. */
export async function getScrollDepthFunnel(contentItemId: string) {
  const rows = await db.execute<{ max_pct: string }>(sql`
    SELECT max((${visitEvents.payload}->>'depthPct')::int) AS max_pct
    FROM ${visitEvents}
    WHERE ${visitEvents.contentItemId} = ${contentItemId}
      AND ${visitEvents.type} = 'scroll'
    GROUP BY coalesce(${visitEvents.sessionId}::text, ${visitEvents.visitorId})
  `);
  const funnel = Array.from({ length: 10 }, (_, i) => ({ pct: (i + 1) * 10, sessions: 0 }));
  for (const r of rows.rows) {
    const maxPct = Number(r.max_pct);
    for (const step of funnel) if (maxPct >= step.pct) step.sessions += 1;
  }
  return funnel;
}

// ── Sessions (replay) ───────────────────────────────────────────────────

/** Session list for one content item (newest first). */
export async function listContentSessions(contentItemId: string, limit = 30) {
  const rows = await db
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.contentItemId, contentItemId))
    .orderBy(desc(analyticsSessions.startedAt))
    .limit(limit);
  return rows;
}

/** Recent sessions across all content, with title (overview list). */
export async function listRecentSessions(limit = 15) {
  const rows = await db
    .select({
      session: analyticsSessions,
      title: contentItems.title,
      type: contentItems.type,
    })
    .from(analyticsSessions)
    .leftJoin(contentItems, eq(analyticsSessions.contentItemId, contentItems.id))
    .orderBy(desc(analyticsSessions.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.session,
    title: r.title ?? '（已删除）',
    contentType: r.type ?? 'mirror',
  }));
}

export interface SessionFilters {
  contentItemId?: string;
  device?: 'desktop' | 'mobile';
}

/**
 * Filterable, paginated list of ALL sessions (the visit-record browser).
 * Returns rows with content title + the total for pagination.
 */
export async function listSessionsFiltered(filters: SessionFilters, limit = 30, offset = 0) {
  const conds = [sql`true`];
  if (filters.contentItemId) {
    conds.push(sql`${analyticsSessions.contentItemId} = ${filters.contentItemId}`);
  }
  if (filters.device === 'mobile') {
    conds.push(sql`${analyticsSessions.viewportW} < 768`);
  } else if (filters.device === 'desktop') {
    conds.push(sql`${analyticsSessions.viewportW} >= 768`);
  }
  const where = sql.join(conds, sql` AND `);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        session: analyticsSessions,
        title: contentItems.title,
        type: contentItems.type,
      })
      .from(analyticsSessions)
      .leftJoin(contentItems, eq(analyticsSessions.contentItemId, contentItems.id))
      .where(where)
      .orderBy(desc(analyticsSessions.startedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(analyticsSessions).where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r.session,
      title: r.title ?? '（已删除）',
      contentType: r.type ?? 'mirror',
    })),
    total: Number(total),
  };
}

/** Contents that have at least one session — for the filter dropdown. */
export async function listTrackedContents() {
  const rows = await db
    .selectDistinct({
      id: analyticsSessions.contentItemId,
      title: contentItems.title,
      type: contentItems.type,
    })
    .from(analyticsSessions)
    .leftJoin(contentItems, eq(analyticsSessions.contentItemId, contentItems.id));
  return rows
    .map((r) => ({ id: r.id, title: r.title ?? '（已删除）', type: r.type ?? 'mirror' }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}

/** One session with its content title. */
export async function getSessionWithContent(sessionId: string) {
  const [row] = await db
    .select({
      session: analyticsSessions,
      title: contentItems.title,
      type: contentItems.type,
      slug: contentItems.slug,
    })
    .from(analyticsSessions)
    .leftJoin(contentItems, eq(analyticsSessions.contentItemId, contentItems.id))
    .where(eq(analyticsSessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  return {
    ...row.session,
    title: row.title ?? '（已删除）',
    contentType: row.type ?? 'mirror',
    slug: row.slug,
  };
}

/** All rrweb events of a session, ordered by chunk seq. */
export async function getSessionRecording(sessionId: string): Promise<unknown[]> {
  const rows = await db
    .select({ seq: analyticsChunks.seq, events: analyticsChunks.events })
    .from(analyticsChunks)
    .where(eq(analyticsChunks.sessionId, sessionId))
    .orderBy(analyticsChunks.seq);
  return rows.flatMap((r) => (Array.isArray(r.events) ? (r.events as unknown[]) : []));
}

/** Structured event timeline of a session (clicks, video actions, …). */
export async function getSessionTimeline(sessionId: string, limit = 500) {
  const rows = await db
    .select({
      type: visitEvents.type,
      payload: visitEvents.payload,
      ts: visitEvents.ts,
    })
    .from(visitEvents)
    .where(eq(visitEvents.sessionId, sessionId))
    .orderBy(visitEvents.ts)
    .limit(limit);
  return rows;
}


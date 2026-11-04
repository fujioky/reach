// lib/mirror/refresh-job.ts
// Refreshing every X mirror in the background, slowly — a one-off job so older
// mirrors pick up what newer fetching stores. It is never re-run once it has
// finished.
//
// Every refresh fetches through reach-upstream with one X account, so a burst
// of them gets that account rate-limited by X — the reader's own x.com tab
// included. The job therefore refreshes one mirror per tick, and on a rate
// limit pauses RATE_LIMIT_PAUSE_MS before trying the same mirror again.
//
// Ticks come from outside: a timer on the operator's machine calls
// /api/jobs/x-refresh every few minutes, and that interval is the pace. The
// job used to drive itself on Vercel, each step requesting the next, but the
// platform dropped that self-call after four hops every time, so the chain
// kept stalling until someone happened to open a page. The state row is
// updated compare-and-set on `seq`, so overlapping ticks refresh one mirror,
// not two.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, appSettings, contentItems } from '@/lib/db';
import { isNotArticle } from '@/lib/article/queries';
import { refreshMirror } from '@/lib/mirror/refresh';

const STATE_KEY = 'x_refresh_job';
export const RATE_LIMIT_PAUSE_MS = 30 * 60_000;

export interface RefreshJobState {
  id: string;
  status: 'running' | 'done';
  ids: string[];
  index: number;
  failed: Array<{ id: string; error: string }>;
  /** Incremented by every tick that claims work; a tick only writes if it holds the current value. */
  seq: number;
  /** Epoch ms before which no refresh starts (set while paused on an X rate limit). */
  nextAt: number;
  startedAt: number;
  finishedAt?: number;
  rateLimitedUntil?: number;
}

export interface TickResult {
  status: 'running' | 'done' | 'waiting' | 'busy';
  index: number;
  total: number;
  failed: number;
}

async function load(): Promise<{ state: RefreshJobState; raw: string } | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STATE_KEY)).limit(1);
  if (!row) return null;
  try {
    return { state: JSON.parse(row.value) as RefreshJobState, raw: row.value };
  } catch {
    return null;
  }
}

/** Write `next` only if the row still holds `expectedRaw`. */
async function compareAndSet(expectedRaw: string, next: RefreshJobState): Promise<boolean> {
  const updated = await db
    .update(appSettings)
    .set({ value: JSON.stringify(next), updatedAt: new Date() })
    .where(and(eq(appSettings.key, STATE_KEY), eq(appSettings.value, expectedRaw)))
    .returning({ key: appSettings.key });
  return updated.length === 1;
}

/** Create the job over every X mirror, least recently refreshed first. */
async function startJob(): Promise<void> {
  const rows = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.platform, 'x'), isNotArticle))
    .orderBy(asc(sql`coalesce(${contentItems.refreshedAt}, ${contentItems.createdAt})`));
  const state: RefreshJobState = {
    id: randomUUID(),
    status: 'running',
    ids: rows.map((r) => r.id),
    index: 0,
    failed: [],
    seq: 0,
    nextAt: Date.now(),
    startedAt: Date.now(),
  };
  await db
    .insert(appSettings)
    .values({ key: STATE_KEY, value: JSON.stringify(state), updatedAt: new Date() })
    .onConflictDoNothing();
}

const RATE_LIMIT_RE = /rate.?limit|429|too many requests|限流/i;

function summary(state: RefreshJobState, status: TickResult['status']): TickResult {
  return { status, index: state.index, total: state.ids.length, failed: state.failed.length };
}

/** One tick: start the job if it never ran, then refresh the next mirror unless paused. */
export async function tick(): Promise<TickResult> {
  if (!(await load())) await startJob();
  const current = await load();
  if (!current) throw new Error('refresh job state is unreadable');
  const { state, raw } = current;
  if (state.status !== 'running') return summary(state, 'done');
  if (Date.now() < state.nextAt) return summary(state, 'waiting');

  const id = state.ids[state.index];
  if (!id) {
    const done = { ...state, status: 'done' as const, seq: state.seq + 1, finishedAt: Date.now() };
    await compareAndSet(raw, done);
    return summary(done, 'done');
  }

  // Claim before the slow refresh so an overlapping tick cannot also run it.
  const claimed = { ...state, seq: state.seq + 1 };
  if (!(await compareAndSet(raw, claimed))) return summary(state, 'busy');

  const result = await refreshMirror(id).catch((err: Error) => ({ changed: false, error: err.message }));
  const error = 'error' in result ? result.error : undefined;
  const now = Date.now();
  const next: RefreshJobState =
    error && RATE_LIMIT_RE.test(error)
      ? { ...claimed, nextAt: now + RATE_LIMIT_PAUSE_MS, rateLimitedUntil: now + RATE_LIMIT_PAUSE_MS }
      : {
          ...claimed,
          index: claimed.index + 1,
          failed: error ? [...claimed.failed, { id, error: error.slice(0, 300) }] : claimed.failed,
          nextAt: now,
          rateLimitedUntil: undefined,
        };
  await compareAndSet(JSON.stringify(claimed), next);
  return summary(next, next.status);
}

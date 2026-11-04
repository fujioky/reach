// lib/mirror/refresh-job.ts
// Refreshing every X mirror in the background, slowly — a one-off job that
// starts by itself (ensureJob, from the admin layout and the daily cron) so
// older mirrors pick up what newer fetching stores, and is never re-run once
// it has finished.
//
// Every refresh fetches through reach-upstream with one X account, so a burst
// of them gets that account rate-limited by X — the reader's own x.com tab
// included. The job therefore refreshes one mirror at a time, waits GAP_MS
// between them, and on a rate limit pauses RATE_LIMIT_PAUSE_MS before trying
// the same mirror again.
//
// It runs on the server, so closing the admin page does not stop it. Each
// step is its own request to /api/jobs/x-refresh: it refreshes one
// mirror, saves the progress, then (in after()) waits and calls the next
// step, so no single request comes near the function timeout. Steps are
// authorised with an HMAC of the job id under AUTH_SECRET, and the state row
// is updated compare-and-set on `seq`, so a stray or duplicated step call
// cannot run a second chain alongside the first.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, appSettings, contentItems } from '@/lib/db';
import { isNotArticle } from '@/lib/article/queries';
import { refreshMirror } from '@/lib/mirror/refresh';

const STATE_KEY = 'x_refresh_job';
/** One mirror every 5 minutes: 79 take about 6.5 hours, well inside a day, and the X account barely notices. */
export const GAP_MS = 5 * 60_000;
export const RATE_LIMIT_PAUSE_MS = 30 * 60_000;
/** Longest a step waits before handing over to the next request. */
const MAX_WAIT_MS = 60_000;

export interface RefreshJobState {
  id: string;
  status: 'running' | 'done';
  ids: string[];
  index: number;
  failed: Array<{ id: string; error: string }>;
  /** Incremented by every step; a step only runs if it holds the current value. */
  seq: number;
  /** Epoch ms before which the next refresh must not start. */
  nextAt: number;
  startedAt: number;
  finishedAt?: number;
  /** Set while paused on an X rate limit. */
  rateLimitedUntil?: number;
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

function stepToken(jobId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required for the refresh job');
  return createHmac('sha256', secret).update(`x-refresh-job:${jobId}`).digest('hex');
}

export function verifyStepToken(jobId: string, token: string): boolean {
  const expected = Buffer.from(stepToken(jobId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Wait, then ask the next step to run (as its own request). */
async function callStep(origin: string, state: RefreshJobState, delayMs: number): Promise<void> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  await fetch(`${origin}/api/jobs/x-refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${stepToken(state.id)}` },
    body: JSON.stringify({ jobId: state.id, seq: state.seq }),
  }).catch((err) => console.error('[refresh-job] could not call the next step', err));
}

/** After the current response: wait, then call the next step. */
function scheduleStep(origin: string, state: RefreshJobState, delayMs: number): void {
  after(() => callStep(origin, state, delayMs));
}

/** A running job whose chain went quiet this long is resumed by ensureJob. */
const STALLED_MS = RATE_LIMIT_PAUSE_MS + 10 * 60_000;

/**
 * Make sure the one-off job runs: start it if it never has, or restart its
 * step chain if it stalled (a step request lost to a deploy or an outage).
 * Call from a background context (after() or a cron); it awaits the step call.
 */
export async function ensureJob(origin: string): Promise<void> {
  const current = await load();
  if (!current) {
    await callStep(origin, await startJob(), 0);
    return;
  }
  const { state, raw } = current;
  if (state.status !== 'running') return;
  const [row] = await db
    .select({ updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(eq(appSettings.key, STATE_KEY))
    .limit(1);
  if (!row || Date.now() - row.updatedAt.getTime() < STALLED_MS) return;
  const resumed = { ...state, seq: state.seq + 1, nextAt: Date.now() };
  if (await compareAndSet(raw, resumed)) await callStep(origin, resumed, 0);
}

/** Create the job over every X mirror, least recently refreshed first. */
async function startJob(): Promise<RefreshJobState> {

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
  return (await load())!.state;
}

const RATE_LIMIT_RE = /rate.?limit|429|too many requests|限流/i;

/** One step: refresh the next mirror (or keep waiting), save, schedule the next step. */
export async function runStep(origin: string, jobId: string, seq: number): Promise<void> {
  const current = await load();
  if (!current) return;
  const { state, raw } = current;
  if (state.id !== jobId || state.seq !== seq || state.status !== 'running') return;

  const wait = state.nextAt - Date.now();
  if (wait > 0) {
    // Still pausing (between mirrors, or after a rate limit): hand over to a
    // fresh request rather than sleeping past the function timeout.
    const claimed = { ...state, seq: seq + 1 };
    if (await compareAndSet(raw, claimed)) scheduleStep(origin, claimed, Math.min(wait, MAX_WAIT_MS));
    return;
  }

  const id = state.ids[state.index];
  if (!id) {
    await compareAndSet(raw, { ...state, status: 'done', seq: seq + 1, finishedAt: Date.now() });
    return;
  }

  // Claim the step before the slow refresh so a duplicate call cannot also run it.
  const claimed = { ...state, seq: seq + 1 };
  if (!(await compareAndSet(raw, claimed))) return;
  const claimedRaw = JSON.stringify(claimed);

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
          nextAt: now + GAP_MS,
          rateLimitedUntil: undefined,
        };
  if (await compareAndSet(claimedRaw, next)) scheduleStep(origin, next, Math.min(next.nextAt - now, MAX_WAIT_MS));
}

// app/api/jobs/x-refresh/route.ts
// One tick of the background X refresh job (lib/mirror/refresh-job.ts),
// called by a timer on the operator's machine. Authorised by the bearer
// REFRESH_JOB_TOKEN; without that variable the route is off.

export const runtime = 'nodejs';
// A tick refreshes at most one mirror, normally well under a minute.
export const maxDuration = 300;

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { tick } from '@/lib/mirror/refresh-job';

const digest = (value: string) => createHash('sha256').update(value).digest();

export async function POST(req: NextRequest) {
  const expected = process.env.REFRESH_JOB_TOKEN;
  if (!expected) return NextResponse.json({ ok: false, error: 'disabled' }, { status: 404 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!timingSafeEqual(digest(given), digest(expected))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await tick()) });
}

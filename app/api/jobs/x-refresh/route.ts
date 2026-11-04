// app/api/jobs/x-refresh/route.ts
// One step of the background X refresh job (lib/mirror/refresh-job.ts). Only
// the job calls this: the bearer token is an HMAC of the job id under
// AUTH_SECRET, and a step whose `seq` is stale does nothing.

export const runtime = 'nodejs';
// A step refreshes one mirror (up to a minute or so) and then, in after(),
// waits up to a minute before calling the next one.
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runStep, verifyStepToken } from '@/lib/mirror/refresh-job';

const bodySchema = z.object({ jobId: z.string().uuid(), seq: z.number().int().nonnegative() });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!verifyStepToken(parsed.data.jobId, token)) return NextResponse.json({ ok: false }, { status: 401 });

  await runStep(new URL(req.url).origin, parsed.data.jobId, parsed.data.seq);
  return NextResponse.json({ ok: true });
}

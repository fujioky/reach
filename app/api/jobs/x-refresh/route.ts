// app/api/jobs/x-refresh/route.ts
// One step of the background X refresh job (lib/mirror/refresh-job.ts). Only
// the job calls this: the bearer token is an HMAC of the job id under
// AUTH_SECRET, and a step whose `seq` is stale does nothing.

export const runtime = 'nodejs';
// The response goes out at once; after() then refreshes one mirror (up to a
// minute or so) and waits up to a minute before calling the next step.
export const maxDuration = 300;

import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callStep, runStep, verifyStepToken } from '@/lib/mirror/refresh-job';

const bodySchema = z.object({ jobId: z.string().uuid(), seq: z.number().int().nonnegative() });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!verifyStepToken(parsed.data.jobId, token)) return NextResponse.json({ ok: false }, { status: 401 });

  // Answer now and work after: the caller must not wait for this step's
  // refresh, or every step's run time would include the next one's.
  const origin = new URL(req.url).origin;
  const { jobId, seq } = parsed.data;
  after(async () => {
    const next = await runStep(jobId, seq);
    if (next) await callStep(origin, next.state, next.delayMs);
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}

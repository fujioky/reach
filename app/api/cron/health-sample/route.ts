// GET /api/cron/health-sample — Vercel Cron: record health samples every 5 minutes.

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { collectSystemHealth } from '@/lib/health/checks';
import { appendHealthSample } from '@/lib/health/history';

function resolveSiteOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}`;
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const origin = resolveSiteOrigin(req);
  const snapshot = await collectSystemHealth(origin, { publicLabels: true });
  const sample = await appendHealthSample(snapshot.services);

  return NextResponse.json({
    ok: true,
    recorded: Boolean(sample),
    checkedAt: snapshot.checkedAt,
  });
}
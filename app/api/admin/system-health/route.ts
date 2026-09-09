// GET /api/admin/system-health — admin-only health snapshot with real upstream labels.

export const runtime = 'nodejs';

import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { collectSystemHealth } from '@/lib/health/checks';
import { appendHealthSample, getHealthHistory } from '@/lib/health/history';

function resolveSiteOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  if (host) return `${proto}://${host}`;
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = resolveSiteOrigin(req);
  const snapshot = await collectSystemHealth(origin);
  await appendHealthSample(snapshot.services);
  const history = await getHealthHistory();

  return NextResponse.json({
    version: snapshot.version,
    checkedAt: snapshot.checkedAt,
    services: snapshot.services,
    history,
  });
}
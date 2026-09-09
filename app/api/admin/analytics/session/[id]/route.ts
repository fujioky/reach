// GET /api/admin/analytics/session/[id] — full session payload for the
// replay/heatmap viewers: session meta + rrweb recording (all chunks,
// ordered) + structured event timeline. Admin-only (auth()); recordings can
// contain everything the visitor saw.

export const runtime = 'nodejs';

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import {
  getSessionWithContent,
  getSessionRecording,
  getSessionTimeline,
} from '@/lib/analytics/queries';
import { resignArticleMediaTokens } from '@/lib/analytics/resign-media';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const [meta, events, timeline] = await Promise.all([
    getSessionWithContent(id),
    getSessionRecording(id),
    getSessionTimeline(id),
  ]);
  if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 录制里嵌着访客当时的媒体签名 URL（6 小时过期）。回放/热力图在过期后
  // 重放这些请求会全部 403 —— 下发前把令牌重签为新的（存储数据不动）。
  const body = resignArticleMediaTokens(
    JSON.stringify({ session: meta, events, timeline }),
  );
  return new NextResponse(body, {
    headers: { 'content-type': 'application/json' },
  });
}

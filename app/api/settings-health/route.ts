// app/api/settings-health/route.ts
// Health-check endpoint for configurable upstream services (admin settings form).
//
// Auth: requires admin session cookie.

export const runtime = 'nodejs';
// The AI-parser probe waits on a model round-trip, which the other checks don't.
export const maxDuration = 30;

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import {
  probeAgentReach,
  probeDeepL,
  probeLocalVideoProxy,
  probeVideoProxy,
  probeVideoStorage,
} from '@/lib/health/checks';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service');
  const rawUrl = searchParams.get('url') ?? '';

  if (!service) {
    return NextResponse.json({ ok: false, error: 'Missing service' }, { status: 400 });
  }

  if (service === 'local_video_proxy') {
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(request.url).origin);
    const result = await probeLocalVideoProxy(origin);
    return NextResponse.json(result);
  }

  if (service === 'video_proxy') {
    const result = await probeVideoProxy(rawUrl);
    return NextResponse.json(result);
  }

  if (service === 'agent_reach') {
    if (!rawUrl) {
      return NextResponse.json({ ok: false, error: 'Invalid URL' }, { status: 400 });
    }
    const result = await probeAgentReach(rawUrl);
    return NextResponse.json(result);
  }

  if (service === 'video_storage') {
    const endpoint = searchParams.get('endpoint') ?? '';
    const region = searchParams.get('region') ?? 'auto';
    const bucket = searchParams.get('bucket') ?? '';
    const accessKey = searchParams.get('accessKey') ?? '';
    const secretKey = searchParams.get('secretKey') ?? '';

    if (!endpoint || !bucket || !accessKey || !secretKey) {
      return NextResponse.json({ ok: false, error: 'Missing storage credentials' }, { status: 400 });
    }

    const result = await probeVideoStorage({
      endpoint,
      region,
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    });
    return NextResponse.json(result);
  }

  if (service === 'deepl') {
    const key = searchParams.get('key') ?? '';
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Missing API key' }, { status: 400 });
    }
    const result = await probeDeepL(key);
    return NextResponse.json(result);
  }

  if (service === 'ai_parser') {
    const model = searchParams.get('model') ?? '';
    if (!rawUrl || !model) {
      return NextResponse.json({ ok: false, error: 'Missing base URL or model' }, { status: 400 });
    }
    // A blank key in the form means "use the env var" — probe the same way the
    // importer would, so the check answers the question actually being asked.
    const key = (searchParams.get('key') ?? '').trim() || process.env.AI_PARSER_API_KEY?.trim() || '';
    if (!key) {
      return NextResponse.json({
        ok: false,
        latencyMs: 0,
        error: '未填写 API Key，且环境变量 AI_PARSER_API_KEY 也没有配置',
      });
    }
    const { probeAiParser } = await import('@/lib/article/ai-resolver');
    const result = await probeAiParser({
      baseUrl: rawUrl.trim().replace(/\/$/, ''),
      apiKey: key,
      model: model.trim(),
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ ok: false, error: 'Unknown service' }, { status: 400 });
}
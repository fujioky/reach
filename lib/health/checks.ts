// lib/health/checks.ts — shared upstream health probes (admin + public status).

import { db, media } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { checkS3Connection } from '@/lib/storage/s3';
import { getAllSettings } from '@/lib/settings';
import { getBuildVersion } from '@/lib/version';

export type HealthProbeResult = {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
};

export type ServiceStatus = {
  id: 'video_proxy' | 'video_storage' | 'agent_reach' | 'deepl';
  name: string;
  configured: boolean;
  configLabel: string;
  state: 'ok' | 'error' | 'skipped';
  latencyMs?: number;
  httpStatus?: number;
  message?: string;
};

export async function probeLocalVideoProxy(origin: string): Promise<HealthProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${origin.replace(/\/$/, '')}/api/proxy-video?health=1`, {
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.status === 200, latencyMs: Date.now() - t0, status: res.status };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

/** Health endpoints a proxy may expose, in order of preference. */
const PROXY_HEALTH_PATHS = ['/healthz', '/health'] as const;

/** Words a health payload may report and still count as up. */
const HEALTHY_WORDS = new Set([
  'ok',
  'up',
  'pass',
  'passing',
  'healthy',
  'alive',
  'ready',
  'running',
  'true',
  'success',
]);

/**
 * Read the status word out of a health response.
 *
 * Returns null when the body doesn't state one — a 200 from a health endpoint
 * is already the answer, and a payload of metrics shouldn't be second-guessed.
 */
export function readHealthStatus(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ['status', 'state', 'health']) {
        const value = parsed[key];
        if (typeof value === 'string') return value;
        if (typeof value === 'boolean') return value ? 'ok' : 'down';
      }
    } catch {
      // Not JSON after all — fall through to the plain-text reading.
    }
    return null;
  }

  // Plain-text endpoints answer "ok" / "OK\n". Anything longer is prose, not a
  // status word.
  return trimmed.length <= 32 ? trimmed : null;
}

/**
 * Ask the proxy how it's doing, if it can say.
 *
 * Returns null when there is no health endpoint to speak of, which is the
 * signal to fall back to actually pulling a byte through it.
 *
 * Only a 2xx is taken as an answer. A proxy without a health route treats
 * `healthz` as the URL it was asked to fetch and fails in its own way — 400,
 * 404, 502, whatever its upstream does — and none of that says anything about
 * the proxy itself. So this can only ever make the check more permissive: it
 * fixes a false alarm, it can't raise a new one.
 */
export async function probeProxyHealthEndpoint(
  base: string,
): Promise<Omit<HealthProbeResult, 'latencyMs'> | null> {
  for (const path of PROXY_HEALTH_PATHS) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }

    // An HTML page at /healthz is a catch-all route or an error page dressed
    // as a 200, not a health endpoint.
    if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      await res.body?.cancel();
      continue;
    }

    const body = (await res.text().catch(() => '')).slice(0, 500);
    const status = readHealthStatus(body);
    if (status && !HEALTHY_WORDS.has(status.toLowerCase())) {
      return { ok: false, status: res.status, error: `代理自报状态：${status}` };
    }
    return { ok: true, status: res.status };
  }

  return null;
}

/**
 * Is the external video proxy usable?
 *
 * Two ways to find out, in this order:
 *
 *   1. its own /healthz — authoritative about the proxy, and independent of
 *      whatever it is being asked to forward
 *   2. pulling one byte of the most recent video through it
 *
 * (2) alone was the whole check, and it reported the proxy down whenever the
 * sample URL had gone stale — a googlevideo address expires in hours, so a
 * perfectly healthy proxy would sit there showing HTTP 502 because the thing
 * behind it no longer existed. It stays as the fallback for proxies that
 * expose no health route.
 */
export async function probeVideoProxy(proxyBase: string): Promise<HealthProbeResult> {
  const t0 = Date.now();
  const base = proxyBase.replace(/\/$/, '');

  if (base) {
    const declared = await probeProxyHealthEndpoint(base);
    if (declared) return { ...declared, latencyMs: Date.now() - t0 };
  }

  try {
    const [row] = await db
      .select({ originalUrl: media.originalUrl })
      .from(media)
      .where(eq(media.type, 'video'))
      .orderBy(desc(media.createdAt))
      .limit(1);

    if (!row) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: '该代理没有 /healthz 健康接口，且库里没有可用于实测的视频地址',
      };
    }

    const fetchUrl = base ? `${base}/${row.originalUrl}` : row.originalUrl;
    const res = await fetch(fetchUrl, {
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': 'Mozilla/5.0 (compatible; ReachProxy/1.0)',
      },
      referrer: '',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    });
    const ok = res.status === 200 || res.status === 206;
    return {
      ok,
      latencyMs: Date.now() - t0,
      status: res.status,
      // Without a health endpoint the verdict rests entirely on one stored
      // upstream URL, which may simply have expired. Say so, or the admin
      // spends the afternoon debugging a proxy that was fine.
      ...(ok
        ? {}
        : { error: `实测转发失败（HTTP ${res.status}）——该代理没有 /healthz，无法排除是样本视频地址已过期` }),
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

export async function probeAgentReach(baseUrl: string): Promise<HealthProbeResult> {
  const t0 = Date.now();
  try {
    new URL(baseUrl);
  } catch {
    return { ok: false, latencyMs: 0, error: 'Invalid URL' };
  }
  try {
    const healthUrl = `${baseUrl.replace(/\/$/, '')}/healthz`;
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    let body: { ok?: boolean } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const ok = res.ok && body?.ok === true;
    return { ok, latencyMs: Date.now() - t0, status: res.status };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

export async function probeVideoStorage(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<HealthProbeResult> {
  const result = await checkS3Connection(config);
  return {
    ok: result.ok,
    latencyMs: result.latencyMs,
    error: result.error,
  };
}

export async function probeDeepL(apiKey: string): Promise<HealthProbeResult> {
  const t0 = Date.now();
  try {
    const baseUrl = apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: ['Hello'], target_lang: 'ZH' }),
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs,
        status: res.status,
        error: `DeepL ${res.status}: ${errText.slice(0, 100)}`,
      };
    }
    return { ok: true, latencyMs, status: res.status };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

/** Public /status page only — admin uses collectSystemHealth() without publicLabels. */
export function publicServiceLabel(service: ServiceStatus): string {
  switch (service.id) {
    case 'video_proxy':
      return '视频反代通道';
    case 'video_storage':
      return service.state === 'skipped' ? '对象存储（未启用）' : '对象存储';
    case 'agent_reach':
      return '内容抓取服务';
    case 'deepl':
      return service.configLabel.includes('Free') || service.configLabel.includes('Pro')
        ? service.configLabel
        : '翻译引擎';
    default:
      return service.name;
  }
}

export function publicServiceMessage(message?: string): string | undefined {
  if (!message) return undefined;
  return message
    .replace(/https?:\/\/[^\s/]+(?:\/[^\s]*)?/g, '[已隐藏]')
    .replace(/\b(?:from|via)\s+[^\s·]+/gi, 'from [已隐藏]');
}

export async function collectSystemHealth(
  siteOrigin: string,
  options?: { publicLabels?: boolean },
): Promise<{
  version: string;
  checkedAt: string;
  services: ServiceStatus[];
}> {
  const publicLabels = options?.publicLabels ?? false;
  const settings = await getAllSettings();
  const services: ServiceStatus[] = [];

  const proxyUrl = settings.video_proxy_url.trim();
  const proxyProbe = proxyUrl
    ? await probeVideoProxy(proxyUrl)
    : await probeLocalVideoProxy(siteOrigin);
  services.push({
    id: 'video_proxy',
    name: '视频反代',
    configured: true,
    configLabel: proxyUrl ? hostLabel(proxyUrl) : 'Vercel 本站 /api/proxy-video',
    state: proxyProbe.ok ? 'ok' : 'error',
    latencyMs: proxyProbe.latencyMs,
    httpStatus: proxyProbe.status,
    message: proxyProbe.error,
  });

  const storageEnabled = settings.video_storage_enabled === 'true';
  if (!storageEnabled) {
    services.push({
      id: 'video_storage',
      name: '视频存储后端',
      configured: false,
      configLabel: '未启用',
      state: 'skipped',
      message: '管理员未开启视频存储',
    });
  } else {
    const hasCreds =
      settings.video_storage_endpoint &&
      settings.video_storage_bucket &&
      settings.video_storage_access_key &&
      settings.video_storage_secret_key;
    if (!hasCreds) {
      services.push({
        id: 'video_storage',
        name: '视频存储后端',
        configured: false,
        configLabel: '配置不完整',
        state: 'skipped',
        message: '存储已启用但缺少连接信息',
      });
    } else {
      const storageProbe = await probeVideoStorage({
        endpoint: settings.video_storage_endpoint,
        region: settings.video_storage_region,
        bucket: settings.video_storage_bucket,
        accessKeyId: settings.video_storage_access_key,
        secretAccessKey: settings.video_storage_secret_key,
      });
      const label =
        settings.video_storage_custom_domain?.trim() ||
        hostLabel(settings.video_storage_endpoint) ||
        settings.video_storage_bucket;
      services.push({
        id: 'video_storage',
        name: '视频存储后端',
        configured: true,
        configLabel: label,
        state: storageProbe.ok ? 'ok' : 'error',
        latencyMs: storageProbe.latencyMs,
        message: storageProbe.error,
      });
    }
  }

  const agentUrl = (process.env.AGENT_REACH_BASE_URL || settings.agent_reach_url).trim();
  if (!agentUrl) {
    services.push({
      id: 'agent_reach',
      name: 'Agent Reach 接口',
      configured: false,
      configLabel: '未配置',
      state: 'skipped',
      message: '未设置 Agent Reach 接口地址',
    });
  } else {
    const agentProbe = await probeAgentReach(agentUrl);
    services.push({
      id: 'agent_reach',
      name: 'Agent Reach 接口',
      configured: true,
      configLabel: hostLabel(agentUrl),
      state: agentProbe.ok ? 'ok' : 'error',
      latencyMs: agentProbe.latencyMs,
      httpStatus: agentProbe.status,
      message: agentProbe.error,
    });
  }

  const deeplKey = settings.deepl_api_key.trim();
  if (!deeplKey) {
    services.push({
      id: 'deepl',
      name: '翻译引擎',
      configured: false,
      configLabel: 'DeepL · 未配置',
      state: 'skipped',
      message: '未设置 DeepL API Key',
    });
  } else {
    const deeplProbe = await probeDeepL(deeplKey);
    const tier = deeplKey.endsWith(':fx') ? 'Free' : 'Pro';
    services.push({
      id: 'deepl',
      name: '翻译引擎',
      configured: true,
      configLabel: `DeepL ${tier}`,
      state: deeplProbe.ok ? 'ok' : 'error',
      latencyMs: deeplProbe.latencyMs,
      httpStatus: deeplProbe.status,
      message: deeplProbe.error,
    });
  }

  const visibleServices = publicLabels
    ? services.map((service) => ({
        ...service,
        configLabel: publicServiceLabel(service),
        message: publicServiceMessage(service.message),
        httpStatus: undefined,
      }))
    : services;

  return {
    version: getBuildVersion(),
    checkedAt: new Date().toISOString(),
    services: visibleServices,
  };
}
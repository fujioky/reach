// lib/settings/index.ts
// Typed accessor layer for the app_settings table.
//
// Settings are key-value pairs stored in DB. Each known key has a typed
// getter that falls back to a sensible default (matching the current
// hardcoded value) when no DB row exists — so the app works without any
// explicit configuration.
//
// Known keys:
//   video_proxy_url           — base URL for the video reverse proxy (default: '' → use Vercel /api/proxy-video directly)
//   agent_reach_url           — base URL for the upstream Agent Reach API ('' = not configured;
//                                AGENT_REACH_BASE_URL env overrides)
//   agent_reach_pwd           — password for the Agent Reach API (AGENT_REACH_PWD env overrides)
//   proxy_last_error          — last upstream error seen by proxy-video (e.g. "403 googlevideo")
//   proxy_error_at            — ISO timestamp of the last proxy error ('' = no error recorded)
//   video_storage_enabled     — "true" | "false" — whether to use a backing S3-compatible store for videos
//   video_storage_endpoint    — S3-compatible endpoint (e.g. https://<account>.r2.cloudflarestorage.com)
//   video_storage_region      — S3 region (R2: auto; other: e.g. us-east-1)
//   video_storage_bucket      — bucket name
//   video_storage_access_key  — access key id
//   video_storage_secret_key  — secret access key
//   video_storage_custom_domain — public CDN / custom domain (optional, e.g. https://cdn.example.com)
//   video_storage_use_vercel_proxy — "true" | "false" — route public URLs through the Vercel app proxy
//   video_proxy_failover_enabled   — "true" | "false" — try alternate proxy hops on upstream failure
//   video_storage_failover_enabled — "true" | "false" — fall back to storage CDN when Vercel proxy fails
//   health_history                 — JSON array of rolling health probe samples (status page charts)
//   deepl_api_key                  — DeepL API key (Free or Pro); empty = translation disabled
//   content_password_hash          — bcrypt hash of the site-wide content password ('' = unset)
//   article_media_direct           — "true" | "false" — serve article media straight from storage
//                                    instead of through /api/article-media (see lib/article/media-url.ts)
//   ai_parser_enabled              — "true" | "false" — let an LLM read a player page when the
//                                    hand-written extraction rules find no media URL
//   ai_parser_base_url             — OpenAI-compatible base URL (Responses API)
//   ai_parser_api_key              — API key; falls back to process.env.AI_PARSER_API_KEY
//   ai_parser_model                — model id

import { db, appSettings } from '@/lib/db';
import { eq } from 'drizzle-orm';

export type SettingKey =
  | 'video_proxy_url'
  | 'agent_reach_url'
  | 'agent_reach_pwd'
  | 'proxy_last_error'
  | 'proxy_error_at'
  | 'video_storage_enabled'
  | 'video_storage_endpoint'
  | 'video_storage_region'
  | 'video_storage_bucket'
  | 'video_storage_access_key'
  | 'video_storage_secret_key'
  | 'video_storage_custom_domain'
  | 'video_storage_use_vercel_proxy'
  | 'video_proxy_failover_enabled'
  | 'video_storage_failover_enabled'
  | 'health_history'
  | 'deepl_api_key'
  | 'article_media_direct'
  | 'content_password_hash'
  | 'ai_parser_enabled'
  | 'ai_parser_base_url'
  | 'ai_parser_api_key'
  | 'ai_parser_model';

const DEFAULTS: Record<SettingKey, string> = {
  video_proxy_url: '',
  agent_reach_url: '',
  agent_reach_pwd: '',
  proxy_last_error: '',
  proxy_error_at: '',
  video_storage_enabled: 'false',
  video_storage_endpoint: '',
  video_storage_region: 'auto',
  video_storage_bucket: '',
  video_storage_access_key: '',
  video_storage_secret_key: '',
  video_storage_custom_domain: '',
  video_storage_use_vercel_proxy: 'false',
  video_proxy_failover_enabled: 'false',
  video_storage_failover_enabled: 'false',
  health_history: '[]',
  deepl_api_key: '',
  article_media_direct: 'false',
  content_password_hash: '',
  ai_parser_enabled: 'false',
  ai_parser_base_url: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  ai_parser_api_key: '',
  ai_parser_model: 'doubao-seed-evolving',
};

/**
 * Get a single setting value. Returns the DB value if set, otherwise the
 * default for that key.
 */
export async function getSetting(key: SettingKey): Promise<string> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    return row?.value ?? DEFAULTS[key];
  } catch {
    // DB unavailable (e.g. cold start before migration) — return default
    return DEFAULTS[key];
  }
}

/**
 * Get all known settings as an object.
 */
export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  try {
    const rows = await db.select().from(appSettings);
    const result: Record<SettingKey, string> = { ...DEFAULTS };
    for (const row of rows) {
      if (row.key in DEFAULTS) {
        result[row.key as SettingKey] = row.value;
      }
    }
    return result;
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Upsert a setting value.
 */
export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Record a proxy error (non-blocking — fire-and-forget, never throws).
 * Called by proxy-video when an upstream 403/429/5xx is detected.
 */
export async function recordProxyError(detail: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await Promise.all([
      setSetting('proxy_last_error', detail),
      setSetting('proxy_error_at', now),
    ]);
  } catch {
    // Best-effort — don't crash the proxy request over a logging failure
  }
}

/**
 * Clear proxy error state (called when admin switches proxy or manually dismisses).
 */
export async function clearProxyError(): Promise<void> {
  await Promise.all([
    setSetting('proxy_last_error', ''),
    setSetting('proxy_error_at', ''),
  ]);
}

/**
 * 上游取流成功后调用：若之前记录过代理错误则自动清除（fire-and-forget）。
 * 一次成功即证明链路通畅 —— 瞬时故障或源 URL 过期造成的误报会自愈，
 * 不再需要管理员手动切换代理来消除告警。
 */
export async function clearProxyErrorIfSet(): Promise<void> {
  try {
    if (await getSetting('proxy_error_at')) await clearProxyError();
  } catch {
    // Best-effort — never fail the video request over this
  }
}

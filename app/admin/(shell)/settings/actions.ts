// app/admin/(shell)/settings/actions.ts
// Server Actions for the admin settings page.
//
// saveSettings — validates and persists all configurable settings to DB.
// Auth: calls auth() for defense-in-depth (proxy.ts already gated admin routes).

'use server';

import { z } from 'zod';
import { auth } from '@/auth';
import { setSetting, clearProxyError } from '@/lib/settings';

const SettingsSchema = z.object({
  video_proxy_url: z.string().max(500),
  agent_reach_url: z.string().url('请输入有效的 URL').max(500),
  agent_reach_pwd: z.string().min(1, '密码不能为空').max(200),
  video_storage_enabled: z.enum(['true', 'false']),
  video_storage_endpoint: z.string().max(500),
  video_storage_region: z.string().max(100),
  video_storage_bucket: z.string().max(200),
  video_storage_access_key: z.string().max(500),
  video_storage_secret_key: z.string().max(500),
  video_storage_custom_domain: z.string().max(500),
  video_storage_use_vercel_proxy: z.enum(['true', 'false']),
  article_media_direct: z.enum(['true', 'false']),
  video_proxy_failover_enabled: z.enum(['true', 'false']),
  video_storage_failover_enabled: z.enum(['true', 'false']),
  deepl_api_key: z.string().max(200),
  ai_parser_enabled: z.enum(['true', 'false']),
  ai_parser_base_url: z.string().max(500),
  ai_parser_api_key: z.string().max(300),
  ai_parser_model: z.string().max(200),
  content_password: z.string().max(200),
  content_password_clear: z.enum(['true', 'false']),
});

export type SaveSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveSettings(formData: FormData): Promise<SaveSettingsResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: '未授权' };

  const raw = {
    video_proxy_url: (formData.get('video_proxy_url') as string | null) ?? '',
    agent_reach_url: (formData.get('agent_reach_url') as string | null) ?? '',
    agent_reach_pwd: (formData.get('agent_reach_pwd') as string | null) ?? '',
    video_storage_enabled: (formData.get('video_storage_enabled') as string | null) ?? 'false',
    video_storage_endpoint: (formData.get('video_storage_endpoint') as string | null) ?? '',
    video_storage_region: (formData.get('video_storage_region') as string | null) ?? 'auto',
    video_storage_bucket: (formData.get('video_storage_bucket') as string | null) ?? '',
    video_storage_access_key: (formData.get('video_storage_access_key') as string | null) ?? '',
    video_storage_secret_key: (formData.get('video_storage_secret_key') as string | null) ?? '',
    video_storage_custom_domain: (formData.get('video_storage_custom_domain') as string | null) ?? '',
    video_storage_use_vercel_proxy: (formData.get('video_storage_use_vercel_proxy') as string | null) ?? 'false',
    article_media_direct: (formData.get('article_media_direct') as string | null) ?? 'false',
    video_proxy_failover_enabled: (formData.get('video_proxy_failover_enabled') as string | null) ?? 'false',
    video_storage_failover_enabled: (formData.get('video_storage_failover_enabled') as string | null) ?? 'false',
    deepl_api_key: (formData.get('deepl_api_key') as string | null) ?? '',
    ai_parser_enabled: (formData.get('ai_parser_enabled') as string | null) ?? 'false',
    ai_parser_base_url: (formData.get('ai_parser_base_url') as string | null) ?? '',
    ai_parser_api_key: (formData.get('ai_parser_api_key') as string | null) ?? '',
    ai_parser_model: (formData.get('ai_parser_model') as string | null) ?? '',
    content_password: (formData.get('content_password') as string | null) ?? '',
    content_password_clear: (formData.get('content_password_clear') as string | null) ?? 'false',
  };

  const parsed = SettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e) => e.message).join('; ');
    return { ok: false, error: msg };
  }

  // Validate storage fields when enabled
  if (parsed.data.video_storage_enabled === 'true') {
    if (!parsed.data.video_storage_endpoint || !parsed.data.video_storage_bucket || !parsed.data.video_storage_access_key || !parsed.data.video_storage_secret_key) {
      return { ok: false, error: '开启存储后端后，Endpoint、Bucket、Access Key 和 Secret Key 不能为空' };
    }
  }

  // The key may come from AI_PARSER_API_KEY instead of the form, so it is not
  // required here — the parser simply stays inert without one.
  if (parsed.data.ai_parser_enabled === 'true') {
    if (!parsed.data.ai_parser_base_url.trim() || !parsed.data.ai_parser_model.trim()) {
      return { ok: false, error: '开启 AI 解析引擎后，接口地址和模型名称不能为空' };
    }
  }

  try {
    await setSetting('video_proxy_url', parsed.data.video_proxy_url);
    await setSetting('agent_reach_url', parsed.data.agent_reach_url);
    await setSetting('agent_reach_pwd', parsed.data.agent_reach_pwd);
    await setSetting('video_storage_enabled', parsed.data.video_storage_enabled);
    await setSetting('video_storage_endpoint', parsed.data.video_storage_endpoint);
    await setSetting('video_storage_region', parsed.data.video_storage_region);
    await setSetting('video_storage_bucket', parsed.data.video_storage_bucket);
    await setSetting('video_storage_access_key', parsed.data.video_storage_access_key);
    await setSetting('video_storage_secret_key', parsed.data.video_storage_secret_key);
    await setSetting('video_storage_custom_domain', parsed.data.video_storage_custom_domain);
    await setSetting('video_storage_use_vercel_proxy', parsed.data.video_storage_use_vercel_proxy);
    await setSetting('article_media_direct', parsed.data.article_media_direct);
    await setSetting('video_proxy_failover_enabled', parsed.data.video_proxy_failover_enabled);
    await setSetting('video_storage_failover_enabled', parsed.data.video_storage_failover_enabled);
    await setSetting('deepl_api_key', parsed.data.deepl_api_key);
    await setSetting('ai_parser_enabled', parsed.data.ai_parser_enabled);
    await setSetting('ai_parser_base_url', parsed.data.ai_parser_base_url.trim());
    await setSetting('ai_parser_api_key', parsed.data.ai_parser_api_key.trim());
    await setSetting('ai_parser_model', parsed.data.ai_parser_model.trim());

    // Site-wide content password. The form never receives the stored hash, so
    // blank means "leave it alone" — clearing is an explicit checkbox.
    if (parsed.data.content_password_clear === 'true') {
      await setSetting('content_password_hash', '');
    } else if (parsed.data.content_password.trim()) {
      const { hashPassword } = await import('@/lib/content/password');
      await setSetting('content_password_hash', await hashPassword(parsed.data.content_password.trim()));
    }
    // Switching proxy URL clears any existing error state so the dashboard
    // shows clean after the admin makes a change.
    await clearProxyError();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export type ClearProxyErrorResult =
  | { ok: true }
  | { ok: false; error: string };

export async function dismissProxyError(): Promise<ClearProxyErrorResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: '未授权' };
  try {
    await clearProxyError();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

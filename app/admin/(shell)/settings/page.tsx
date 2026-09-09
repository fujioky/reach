// app/admin/(shell)/settings/page.tsx
// Admin settings page — configures video proxy, video storage backend, and
// Agent Reach API.
//
// RSC: loads current settings from DB and passes them to the client form.

import { AdminPageHeader } from '@/app/_components/admin/AdminPageHeader';
import { getAllSettings } from '@/lib/settings';
import { AdminSystemHealth } from './_components/AdminSystemHealth';
import { SettingsForm } from './_components/SettingsForm';

export default async function SettingsPage() {
  const settings = await getAllSettings();

  const proxyError = settings.proxy_error_at
    ? { detail: settings.proxy_last_error, at: settings.proxy_error_at }
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <AdminPageHeader
        label="系统"
        title="系统设置"
        description="配置视频反代、视频存储后端和上游抓取接口"
        className="mb-6"
      />

      <SettingsForm
        initialValues={{
          video_proxy_url: settings.video_proxy_url,
          agent_reach_url: settings.agent_reach_url,
          agent_reach_pwd: settings.agent_reach_pwd,
          video_storage_enabled: settings.video_storage_enabled,
          video_storage_endpoint: settings.video_storage_endpoint,
          video_storage_region: settings.video_storage_region,
          video_storage_bucket: settings.video_storage_bucket,
          video_storage_access_key: settings.video_storage_access_key,
          video_storage_secret_key: settings.video_storage_secret_key,
          video_storage_custom_domain: settings.video_storage_custom_domain,
          video_storage_use_vercel_proxy: settings.video_storage_use_vercel_proxy,
          article_media_direct: settings.article_media_direct,
          // Only whether a password exists — the hash never reaches the browser.
          content_password_set: settings.content_password_hash ? 'true' : 'false',
          video_proxy_failover_enabled: settings.video_proxy_failover_enabled,
          video_storage_failover_enabled: settings.video_storage_failover_enabled,
          deepl_api_key: settings.deepl_api_key,
          ai_parser_enabled: settings.ai_parser_enabled,
          ai_parser_base_url: settings.ai_parser_base_url,
          ai_parser_api_key: settings.ai_parser_api_key,
          ai_parser_model: settings.ai_parser_model,
        }}
        proxyError={proxyError}
      />

      <AdminSystemHealth />
    </div>
  );
}

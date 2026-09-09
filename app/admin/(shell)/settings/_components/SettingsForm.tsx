// app/admin/(shell)/settings/_components/SettingsForm.tsx
// Client component — admin settings form with inline health checks.
//
// Sections:
//   0. 代理错误横幅
//   1. 视频反代 — 卡片式选择：Vercel 函数（本站）或 外部代理
//   2. 视频存储后端 — 卡片式选择：不使用 或 S3 兼容存储
//   3. Agent Reach API
//
// Health check: calls GET /api/settings-health with current values from the
// inputs (not yet saved), so the admin can verify before saving.

'use client';

import { useState, useTransition } from 'react';
import { saveSettings, dismissProxyError } from '../actions';
import {
  describeVideoProxyFailoverChain,
} from '@/lib/video/failover';

type HealthState = 'idle' | 'checking' | 'ok' | 'error';

interface HealthResult {
  state: HealthState;
  latencyMs?: number;
  status?: number;
  error?: string;
}

const STORAGE_PRESETS = [
  {
    label: 'Cloudflare R2',
    endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    region: 'auto',
    desc: 'S3 兼容，无出口费，适合视频存储',
  },
  {
    label: 'AWS S3',
    endpoint: 'https://s3.<region>.amazonaws.com',
    region: 'us-east-1',
    desc: '标准 S3 服务',
  },
  {
    label: 'MinIO / 自托管',
    endpoint: 'https://minio.example.com',
    region: 'us-east-1',
    desc: '私有部署的 S3 兼容存储',
  },
];

function HealthBadge({ h }: { h: HealthResult }) {
  if (h.state === 'idle') return null;
  if (h.state === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] text-subtle">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
        检测中…
      </span>
    );
  }
  if (h.state === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        正常 · {h.latencyMs}ms
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-[11px] text-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-danger" />
      {h.error ?? `HTTP ${h.status}`}
    </span>
  );
}

function formatErrorTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} 小时前`;
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden ds-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-subtle">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SelectCard({
  selected,
  onClick,
  title,
  description,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all ${
        selected
          ? 'border-brand bg-brand/5 ring-1 ring-brand/30'
          : 'border-border bg-surface hover:border-brand/50 hover:bg-surface-2'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span
          className={`h-4 w-4 rounded-full border-2 ${
            selected ? 'border-brand bg-brand' : 'border-border'
          }`}
        >
          {selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" className="p-0.5">
              <circle cx="12" cy="12" r="10" />
            </svg>
          )}
        </span>
      </div>
      {description && <p className="text-[12px] text-subtle">{description}</p>}
      {selected && children && <div className="mt-1 w-full">{children}</div>}
    </button>
  );
}

export function SettingsForm({
  initialValues,
  proxyError,
}: {
  initialValues: {
    video_proxy_url: string;
    agent_reach_url: string;
    agent_reach_pwd: string;
    video_storage_enabled: string;
    video_storage_endpoint: string;
    video_storage_region: string;
    video_storage_bucket: string;
    video_storage_access_key: string;
    video_storage_secret_key: string;
    video_storage_custom_domain: string;
    video_storage_use_vercel_proxy: string;
    article_media_direct: string;
    video_proxy_failover_enabled: string;
    video_storage_failover_enabled: string;
    deepl_api_key: string;
    ai_parser_enabled: string;
    ai_parser_base_url: string;
    ai_parser_api_key: string;
    ai_parser_model: string;
    /** 'true' when a site-wide content password exists. Never the hash itself. */
    content_password_set: string;
  };
  proxyError: { detail: string; at: string } | null;
}) {
  // Video proxy state
  const [videoProxyMode, setVideoProxyMode] = useState<'vercel' | 'external'>(
    initialValues.video_proxy_url ? 'external' : 'vercel',
  );
  const [videoProxyUrl, setVideoProxyUrl] = useState(initialValues.video_proxy_url);
  const [videoProxyFailoverEnabled, setVideoProxyFailoverEnabled] = useState(
    initialValues.video_proxy_failover_enabled === 'true',
  );

  // Video storage state
  const [storageEnabled, setStorageEnabled] = useState(initialValues.video_storage_enabled === 'true');
  const [storageEndpoint, setStorageEndpoint] = useState(initialValues.video_storage_endpoint);
  const [storageRegion, setStorageRegion] = useState(initialValues.video_storage_region);
  const [storageBucket, setStorageBucket] = useState(initialValues.video_storage_bucket);
  const [storageAccessKey, setStorageAccessKey] = useState(initialValues.video_storage_access_key);
  const [storageSecretKey, setStorageSecretKey] = useState(initialValues.video_storage_secret_key);
  const [storageCustomDomain, setStorageCustomDomain] = useState(initialValues.video_storage_custom_domain);
  const [storageUseVercelProxy, setStorageUseVercelProxy] = useState(
    initialValues.video_storage_use_vercel_proxy === 'true',
  );
  const [articleMediaDirect, setArticleMediaDirect] = useState(
    initialValues.article_media_direct === 'true',
  );
  /**
   * Whether anything has been touched since the last save.
   *
   * This form is long and its only save button sits at the very bottom, so a
   * toggle flipped near the top can easily be left unsaved — the change looks
   * applied on screen while the database never hears about it.
   */
  const [dirty, setDirty] = useState(false);

  // Site-wide content password. The form only knows whether one is set, so a
  // blank field means "keep it"; removing it is an explicit choice.
  const sitePasswordSet = initialValues.content_password_set === 'true';
  const [contentPassword, setContentPassword] = useState('');
  const [clearContentPassword, setClearContentPassword] = useState(false);
  const [storageFailoverEnabled, setStorageFailoverEnabled] = useState(
    initialValues.video_storage_failover_enabled === 'true',
  );

  // Agent reach state
  const [agentUrl, setAgentUrl] = useState(initialValues.agent_reach_url);
  const [agentPwd, setAgentPwd] = useState(initialValues.agent_reach_pwd);
  const [showPwd, setShowPwd] = useState(false);

  // DeepL translation state
  const [deeplApiKey, setDeeplApiKey] = useState(initialValues.deepl_api_key);
  const [showDeeplKey, setShowDeeplKey] = useState(false);
  const [deeplHealth, setDeeplHealth] = useState<HealthResult>({ state: 'idle' });

  // AI media parser state
  const [aiParserEnabled, setAiParserEnabled] = useState(initialValues.ai_parser_enabled === 'true');
  const [aiBaseUrl, setAiBaseUrl] = useState(initialValues.ai_parser_base_url);
  const [aiApiKey, setAiApiKey] = useState(initialValues.ai_parser_api_key);
  const [aiModel, setAiModel] = useState(initialValues.ai_parser_model);
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiHealth, setAiHealth] = useState<HealthResult>({ state: 'idle' });

  const [videoProxyHealth, setVideoProxyHealth] = useState<HealthResult>({ state: 'idle' });
  const [storageHealth, setStorageHealth] = useState<HealthResult>({ state: 'idle' });
  const [agentHealth, setAgentHealth] = useState<HealthResult>({ state: 'idle' });

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [errorDismissed, setErrorDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const [, startTransition] = useTransition();

  const showErrorBanner = proxyError && !errorDismissed;

  async function handleDismissError() {
    setDismissing(true);
    await dismissProxyError();
    setDismissing(false);
    setErrorDismissed(true);
  }

  async function checkLocalVideoProxy() {
    setVideoProxyHealth({ state: 'checking' });
    try {
      const res = await fetch('/api/settings-health?service=local_video_proxy');
      const data = await res.json();
      setVideoProxyHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
      });
    } catch (err) {
      setVideoProxyHealth({ state: 'error', error: (err as Error).message });
    }
  }

  async function checkVideoProxy() {
    setVideoProxyHealth({ state: 'checking' });
    try {
      const res = await fetch(
        `/api/settings-health?service=video_proxy&url=${encodeURIComponent(videoProxyUrl.trim())}`,
      );
      const data = await res.json();
      setVideoProxyHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
      });
    } catch (err) {
      setVideoProxyHealth({ state: 'error', error: (err as Error).message });
    }
  }

  async function checkStorage() {
    setStorageHealth({ state: 'checking' });
    try {
      const qs = new URLSearchParams({
        service: 'video_storage',
        endpoint: storageEndpoint,
        region: storageRegion,
        bucket: storageBucket,
        accessKey: storageAccessKey,
        secretKey: storageSecretKey,
      });
      const res = await fetch(`/api/settings-health?${qs.toString()}`);
      const data = await res.json();
      setStorageHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
      });
    } catch (err) {
      setStorageHealth({ state: 'error', error: (err as Error).message });
    }
  }

  async function checkAgentReach() {
    setAgentHealth({ state: 'checking' });
    try {
      const res = await fetch(
        `/api/settings-health?service=agent_reach&url=${encodeURIComponent(agentUrl)}&pwd=${encodeURIComponent(agentPwd)}`,
      );
      const data = await res.json();
      setAgentHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
      });
    } catch (err) {
      setAgentHealth({ state: 'error', error: (err as Error).message });
    }
  }

  function applyStoragePreset(endpoint: string, region: string) {
    setStorageEndpoint(endpoint);
    setStorageRegion(region);
  }

  async function checkDeepL() {
    if (!deeplApiKey.trim()) {
      setDeeplHealth({ state: 'error', error: '请先填写 API Key' });
      return;
    }
    setDeeplHealth({ state: 'checking' });
    try {
      const res = await fetch('/api/settings-health?service=deepl&key=' + encodeURIComponent(deeplApiKey.trim()));
      const data = await res.json();
      setDeeplHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        error: data.error,
      });
    } catch (err) {
      setDeeplHealth({ state: 'error', error: (err as Error).message });
    }
  }

  async function checkAiParser() {
    if (!aiBaseUrl.trim() || !aiModel.trim()) {
      setAiHealth({ state: 'error', error: '请先填写接口地址和模型名称' });
      return;
    }
    setAiHealth({ state: 'checking' });
    try {
      const params = new URLSearchParams({
        service: 'ai_parser',
        url: aiBaseUrl.trim(),
        model: aiModel.trim(),
        key: aiApiKey.trim(),
      });
      const res = await fetch(`/api/settings-health?${params}`);
      const data = await res.json();
      setAiHealth({
        state: data.ok ? 'ok' : 'error',
        latencyMs: data.latencyMs,
        error: data.error,
      });
    } catch (err) {
      setAiHealth({ state: 'error', error: (err as Error).message });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveState('saving');
    setSaveError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveSettings(fd);
      if (result.ok) {
        setSaveState('saved');
        setDirty(false);
        setErrorDismissed(true);
        setTimeout(() => setSaveState('idle'), 3000);
      } else {
        setSaveState('error');
        setSaveError(result.error);
      }
    });
  }

  const inputClass =
    'w-full rounded-md border border-border bg-paper px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-1 focus:ring-brand/30';

  return (
    <form
      onSubmit={handleSubmit}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5 pb-4"
    >
      {/* ── 代理错误横幅 ── */}
      {showErrorBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-[#f59e0b]/40 bg-[#fffbeb] px-4 py-3.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="mt-0.5 flex-shrink-0" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[#92400e]">
              检测到代理封禁信号
              <span className="ml-2 text-[11px] font-normal text-[#a16207]">{formatErrorTime(proxyError.at)}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-[#a16207]">{proxyError.detail || '上游返回 403/429，建议切换到其他代理'}</div>
            <p className="mt-1.5 text-[11px] text-[#a16207]">切换下方代理后保存，错误状态会自动清除。</p>
          </div>
          <button
            type="button"
            onClick={handleDismissError}
            disabled={dismissing}
            className="ml-1 mt-0.5 flex-shrink-0 text-[#a16207] transition-colors hover:text-[#92400e] disabled:opacity-50"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* ── 视频反代 ── */}
      <SectionCard
        title="视频反代"
        description="选择视频流量经过的反向代理方式。默认使用本站 Vercel 函数，无需额外配置。"
      >
        <div className="flex flex-col gap-3">
          <SelectCard
            selected={videoProxyMode === 'vercel'}
            onClick={() => setVideoProxyMode('vercel')}
            title="Vercel 函数（本站）"
            description="通过 /api/proxy-video 直接代理，适合 Google / Twitter 视频。无需配置，自动使用当前 Vercel 部署。"
          >
            <div className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-[12px] text-muted">
              <div className="flex items-center justify-between">
                <div className="font-medium text-ink">当前代理地址</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      checkLocalVideoProxy();
                    }}
                    disabled={videoProxyHealth.state === 'checking'}
                    className="inline-flex items-center gap-1 rounded-md border border-brand/30 bg-surface px-2 py-1 text-[11px] text-muted transition-colors hover:bg-brand/10 disabled:opacity-60"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                      <path d="M12 8v4l3 3" />
                    </svg>
                    检测
                  </button>
                  <HealthBadge h={videoProxyHealth} />
                </div>
              </div>
              <code className="mt-1 block font-mono text-[11px]">/api/proxy-video</code>
              <p className="mt-1">流量通过 Vercel Functions 转发，受函数执行时长限制。</p>
            </div>
          </SelectCard>

          <SelectCard
            selected={videoProxyMode === 'external'}
            onClick={() => setVideoProxyMode('external')}
            title="外部代理"
            description="使用第三方代理地址转发视频流量，适合绕过地区限制。"
          >
            <div className="flex flex-col gap-3">
              <input type="hidden" name="video_proxy_url" value={videoProxyMode === 'vercel' ? '' : videoProxyUrl} />
              <input
                type="url"
                value={videoProxyUrl}
                onChange={(e) => {
                  setVideoProxyUrl(e.target.value);
                  setVideoProxyHealth({ state: 'idle' });
                }}
                placeholder="https://video-proxy.example.com"
                className={inputClass}
              />
              <p className="text-[11px] text-subtle">
                格式：<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">&lt;代理地址&gt;/https://video.twimg.com/...</code>（代理地址后直接拼接原始 URL，需支持 Range 请求并提供 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">/healthz</code>）
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    checkVideoProxy();
                  }}
                  disabled={videoProxyHealth.state === 'checking'}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  检测
                </button>
                <HealthBadge h={videoProxyHealth} />
              </div>
              <p className="text-[11px] leading-relaxed text-subtle">
                检测优先读取代理的 <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">/healthz</code>；
                没有这个接口时，改为取库里最近一个视频地址实拉一字节——那种情况下的失败也可能只是源地址已过期，未必是代理的问题。
              </p>
            </div>
          </SelectCard>

          <input
            type="hidden"
            name="video_proxy_failover_enabled"
            value={videoProxyFailoverEnabled ? 'true' : 'false'}
          />
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={videoProxyFailoverEnabled}
              onChange={(e) => setVideoProxyFailoverEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="font-medium text-ink">启用故障转移</span>
              <span className="mt-0.5 block text-subtle">
                外部代理失败时，服务端自动回退到直连上游。启用后播放请求会经过
                {' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">/api/proxy-video</code>
                {' '}
                以便重试。
              </span>
              {videoProxyFailoverEnabled && (
                <span className="mt-1 block font-mono text-[10px] text-subtle">
                  顺序：{describeVideoProxyFailoverChain(videoProxyMode === 'vercel' ? '' : videoProxyUrl)}
                </span>
              )}
            </span>
          </label>
        </div>
      </SectionCard>

      {/* ── 视频存储后端 ── */}
      <SectionCard
        title="视频存储后端"
        description="开启后，视频可保存到 S3 兼容存储桶，并通过自定义域名或 Vercel 代理加速分发。已落桶的视频由 /api/proxy-video 自动重定向到存储 URL。"
      >
        <div className="flex flex-col gap-3">
          <input type="hidden" name="video_storage_enabled" value={storageEnabled ? 'true' : 'false'} />
          <SelectCard
            selected={!storageEnabled}
            onClick={() => setStorageEnabled(false)}
            title="不使用存储后端"
            description="仅使用反代模式，视频不持久化到对象存储。"
          />

          <SelectCard
            selected={storageEnabled}
            onClick={() => setStorageEnabled(true)}
            title="S3 兼容存储"
            description="支持 Cloudflare R2、AWS S3、MinIO 等 S3 兼容服务。"
          >
            <div className="flex flex-col gap-3">
              {/* Presets */}
              <div className="flex flex-wrap gap-2">
                {STORAGE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyStoragePreset(p.endpoint, p.region);
                    }}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[12px] text-muted">Endpoint</label>
                  <input
                    type="url"
                    name="video_storage_endpoint"
                    value={storageEndpoint}
                    onChange={(e) => setStorageEndpoint(e.target.value)}
                    placeholder="https://<account>.r2.cloudflarestorage.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] text-muted">Region</label>
                  <input
                    type="text"
                    name="video_storage_region"
                    value={storageRegion}
                    onChange={(e) => setStorageRegion(e.target.value)}
                    placeholder="auto"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] text-muted">Bucket</label>
                  <input
                    type="text"
                    name="video_storage_bucket"
                    value={storageBucket}
                    onChange={(e) => setStorageBucket(e.target.value)}
                    placeholder="reach-videos"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] text-muted">Access Key ID</label>
                  <input
                    type="text"
                    name="video_storage_access_key"
                    value={storageAccessKey}
                    onChange={(e) => setStorageAccessKey(e.target.value)}
                    placeholder="Access Key"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] text-muted">Secret Access Key</label>
                  <input
                    type="password"
                    name="video_storage_secret_key"
                    value={storageSecretKey}
                    onChange={(e) => setStorageSecretKey(e.target.value)}
                    placeholder="Secret Key"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[12px] text-muted">自定义域名（可选）</label>
                  <input
                    type="url"
                    name="video_storage_custom_domain"
                    value={storageCustomDomain}
                    onChange={(e) => setStorageCustomDomain(e.target.value)}
                    placeholder="https://cdn.example.com"
                    className={inputClass}
                  />
                </div>
              </div>

              <input
                type="hidden"
                name="video_storage_use_vercel_proxy"
                value={storageUseVercelProxy ? 'true' : 'false'}
              />
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={storageUseVercelProxy}
                  onChange={(e) => {
                    setStorageUseVercelProxy(e.target.checked);
                    if (!e.target.checked) setStorageFailoverEnabled(false);
                  }}
                  className="h-4 w-4 accent-brand"
                />
                通过本项目 Vercel 应用代理加速（不暴露存储端点，支持缓存）
              </label>

              {storageUseVercelProxy && (
                <>
                  <input
                    type="hidden"
                    name="video_storage_failover_enabled"
                    value={storageFailoverEnabled ? 'true' : 'false'}
                  />
                  <label className="ml-6 flex cursor-pointer items-start gap-2 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      checked={storageFailoverEnabled}
                      onChange={(e) => setStorageFailoverEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-brand"
                    />
                    <span>
                      <span className="font-medium text-ink">启用故障转移</span>
                      <span className="mt-0.5 block text-subtle">
                        Vercel 代理拉取存储失败时，自动回退到自定义域名或存储 Endpoint 直链。
                      </span>
                    </span>
                  </label>
                </>
              )}
              {!storageUseVercelProxy && (
                <input type="hidden" name="video_storage_failover_enabled" value="false" />
              )}

              {/* 文章素材的分发方式 — 与上面的镜像视频代理开关同一类设置，
                  但作用于 /p/<slug> 页面里的图片和视频。 */}
              <div className="mt-1 border-t border-border pt-3">
                <input
                  type="hidden"
                  name="article_media_direct"
                  value={articleMediaDirect ? 'true' : 'false'}
                />
                <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    checked={articleMediaDirect}
                    onChange={(e) => setArticleMediaDirect(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand"
                  />
                  <span>
                    <span className="font-medium text-ink">文章素材直连存储（不经 Vercel 代理）</span>
                    <span className="mt-0.5 block text-subtle">
                      关闭时，视频经由 /api/article-media 从存储读取后流式吐出，字节全部穿过
                      Vercel 函数。开启后该地址改为 302 重定向到存储的预签名地址，
                      浏览器直接从存储取——几百 MB 的视频不再消耗 Vercel 带宽与函数时长。
                      （图片存在 Vercel Blob，只能通过预签名地址读取，两种模式下都是一次跳转。）
                    </span>
                    <span className="mt-1 block text-subtle">
                      重定向用的是带签名的临时地址，<span className="text-ink">存储桶无需开放公开读取</span>。
                      文章页里未公开的素材地址也带签名，直接猜链接打不开。
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    checkStorage();
                  }}
                  disabled={storageHealth.state === 'checking'}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  检测存储连接
                </button>
                <HealthBadge h={storageHealth} />
              </div>
            </div>
          </SelectCard>
        </div>
      </SectionCard>

      {/* ── Agent Reach API ── */}
      <SectionCard title="Agent Reach 接口" description="配置上游 Agent Reach 抓取服务的地址和密码。">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-[12px] text-muted">接口地址</label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                name="agent_reach_url"
                value={agentUrl}
                onChange={(e) => {
                  setAgentUrl(e.target.value);
                  setAgentHealth({ state: 'idle' });
                }}
                placeholder="https://agent-reach.example.com"
                className="flex-1 rounded-md border border-border bg-paper px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-1 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={checkAgentReach}
                disabled={agentHealth.state === 'checking'}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                  <path d="M12 8v4l3 3" />
                </svg>
                检测
              </button>
            </div>
            {agentHealth.state !== 'idle' && <div className="mt-2"><HealthBadge h={agentHealth} /></div>}
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] text-muted">密码</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                name="agent_reach_pwd"
                value={agentPwd}
                onChange={(e) => setAgentPwd(e.target.value)}
                placeholder="••••••"
                className="w-full rounded-md border border-border bg-paper px-3 py-2 pr-10 text-[13px] text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-1 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle transition-colors hover:text-ink"
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
              >
                {showPwd ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── 翻译引擎 ── */}
      <SectionCard
        title="翻译引擎"
        description="配置后，访客页面正文将出现翻译开关，点击后逐段翻译为简体中文（由 DeepL 提供）。"
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-[12px] text-muted">
              DeepL API Key
              <span className="ml-2 text-subtle">（Free tier 每月 50 万字，key 以 :fx 结尾）</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showDeeplKey ? 'text' : 'password'}
                  name="deepl_api_key"
                  value={deeplApiKey}
                  onChange={(e) => {
                    setDeeplApiKey(e.target.value);
                    setDeeplHealth({ state: 'idle' });
                  }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                  className={inputClass}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowDeeplKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-muted"
                  tabIndex={-1}
                  aria-label={showDeeplKey ? '隐藏' : '显示'}
                >
                  {showDeeplKey ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-subtle">
              留空则访客页不显示翻译功能。
              <a href="https://www.deepl.com/pro-api" target="_blank" rel="noopener noreferrer" className="ml-1 text-brand hover:text-brand-hover">申请 DeepL API Key ↗</a>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={checkDeepL}
              disabled={deeplHealth.state === 'checking'}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                <path d="M12 8v4l3 3" />
              </svg>
              检测连通性
            </button>
            <HealthBadge h={deeplHealth} />
          </div>
        </div>
      </SectionCard>

      {/* ── AI 解析引擎 ── */}
      <SectionCard
        title="AI 解析引擎"
        description="「插入素材」粘贴远程链接时，如果内置规则没能从页面里找到真正的图片/视频直链，把页面交给大模型再读一遍。"
      >
        <div className="flex flex-col gap-4">
          <input type="hidden" name="ai_parser_enabled" value={aiParserEnabled ? 'true' : 'false'} />
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={aiParserEnabled}
              onChange={(e) => setAiParserEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="font-medium text-ink">启用 AI 解析</span>
              <span className="mt-0.5 block text-subtle">
                只在常规规则失败后触发，每次导入最多调用两次。会把页面 HTML（最多约 48KB，
                已剔除样式与内联图片）发送给下面配置的接口——这是站外的第三方服务，
                请确认可以接受再开启。
              </span>
            </span>
          </label>

          <div className={aiParserEnabled ? '' : 'opacity-50'}>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] text-muted">
                  接口地址
                  <span className="ml-2 text-subtle">（OpenAI 兼容，需支持 Responses API）</span>
                </label>
                <input
                  type="text"
                  name="ai_parser_base_url"
                  value={aiBaseUrl}
                  onChange={(e) => {
                    setAiBaseUrl(e.target.value);
                    setAiHealth({ state: 'idle' });
                  }}
                  placeholder="https://ark.cn-beijing.volces.com/api/plan/v3"
                  className={inputClass}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1.5 text-[11px] text-subtle">
                  不要带结尾的 /responses，程序会自行拼接。
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] text-muted">模型名称</label>
                <input
                  type="text"
                  name="ai_parser_model"
                  value={aiModel}
                  onChange={(e) => {
                    setAiModel(e.target.value);
                    setAiHealth({ state: 'idle' });
                  }}
                  placeholder="doubao-seed-evolving"
                  className={inputClass}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] text-muted">API Key</label>
                <div className="relative">
                  <input
                    type={showAiKey ? 'text' : 'password'}
                    name="ai_parser_api_key"
                    value={aiApiKey}
                    onChange={(e) => {
                      setAiApiKey(e.target.value);
                      setAiHealth({ state: 'idle' });
                    }}
                    placeholder="留空则读取环境变量 AI_PARSER_API_KEY"
                    className={`${inputClass} pr-10`}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-muted"
                    tabIndex={-1}
                    aria-label={showAiKey ? '隐藏' : '显示'}
                  >
                    {showAiKey ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={checkAiParser}
                  disabled={aiHealth.state === 'checking'}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12z" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  检测连通性
                </button>
                <HealthBadge h={aiHealth} />
              </div>
            </div>
          </div>

          <p className="rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-subtle">
            AI 只负责「从这个页面里找出媒体直链」。它给出的地址仍然要过一遍内网地址拦截，
            并且必须真的返回图片/视频才会被转存——模型编造出来的链接会在这一步被挡掉，
            不会写进文章。
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="内容访问密码"
        description="给文章和镜像加一道密码。每篇内容可以选择不加密、使用这里的统一密码，或单独设置自己的密码。"
      >
        <div className="flex flex-col gap-3">
          <input
            type="hidden"
            name="content_password_clear"
            value={clearContentPassword ? 'true' : 'false'}
          />

          <div>
            <label className="mb-1.5 block text-[12px] text-muted">
              统一密码
              {sitePasswordSet && (
                <span className="ml-2 rounded-pill bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                  已设置
                </span>
              )}
            </label>
            <input
              type="password"
              name="content_password"
              value={contentPassword}
              onChange={(e) => setContentPassword(e.target.value)}
              disabled={clearContentPassword}
              autoComplete="new-password"
              placeholder={sitePasswordSet ? '留空则保持当前密码' : '设置统一密码'}
              className={`${inputClass} disabled:opacity-50`}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
              修改后，所有选择「使用系统密码」的内容会立刻改用新密码；单独设置了密码的内容不受影响。
            </p>
          </div>

          {sitePasswordSet && (
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={clearContentPassword}
                onChange={(e) => {
                  setClearContentPassword(e.target.checked);
                  if (e.target.checked) setContentPassword('');
                }}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                <span className="font-medium text-ink">清除统一密码</span>
                <span className="mt-0.5 block text-subtle">
                  清除后，选择「使用系统密码」的内容将变回公开可读。
                </span>
              </span>
            </label>
          )}
        </div>
      </SectionCard>

      {/* ── Save — sticky, so it is reachable from anywhere in a long form ── */}
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-3 border-t border-border bg-paper/85 px-1 py-3 backdrop-blur-md">
        {saveState === 'error' && saveError && (
          <span className="text-[13px] text-danger">{saveError}</span>
        )}
        {saveState === 'saved' && <span className="text-[13px] text-success">已保存</span>}
        {dirty && saveState !== 'saving' && saveState !== 'saved' && (
          <span className="flex items-center gap-1.5 text-[13px] text-warning">
            <span className="h-1.5 w-1.5 rounded-pill bg-warning" aria-hidden="true" />
            有未保存的更改
          </span>
        )}
        <button
          type="submit"
          disabled={saveState === 'saving'}
          className={`rounded-md px-5 py-2 text-[13px] font-semibold text-white transition-colors disabled:cursor-wait disabled:opacity-60 ${
            dirty
              ? 'bg-brand shadow-brand-lg ring-2 ring-brand/30 hover:bg-brand-hover'
              : 'bg-brand shadow-brand hover:bg-brand-hover'
          }`}
        >
          {saveState === 'saving' ? '保存中…' : dirty ? '保存设置 ·' : '保存设置'}
        </button>
      </div>
    </form>
  );
}

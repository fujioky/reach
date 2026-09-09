// app/admin/mirrors/_components/RefreshTranscriptButton.tsx
// 刷新字幕按钮 — 只重新抓取并更新字幕（platformData.transcript），
// 不产生版本、不走预览流程。适合给旧镜像补字幕。

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { refreshTranscriptAction } from '../actions';

export function RefreshTranscriptButton({ mirrorId }: { mirrorId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const result = await refreshTranscriptAction(mirrorId);

    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? '刷新字幕失败');
      return;
    }

    if (result.found) {
      setMessage(result.lang ? `已获取字幕（${result.lang}）` : '已获取字幕');
      router.refresh();
    } else {
      setMessage('该视频没有可用字幕');
    }
  }, [mirrorId, router]);

  if (error) {
    return <span className="text-sm text-danger">{error}</span>;
  }

  if (message) {
    return <span className="text-sm text-success">{message}</span>;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors ${loading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-surface-2 hover:text-ink'}`}
      aria-label="刷新字幕"
      title="重新抓取字幕（不产生新版本）"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-pulse' : ''} aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 15h4M13 15h4M7 11h2M11 11h6" />
      </svg>
      {loading ? '抓取中…' : '刷新字幕'}
    </button>
  );
}

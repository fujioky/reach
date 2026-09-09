// app/admin/mirrors/_components/RefreshMirrorButton.tsx
// Refresh button — starts a preview refresh and redirects to the preview page
// so the admin can review changes before applying them (D-53 extension).
//
// If no substantial change is detected, it shows a brief "内容无变化" message
// and refreshes the parent RSC.

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { previewRefreshAction } from '../actions';

export function RefreshMirrorButton({ mirrorId }: { mirrorId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const result = await previewRefreshAction(mirrorId);

    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? '刷新失败');
      return;
    }

    if (result.changed) {
      router.push(`/admin/mirrors/${mirrorId}/refresh/${result.previewId}`);
      return;
    }

    setMessage(result.message ?? '内容无变化');
    router.refresh();
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
      aria-label="重新抓取"
      title="重新抓取"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''} aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {loading ? '刷新中…' : '重新抓取'}
    </button>
  );
}

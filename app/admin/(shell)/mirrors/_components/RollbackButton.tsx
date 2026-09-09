// app/admin/mirrors/_components/RollbackButton.tsx
// Plan 05-03, Task 3 — rollback button (client component) for version history.
//
// Calls rollbackMirror Server Action to roll back the mirror to a previous
// version. Loading state: '回滚中…'. Uses useRouter().refresh() to update
// the page after success.
//
// Tailwind CSS design-system styling: rounded-md border bg-surface icon button.

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { rollbackMirror } from '../actions';

export function RollbackButton({
  contentItemId,
  versionNumber,
}: {
  contentItemId: string;
  versionNumber: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await rollbackMirror(contentItemId, versionNumber);

    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? '回滚失败');
      return;
    }

    // Refresh the page to reflect the rolled-back content
    router.refresh();
  }, [contentItemId, versionNumber, router]);

  if (error) {
    return <span className="text-[13px] text-danger">{error}</span>;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors ${loading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-surface-2 hover:text-ink'}`}
      aria-label="回滚到此版本"
      title="回滚到此版本"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''} aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      {loading ? '回滚中…' : '回滚'}
    </button>
  );
}

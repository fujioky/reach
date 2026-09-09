// app/admin/shares/_components/RevokeShareButton.tsx
// Plan 05-02, Task 1 — two-click revoke confirmation (SHRE-06, D-54).
//
// First click: button turns red, text changes to "确认撤销？".
// Second click within 3 seconds: submits revokeShare action.
// Timeout auto-restores to normal state.
//
// Only rendered for active shares (the page gates this).
// Mirrors the DeleteMirrorButton two-click pattern.

'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { revokeShare } from '../actions';

export function RevokeShareButton({ shareId, compact }: { shareId: string; compact?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFirstClick = useCallback(() => {
    if (confirming) {
      // Second click — submit revoke
      return;
    }
    setConfirming(true);
    // Auto-restore after 3 seconds
    timerRef.current = setTimeout(() => {
      setConfirming(false);
    }, 3000);
  }, [confirming]);

  const handleConfirmClick = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRevoking(true);
    setError(null);

    const result = await revokeShare(shareId);

    setRevoking(false);
    setConfirming(false);

    if (!result.ok) {
      setError(result.error ?? '撤销失败');
      return;
    }
    // Refresh the list (revalidatePath in the action also refreshes)
    router.refresh();
  }, [shareId, router]);

  if (error) {
    return <span className="text-sm text-danger">{error}</span>;
  }

  if (confirming) {
    return (
      <button
        type="button"
        onClick={handleConfirmClick}
        disabled={revoking}
        className={compact
          ? 'inline-flex items-center gap-1 rounded-md border border-danger bg-danger px-2.5 py-1.5 text-[12px] text-white transition-colors'
          : 'rounded-md bg-danger px-3 py-1.5 text-[13px] text-white transition-colors'}
        aria-label="再次点击以确认撤销"
        title="再次点击以确认撤销"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
        {revoking ? '撤销中…' : '确认撤销？'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleFirstClick}
      className={compact
        ? 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-danger hover:text-danger'
        : 'rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-danger hover:text-danger'}
      aria-label="撤销"
      title="撤销"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
      撤销
    </button>
  );
}

// app/admin/mirrors/_components/DeleteMirrorButton.tsx
// Two-click delete confirmation (UI-SPEC destructive confirmation).
//
// First click: button turns red, text changes to "确认删除？".
// Second click within 3 seconds: submits deleteMirror action.
// Timeout auto-restores to normal state.
//
// Tailwind CSS utility class baseline.

'use client';

import { useState, useRef, useCallback } from 'react';
import { deleteMirror } from '../actions';

export function DeleteMirrorButton({ mirrorId }: { mirrorId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFirstClick = useCallback(() => {
    if (confirming) {
      // Second click — submit delete
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
    setDeleting(true);
    setError(null);

    const result = await deleteMirror(mirrorId);

    setDeleting(false);
    setConfirming(false);

    if (!result.ok) {
      setError(result.error ?? '删除失败');
    }
    // On success, revalidatePath in the action will refresh the list
  }, [mirrorId]);

  if (error) {
    return <span className="text-sm text-danger">{error}</span>;
  }

  if (confirming) {
    return (
      <button
        type="button"
        onClick={handleConfirmClick}
        disabled={deleting}
        className="inline-flex items-center gap-1 rounded-md border border-danger bg-danger px-2.5 py-1.5 text-[12px] text-white transition-colors hover:bg-danger-hover"
        aria-label="再次点击以确认删除，此操作不可撤销"
        title="再次点击以确认删除，此操作不可撤销"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {deleting ? '删除中…' : '确认删除？'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleFirstClick}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-danger hover:text-danger"
      aria-label="删除"
      title="删除"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      删除
    </button>
  );
}

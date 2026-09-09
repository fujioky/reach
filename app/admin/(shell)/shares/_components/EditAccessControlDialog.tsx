// app/admin/shares/_components/EditAccessControlDialog.tsx
// Inline access-control editor — expands below the trigger instead of a modal.
//
// Used in both the mirror detail share table and the content-row share table.
// When expanded, shows the four access-control fields inline. On save it
// calls updateAccessControl, then collapses and refreshes the parent RSC.

'use client';

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAccessControl, type AccessControlParams } from '../actions';

// ── Helpers ──────────────────────────────────────────────────
// Convert a Date (from DB) to the value a datetime-local input expects
// (yyyy-MM-ddTHH:mm in local time). null → ''.
function toDatetimeLocalValue(date: Date | null | undefined): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
}

// Convert a datetime-local value (yyyy-MM-ddTHH:mm, local time) to an
// ISO string for the Server Action. '' → null.
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Parse a number input value: '' → null, else parseInt (must be ≥ 1).
function parseNumberInput(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

// ── Props ────────────────────────────────────────────────────
interface EditAccessControlDialogProps {
  shareId: string;
  expiresAt: Date | null;
  maxViews: number | null;
  maxUniqueVisitors: number | null;
  burnAfterRead: boolean;
  compact?: boolean;
}

export function EditAccessControlDialog({
  shareId,
  expiresAt,
  maxViews,
  maxUniqueVisitors,
  burnAfterRead,
  compact,
}: EditAccessControlDialogProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expiryValue, setExpiryValue] = useState('');
  const [maxViewsValue, setMaxViewsValue] = useState('');
  const [maxUniqueVisitorsValue, setMaxUniqueVisitorsValue] = useState('');
  const [burnValue, setBurnValue] = useState(false);

  const [, startTransition] = useTransition();

  const open = useCallback(() => {
    setExpiryValue(toDatetimeLocalValue(expiresAt));
    setMaxViewsValue(maxViews !== null ? String(maxViews) : '');
    setMaxUniqueVisitorsValue(maxUniqueVisitors !== null ? String(maxUniqueVisitors) : '');
    setBurnValue(burnAfterRead);
    setError(null);
    setSaved(false);
    setExpanded(true);
  }, [expiresAt, maxViews, maxUniqueVisitors, burnAfterRead]);

  const close = useCallback(() => {
    setExpanded(false);
    setError(null);
    setSaved(false);
  }, []);

  const handleToggle = useCallback(() => {
    if (expanded) close();
    else open();
  }, [expanded, close, open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      setSaved(false);

      const params: AccessControlParams = {
        expiresAt: fromDatetimeLocalValue(expiryValue),
        maxViews: parseNumberInput(maxViewsValue),
        maxUniqueVisitors: parseNumberInput(maxUniqueVisitorsValue),
        burnAfterRead: burnValue,
      };

      const result = await updateAccessControl(shareId, params);

      setSaving(false);

      if (!result.ok) {
        setError(result.error ?? '保存失败');
        return;
      }

      setSaved(true);
      // Refresh the parent RSC immediately, then collapse after a short
      // confirmation so the admin sees the updated status/access summary.
      startTransition(() => {
        router.refresh();
      });
      setTimeout(() => {
        setSaved(false);
        setExpanded(false);
      }, 900);
    },
    [shareId, expiryValue, maxViewsValue, maxUniqueVisitorsValue, burnValue, router, close],
  );

  const inputClass =
    'w-full rounded-md border border-border bg-paper px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-1 focus:ring-brand/30';

  return (
    <div className="relative inline-flex">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleToggle}
        className={compact
          ? 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink'
          : 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink'}
        aria-expanded={expanded}
        aria-controls={`ac-panel-${shareId}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        {expanded ? '收起' : '编辑'}
      </button>

      {/* Popover panel — floats below the trigger without affecting row layout */}
      {expanded && (
        <div
          id={`ac-panel-${shareId}`}
          className="absolute right-0 top-full z-[100] mt-1 w-[260px] ds-card p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {error && (
            <div className="mb-3 rounded-md border border-danger bg-danger/10 px-3 py-2 text-[12px] text-danger" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* 有效期 */}
            <div>
              <label className="mb-1 block text-[12px] text-muted" htmlFor={`expiry-${shareId}`}>
                有效期（留空 = 无限制）
              </label>
              <input
                id={`expiry-${shareId}`}
                type="datetime-local"
                value={expiryValue}
                onChange={(e) => setExpiryValue(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* 总打开次数 */}
            <div>
              <label className="mb-1 block text-[12px] text-muted" htmlFor={`maxviews-${shareId}`}>
                总打开次数（留空 = 无限制）
              </label>
              <input
                id={`maxviews-${shareId}`}
                type="number"
                min="1"
                value={maxViewsValue}
                onChange={(e) => setMaxViewsValue(e.target.value)}
                placeholder="无限制"
                className={inputClass}
              />
            </div>

            {/* 独立访客数 */}
            <div>
              <label className="mb-1 block text-[12px] text-muted" htmlFor={`maxvisitors-${shareId}`}>
                独立访客数（留空 = 无限制）
              </label>
              <input
                id={`maxvisitors-${shareId}`}
                type="number"
                min="1"
                value={maxUniqueVisitorsValue}
                onChange={(e) => setMaxUniqueVisitorsValue(e.target.value)}
                placeholder="无限制"
                className={inputClass}
              />
            </div>

            {/* 阅后销毁 */}
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted" htmlFor={`burn-${shareId}`}>
              <input
                id={`burn-${shareId}`}
                type="checkbox"
                checked={burnValue}
                onChange={(e) => setBurnValue(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              阅后销毁（查看一次后自动失效）
            </label>

            {/* Actions */}
            <div className="mt-1 flex items-center justify-end gap-2">
              {saved && <span className="text-[12px] text-success">已保存 ✓</span>}
              <button
                type="button"
                onClick={close}
                disabled={saving}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-white shadow-brand transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

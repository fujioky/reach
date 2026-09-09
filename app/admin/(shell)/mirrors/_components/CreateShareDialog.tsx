// app/admin/(shell)/mirrors/_components/CreateShareDialog.tsx
// 为已有内容新增分享链接的弹窗（内容详情页"新增分享"按钮）。
// 与 EditAccessControlDialog 复用相同的表单结构，调用 createShare action。

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createShare } from '../actions';

function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseNumberInput(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

const inputClass =
  'min-h-[44px] w-full rounded-xs border border-border bg-surface px-3 py-2.5 text-base text-ink outline-none transition-colors focus:border-brand';

export function CreateShareDialog({ contentItemId }: { contentItemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const [expiryValue, setExpiryValue] = useState('');
  const [maxViewsValue, setMaxViewsValue] = useState('');
  const [maxUniqueVisitorsValue, setMaxUniqueVisitorsValue] = useState('');
  const [burnValue, setBurnValue] = useState(false);

  const handleOpen = useCallback(() => {
    setExpiryValue('');
    setMaxViewsValue('');
    setMaxUniqueVisitorsValue('');
    setBurnValue(false);
    setError(null);
    setCreated(null);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setError(null);
    setCreated(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);

      const result = await createShare({
        contentItemId,
        accessControl: {
          expiresAt: fromDatetimeLocalValue(expiryValue),
          maxViews: parseNumberInput(maxViewsValue),
          maxUniqueVisitors: parseNumberInput(maxUniqueVisitorsValue),
          burnAfterRead: burnValue,
        },
      });

      setSaving(false);

      if (!result.ok) {
        setError(result.error ?? '创建失败');
        return;
      }

      setCreated(result.token ?? null);
      router.refresh();
    },
    [contentItemId, expiryValue, maxViewsValue, maxUniqueVisitorsValue, burnValue, router],
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="ds-btn-primary px-4 py-2 text-sm text-white shadow-brand transition-colors hover:bg-brand-hover"
      >
        + 新增分享
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="新增分享"
        >
          <div className="w-[90%] max-w-[480px] rounded-lg bg-surface p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-semibold text-ink">新增分享链接</h2>

            {created ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-xs border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
                  分享链接已创建。
                </div>
                <div className="rounded-xs border border-border bg-paper px-3 py-2 font-mono text-sm text-ink break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/s/${created}` : `/s/${created}`}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-xs border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-3 rounded-xs border border-danger bg-danger/10 px-3 py-2.5 text-sm text-danger">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm text-muted" htmlFor="cs-expiry">
                      有效期（留空 = 无限制）
                    </label>
                    <input id="cs-expiry" type="datetime-local" value={expiryValue}
                      onChange={(e) => setExpiryValue(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm text-muted" htmlFor="cs-maxviews">
                      总打开次数（留空 = 无限制）
                    </label>
                    <input id="cs-maxviews" type="number" min="1" value={maxViewsValue}
                      onChange={(e) => setMaxViewsValue(e.target.value)} placeholder="无限制" className={inputClass} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm text-muted" htmlFor="cs-maxvisitors">
                      独立访客数（留空 = 无限制）
                    </label>
                    <input id="cs-maxvisitors" type="number" min="1" value={maxUniqueVisitorsValue}
                      onChange={(e) => setMaxUniqueVisitorsValue(e.target.value)} placeholder="无限制" className={inputClass} />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2" htmlFor="cs-burn">
                    <input id="cs-burn" type="checkbox" checked={burnValue}
                      onChange={(e) => setBurnValue(e.target.checked)}
                      className="h-[18px] w-[18px] accent-brand" />
                    <span className="text-sm text-ink">阅后销毁</span>
                  </label>
                  <div className="mt-2 flex justify-end gap-3">
                    <button type="button" onClick={handleClose} disabled={saving}
                      className="rounded-xs border border-border px-4 py-2 text-sm text-muted transition-colors">
                      取消
                    </button>
                    <button type="submit" disabled={saving}
                      className={saving
                        ? 'rounded-xs border border-border bg-surface-2 px-4 py-2 text-sm text-subtle'
                        : 'rounded-xs bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand-hover'}>
                      {saving ? '创建中…' : '创建'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

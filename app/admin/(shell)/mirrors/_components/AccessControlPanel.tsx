// app/admin/mirrors/_components/AccessControlPanel.tsx
// 访问控制面板 — 可折叠（D-50）。默认收起 = 无限制。
//
// 展开后显示：有效期、总打开次数、独立访客数、阅后销毁。
// Reach 品牌样式（Tailwind）。

'use client';

import { useState, useCallback, useEffect } from 'react';

export interface AccessControlValues {
  expiresAt: string | null;
  maxViews: number | null;
  maxUniqueVisitors: number | null;
  burnAfterRead: boolean;
}

const UNLIMITED: AccessControlValues = {
  expiresAt: null, maxViews: null, maxUniqueVisitors: null, burnAfterRead: false,
};

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand';

export function AccessControlPanel({ onChange }: { onChange: (values: AccessControlValues) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [expiryValue, setExpiryValue] = useState('');
  const [maxViewsValue, setMaxViewsValue] = useState('');
  const [maxUniqueVisitorsValue, setMaxUniqueVisitorsValue] = useState('');
  const [burnValue, setBurnValue] = useState(false);

  const computeValues = useCallback((): AccessControlValues => {
    if (!expanded) return UNLIMITED;
    return {
      expiresAt: fromDatetimeLocal(expiryValue),
      maxViews: parseNumber(maxViewsValue),
      maxUniqueVisitors: parseNumber(maxUniqueVisitorsValue),
      burnAfterRead: burnValue,
    };
  }, [expanded, expiryValue, maxViewsValue, maxUniqueVisitorsValue, burnValue]);

  useEffect(() => { onChange(computeValues()); }, [computeValues, onChange]);

  return (
    <div className="overflow-hidden ds-card">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
        aria-expanded={expanded}
        aria-controls="access-control-body"
      >
        <span>访问控制（可选）</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-subtle transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div id="access-control-body" className="border-t border-border px-5 pb-5">
          <p className="mt-3 text-xs text-subtle">
            默认无限制，展开配置后可设置有效期、访问次数、独立访客数或阅后销毁。
          </p>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm text-muted" htmlFor="ac-expiry">
              有效期（留空 = 无限制）
            </label>
            <input id="ac-expiry" type="datetime-local" value={expiryValue}
              onChange={(e) => setExpiryValue(e.target.value)} className={inputClass} />
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm text-muted" htmlFor="ac-maxviews">
              总打开次数（留空 = 无限制）
            </label>
            <input id="ac-maxviews" type="number" min="1" value={maxViewsValue}
              onChange={(e) => setMaxViewsValue(e.target.value)} placeholder="无限制" className={inputClass} />
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm text-muted" htmlFor="ac-maxvisitors">
              独立访客数（留空 = 无限制）
            </label>
            <input id="ac-maxvisitors" type="number" min="1" value={maxUniqueVisitorsValue}
              onChange={(e) => setMaxUniqueVisitorsValue(e.target.value)} placeholder="无限制" className={inputClass} />
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2" htmlFor="ac-burn">
            <input id="ac-burn" type="checkbox" checked={burnValue}
              onChange={(e) => setBurnValue(e.target.checked)}
              className="h-[18px] w-[18px] accent-brand" />
            <span className="text-sm text-ink">阅后销毁（查看一次后自动失效）</span>
          </label>
        </div>
      )}
    </div>
  );
}

// app/admin/mirrors/_components/CopyLinkButton.tsx
// 复制链接按钮 — 客户端 clipboard。Reach 品牌样式（Tailwind）。

'use client';

import { useState, useRef, useCallback } from 'react';

export function CopyLinkButton({ token, compact }: { token?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    if (!token) return;
    const url = `${window.location.origin}/s/${token}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 忽略 clipboard 错误
    }
  }, [token]);

  if (!token) {
    return <span className="inline-flex items-center text-sm text-subtle">无链接</span>;
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
          copied
            ? 'border-success text-success'
            : 'border-border bg-surface text-muted hover:bg-surface-2 hover:text-ink'
        }`}
        aria-label={copied ? '已复制' : '复制链接'}
        title={copied ? '已复制' : '复制链接'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {copied ? '已复制' : '复制'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`rounded-md border px-4 py-2.5 text-sm transition-colors ${
        copied
          ? 'border-success text-success'
          : 'border-border text-muted hover:text-ink'
      }`}
      aria-label={copied ? '已复制分享链接' : '复制分享链接'}
      title={copied ? '已复制' : '复制链接'}
    >
      {copied ? '已复制' : '复制链接'}
    </button>
  );
}

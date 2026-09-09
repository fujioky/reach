'use client';

// app/_components/article/CodeBlock.tsx
// Code block with a copy button.
//
// No syntax highlighting: a highlighter is the single largest dependency a
// blog renderer tends to pull in, and this site's posts are prose with the
// occasional snippet. Copying is the thing readers actually reach for.

import { useRef, useState } from 'react';

export function CodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = preRef.current?.innerText ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard needs a secure context; the text is selectable either way.
    }
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label="复制代码"
        className="absolute right-2.5 top-2.5 z-10 rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

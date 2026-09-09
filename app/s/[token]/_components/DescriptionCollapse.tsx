'use client';

// app/s/[token]/_components/DescriptionCollapse.tsx — YouTube 描述折叠区
//
// 设计稿方案 B：灰色背景圆角卡，正文截断 3 行 + "展开 ▾"。
// 点击展开显示全文，按钮变为 "收起 ▴"。
// 翻译由全局 PageTranslationShell context 控制，此处无独立 toggle。

import { useState } from 'react';
import { TranslatedBody } from './TranslatedBody';

export function DescriptionCollapse({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ds-card mt-4 bg-surface-2/50 p-4">
      <div className={expanded ? '' : 'line-clamp-3 overflow-hidden'}>
        <TranslatedBody text={text} className="text-[13px] leading-relaxed text-ink" />
      </div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-[13px] font-semibold text-brand transition-colors hover:text-brand-hover"
      >
        {expanded ? '收起 ▴' : '展开 ▾'}
      </button>
    </div>
  );
}

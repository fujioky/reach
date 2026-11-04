'use client';

// app/admin/(shell)/mirrors/_components/RefreshAllXButton.tsx
// Refresh every X mirror, so older ones pick up what newer fetching adds
// (post/article tag, comment images, reply threads, article headings).
// Runs in the browser, three mirrors at a time through the per-mirror
// refresh action, and reports progress; keep the page open until it finishes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listXMirrorIds, refreshMirror } from '../actions';

const CONCURRENCY = 3;

export function RefreshAllXButton() {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const running = state !== null && state.done < state.total;

  async function run() {
    if (!window.confirm('刷新全部 X 镜像？会逐条重新抓取，可能需要十几分钟，期间请保持页面打开。')) return;
    const listed = await listXMirrorIds();
    if (!listed.ok || !listed.ids) {
      window.alert(listed.error ?? '读取镜像列表失败');
      return;
    }
    const ids = listed.ids;
    let next = 0;
    let done = 0;
    let failed = 0;
    setState({ done, total: ids.length, failed });
    async function worker() {
      while (next < ids.length) {
        const id = ids[next++]!;
        const result = await refreshMirror(id).catch(() => ({ ok: false }));
        done += 1;
        if (!result.ok) failed += 1;
        setState({ done, total: ids.length, failed });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={running}
      className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2 disabled:cursor-wait disabled:opacity-80"
    >
      {running && (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {state === null
        ? '刷新全部 X 镜像'
        : running
          ? `刷新中 ${state.done}/${state.total}`
          : `已刷新 ${state.total} 条${state.failed ? `（失败 ${state.failed}）` : ''}`}
    </button>
  );
}

'use client';

// app/admin/(shell)/articles/_components/import-client.ts
// Browser side of the streaming remote import.
//
// The upload paths get byte progress for free — Blob's client SDK and XHR both
// report it, because the bytes leave from here. A remote import has no bytes in
// the browser at all: the server fetches the file and pushes it to storage, and
// all the page can know is what the server tells it. So it tells it, as NDJSON
// over the response body of /api/article-import.

import type { ImportStage } from '@/lib/article/remote-import';

export type ImportPhase = ImportStage['phase'];

export interface ImportProgress {
  phase: ImportPhase;
  /** 0–100. Stays 0 for phases that have no measurable fraction. */
  percent: number;
  received?: number;
  total?: number;
  /** The URL currently being fetched — a resolve chain can walk several. */
  url?: string;
}

export type ImportResult =
  | {
      ok: true;
      url: string;
      mediaId?: string;
      kind: 'image' | 'video';
      size?: number;
      viaAi?: boolean;
      resolvedFrom?: string;
    }
  | { ok: false; error: string; viaAi?: boolean };

/** Human label for each phase, used by the task list. */
export const PHASE_LABELS: Record<ImportPhase, string> = {
  resolving: '解析链接',
  ai: 'AI 解析中',
  downloading: '下载中',
  uploading: '转存中',
  saving: '登记中',
};

/**
 * Run one import, reporting progress as the server reports it.
 *
 * Never throws for an import failure — a failed item is a result, not an
 * exception, because the caller is walking a list and the next item still has
 * to run. A genuine transport failure (offline, aborted) also comes back as
 * `ok: false` for the same reason.
 */
export async function importRemoteWithProgress(
  articleId: string,
  url: string,
  onProgress: (progress: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<ImportResult> {
  let response: Response;
  try {
    response = await fetch('/api/article-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId, url }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: '已取消' };
    return { ok: false, error: `无法连接服务器：${(err as Error).message}` };
  }

  if (!response.ok || !response.body) {
    // Errors before the stream opens come back as plain JSON.
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    return { ok: false, error: detail ?? `服务器返回 HTTP ${response.status}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: ImportResult | null = null;
  let sawAi = false;

  const consume = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text);
    } catch {
      return; // a partial line at the tail of a killed stream
    }

    if (event.type === 'stage') {
      const phase = event.phase as ImportPhase;
      if (phase === 'ai') sawAi = true;
      onProgress({
        phase,
        percent: typeof event.percent === 'number' ? event.percent : 0,
        received: typeof event.received === 'number' ? event.received : undefined,
        total: typeof event.total === 'number' ? event.total : undefined,
        url: typeof event.url === 'string' ? event.url : undefined,
      });
      return;
    }

    if (event.type === 'done') {
      outcome = event.ok
        ? {
            ok: true,
            url: String(event.url ?? ''),
            mediaId: typeof event.mediaId === 'string' ? event.mediaId : undefined,
            kind: event.kind === 'video' ? 'video' : 'image',
            size: typeof event.size === 'number' ? event.size : undefined,
            viaAi: event.viaAi === true,
            resolvedFrom: typeof event.resolvedFrom === 'string' ? event.resolvedFrom : undefined,
          }
        : {
            ok: false,
            error: String(event.error ?? '导入失败'),
            viaAi: event.viaAi === true,
          };
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    consume(buffer);
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: '已取消' };
    return { ok: false, error: `传输中断：${(err as Error).message}` };
  }

  if (outcome) return outcome;

  // The stream ended without a verdict — on Vercel that is what hitting the
  // function's time limit looks like from here.
  return {
    ok: false,
    viaAi: sawAi,
    error: '服务器提前结束了传输（可能超时），大文件建议先下载到本地再上传',
  };
}

/** "1.2 MB" — used in the task list, where exact bytes are noise. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

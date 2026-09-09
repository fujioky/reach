'use client';

// app/admin/(shell)/articles/_components/MediaPicker.tsx
// One panel for every way media gets into an article: drop files, choose files,
// paste remote URLs, or pick something already uploaded.
//
// Previously these were three separate toolbar buttons plus a fourth control on
// the cover field, each with its own bit of upload plumbing. They are the same
// operation with different inputs — pick some media, put it in storage, hand
// back in-app URLs — so they're one component, reused by both the body toolbar
// and the cover field.
//
// The 素材库 tab is the fourth input and the one that isn't an upload at all:
// the asset already exists, so choosing it just writes its URL into the body.
// See MediaLibrary.tsx for why that grid is site-wide.
//
// Everything runs through one queue of tasks, and every task stays on screen
// with its own status. The previous display showed a single "3/8" bar: with a
// batch of pasted links, a failure was one toast that the next failure
// overwrote, so the author ended up with some subset of their links imported
// and no way to tell which. Now each row says what happened to it, failures
// survive the batch, and they can be retried without re-pasting the ones that
// worked.
//
// The caller decides what happens to the results (insert into Markdown, or set
// the cover) and what is allowed (`accept`, `multiple`).

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import {
  PHASE_LABELS,
  formatBytes,
  importRemoteWithProgress,
  type ImportPhase,
} from './import-client';
import { MediaLibrary } from './MediaLibrary';
import { attachPoster, uploadArticleFile, type UploadResult } from './upload-client';

export interface PickedMedia {
  url: string;
  kind: 'image' | 'video';
  /** Caption derived from the filename, without extension. */
  label: string;
}

type TaskStatus = 'pending' | 'running' | 'ok' | 'error';

interface Task {
  id: string;
  /** What the row is called: a filename, or the pasted URL. */
  label: string;
  source: { kind: 'file'; file: File } | { kind: 'url'; url: string };
  status: TaskStatus;
  percent: number;
  /** Which stage a running import is in; uploads only ever transfer. */
  phase?: ImportPhase;
  /** Byte counter or resolution note, shown next to the bar. */
  detail?: string;
  error?: string;
  picked?: PickedMedia;
  /** True when the LLM fallback was what found (or failed to find) the file. */
  viaAi?: boolean;
  /** Set once the result has been handed to onPicked, so a retry can't double-insert. */
  delivered?: boolean;
}

let taskSeq = 0;
const nextTaskId = () => `t${++taskSeq}`;

export function MediaPicker({
  accept = 'all',
  multiple = true,
  showLibrary = true,
  ensureArticleId,
  onPicked,
  onClose,
  onError,
  incomingFiles,
  onIncomingHandled,
}: {
  accept?: 'all' | 'image';
  multiple?: boolean;
  /**
   * Off inside 素材管理, where the surrounding page is already the library —
   * offering a grid of the same assets inside its upload panel is a hall of
   * mirrors, and picking one there wouldn't mean anything.
   */
  showLibrary?: boolean;
  /** Persists a draft if needed and returns its id, or null on failure. */
  ensureArticleId: () => Promise<string | null>;
  onPicked: (items: PickedMedia[]) => void;
  onClose?: () => void;
  onError: (message: string) => void;
  /**
   * Files handed in from outside — dropped or pasted straight into the editor
   * rather than onto this panel. Uploading them here keeps one progress
   * display and one code path no matter where the files came from.
   */
  incomingFiles?: File[] | null;
  onIncomingHandled?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [urls, setUrls] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  /** Bumped after every finished batch so the library picks up what landed. */
  const [libraryKey, setLibraryKey] = useState(0);
  const dragDepth = useRef(0);

  // The queue is driven from an async loop, so the authoritative list lives in
  // a ref — reading it out of state would see whatever snapshot the loop
  // closed over, several tasks ago.
  const tasksRef = useRef<Task[]>([]);
  const runningRef = useRef(false);

  const busy = tasks.some((task) => task.status === 'pending' || task.status === 'running');
  const failed = tasks.filter((task) => task.status === 'error');
  const succeeded = tasks.filter((task) => task.status === 'ok');
  const fileAccept = accept === 'image' ? 'image/*' : 'image/*,video/*';

  const labelOf = (nameOrUrl: string) =>
    (nameOrUrl.split('/').pop() ?? nameOrUrl).split('?')[0].replace(/\.[^.]+$/, '');

  const sync = useCallback(() => setTasks([...tasksRef.current]), []);

  const patch = useCallback(
    (id: string, changes: Partial<Task>) => {
      const index = tasksRef.current.findIndex((task) => task.id === id);
      if (index === -1) return;
      tasksRef.current[index] = { ...tasksRef.current[index], ...changes };
      sync();
    },
    [sync],
  );

  /**
   * Hand every finished-but-undelivered result to the caller.
   *
   * Delivering per batch rather than per item is deliberate: the editor joins
   * them into adjacent Markdown lines, which is what renders as an image grid.
   */
  const deliver = useCallback(() => {
    const ready = tasksRef.current.filter((task) => task.status === 'ok' && !task.delivered);
    if (ready.length === 0) return;
    for (const task of ready) task.delivered = true;
    onPicked(ready.map((task) => task.picked!).filter(Boolean));
  }, [onPicked]);

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const articleId = await ensureArticleId();
      if (!articleId) {
        for (const task of tasksRef.current) {
          if (task.status === 'pending') {
            task.status = 'error';
            task.error = '无法创建草稿，请先保存文章';
          }
        }
        sync();
        return;
      }

      for (;;) {
        const task = tasksRef.current.find((item) => item.status === 'pending');
        if (!task) break;

        patch(task.id, { status: 'running', percent: 0, error: undefined, detail: undefined });

        if (task.source.kind === 'file') {
          const file = task.source.file;
          const result: UploadResult = await uploadArticleFile(articleId, file, (percent) => {
            patch(task.id, { percent, detail: formatBytes(file.size) });
          });
          if (!result.ok) {
            patch(task.id, { status: 'error', error: result.error, percent: 0 });
            continue;
          }
          patch(task.id, {
            status: 'ok',
            percent: 100,
            detail: formatBytes(file.size),
            picked: { url: result.url, kind: result.kind, label: labelOf(file.name) },
          });
          continue;
        }

        const url = task.source.url;
        const result = await importRemoteWithProgress(articleId, url, (progress) => {
          patch(task.id, {
            percent: progress.percent,
            phase: progress.phase,
            detail:
              progress.received && progress.total
                ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                : progress.received
                  ? formatBytes(progress.received)
                  : undefined,
          });
        });

        if (!result.ok) {
          patch(task.id, {
            status: 'error',
            error: result.error,
            viaAi: result.viaAi,
            percent: 0,
            phase: undefined,
          });
          continue;
        }

        // A transferred video has no local file to read a frame from, so
        // capture it from the stored copy instead — the browser
        // range-requests only the head of the file to decode one frame.
        // Detached: a poster is never worth making the author wait.
        if (result.kind === 'video' && result.mediaId) {
          void attachPoster(result.mediaId, result.url);
        }

        patch(task.id, {
          status: 'ok',
          percent: 100,
          phase: undefined,
          viaAi: result.viaAi,
          detail: [
            result.size ? formatBytes(result.size) : '',
            result.viaAi ? 'AI 解析' : '',
          ]
            .filter(Boolean)
            .join(' · '),
          picked: { url: result.url, kind: result.kind, label: labelOf(url) },
        });
      }

      deliver();
      // Whatever landed is now in the library too.
      if (tasksRef.current.some((task) => task.status === 'ok')) {
        setLibraryKey((key) => key + 1);
      }

      // A clean run gets out of the way; anything that failed stays on screen
      // with its reason, because that is the whole point of the list.
      if (tasksRef.current.length > 0 && tasksRef.current.every((task) => task.status === 'ok')) {
        tasksRef.current = [];
        sync();
        setUrls('');
        onClose?.();
      }
    } finally {
      runningRef.current = false;
    }
  }, [ensureArticleId, patch, sync, deliver, onClose]);

  const enqueue = useCallback(
    (incoming: Task[]) => {
      if (incoming.length === 0) return;
      // A single-slot picker (the cover field) keeps only the newest choice.
      tasksRef.current = multiple ? [...tasksRef.current, ...incoming] : incoming;
      sync();
      void runQueue();
    },
    [multiple, sync, runQueue],
  );

  // ── local files ──
  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((file) =>
        accept === 'image'
          ? file.type.startsWith('image/')
          : file.type.startsWith('image/') || file.type.startsWith('video/'),
      );
      if (files.length === 0) {
        onError(accept === 'image' ? '请选择图片文件' : '只支持图片和视频文件');
        return;
      }
      // Files can arrive while the library tab is open — dropped on the panel,
      // or pasted into the editor. Show the queue they just joined.
      setTab('upload');
      enqueue(
        (multiple ? files : files.slice(0, 1)).map((file) => ({
          id: nextTaskId(),
          label: file.name,
          source: { kind: 'file' as const, file },
          status: 'pending' as const,
          percent: 0,
        })),
      );
    },
    [accept, multiple, onError, enqueue],
  );

  // ── remote URLs ──
  const handleUrls = useCallback(() => {
    const list = urls
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (list.length === 0) return;

    enqueue(
      (multiple ? list : list.slice(0, 1)).map((url) => ({
        id: nextTaskId(),
        label: url,
        source: { kind: 'url' as const, url },
        status: 'pending' as const,
        percent: 0,
      })),
    );
    setUrls('');
  }, [urls, multiple, enqueue]);

  const retry = useCallback(
    (ids: string[]) => {
      for (const task of tasksRef.current) {
        if (ids.includes(task.id)) {
          task.status = 'pending';
          task.error = undefined;
          task.percent = 0;
          task.detail = undefined;
        }
      }
      sync();
      void runQueue();
    },
    [sync, runQueue],
  );

  const clearFinished = useCallback(() => {
    tasksRef.current = tasksRef.current.filter(
      (task) => task.status === 'pending' || task.status === 'running',
    );
    sync();
  }, [sync]);

  /** Library picks are already in storage — nothing to queue, just hand them over. */
  const pickFromLibrary = useCallback(
    (items: PickedMedia[]) => {
      if (items.length === 0) return;
      onPicked(items);
      onClose?.();
    },
    [onPicked, onClose],
  );

  const copyFailed = useCallback(() => {
    const text = failed
      .filter((task) => task.source.kind === 'url')
      .map((task) => (task.source.kind === 'url' ? task.source.url : ''))
      .join('\n');
    if (!text) return;
    void navigator.clipboard?.writeText(text);
  }, [failed]);

  useEffect(() => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    handleFiles(incomingFiles);
    onIncomingHandled?.();
    // handleFiles is stable per-render inputs; re-running on identity changes
    // would re-upload the same batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles]);

  // ── drag & drop ──
  // Depth counting: dragenter/dragleave fire for every child element, so a
  // single counter is what keeps the highlight from flickering as the pointer
  // moves across the panel's contents.
  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-lg border border-dashed p-3 transition-colors ${
        dragging ? 'border-brand bg-tint/60' : 'border-border bg-surface-2/40'
      }`}
    >
      {/* Tabs — only when there is a second place to pick from */}
      {showLibrary && (
        <div className="mb-2 flex items-center gap-1 border-b border-border/70 pb-2">
          {(
            [
              { key: 'upload' as const, label: '上传 / 转存' },
              { key: 'library' as const, label: '素材库' },
            ]
          ).map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`rounded-sm px-2.5 py-1 text-[12px] transition-colors ${
                tab === entry.key
                  ? 'bg-tint font-medium text-brand'
                  : 'text-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {entry.label}
            </button>
          ))}
          {onClose && tab === 'library' && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              title={busy ? '还有任务在进行中' : undefined}
              className="ml-auto rounded-sm px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              收起
            </button>
          )}
        </div>
      )}

      {showLibrary && tab === 'library' ? (
        <MediaLibrary
          accept={accept}
          multiple={multiple}
          onPick={pickFromLibrary}
          reloadKey={libraryKey}
        />
      ) : (
        <>
      {/* Drop zone / file picker */}
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md py-5 text-center transition-colors ${
          dragging ? 'text-brand' : 'text-muted hover:text-ink'
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span className="text-[13px] font-medium">
          {dragging ? '松手即可上传' : '拖拽文件到此处，或点击选择'}
        </span>
        <span className="text-[11px] text-subtle">
          {accept === 'image'
            ? '图片，最大 20MB'
            : `图片最大 20MB · 视频最大 500MB${multiple ? ' · 可多选' : ''}`}
        </span>
        <input
          type="file"
          accept={fileAccept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {/* Remote URLs */}
      <div className="mt-1 border-t border-border/70 pt-3">
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={multiple ? 2 : 1}
          spellCheck={false}
          placeholder={
            multiple
              ? '或粘贴远程链接，每行一个：https://example.com/photo.jpg'
              : '或粘贴远程图片链接'
          }
          className="ds-input resize-y font-mono text-[11.5px]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] leading-relaxed text-subtle">
            远程文件会下载并转存到本站存储，正文引用本站地址。
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                // Collapsing unmounts the queue: anything still in flight would
                // finish into a component that no longer exists, and its result
                // would never reach the body.
                disabled={busy}
                title={busy ? '还有任务在进行中' : undefined}
                className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                收起
              </button>
            )}
            <button
              type="button"
              onClick={handleUrls}
              disabled={!urls.trim()}
              className="ds-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy ? '加入队列' : '转存并插入'}
            </button>
          </div>
        </div>
      </div>
        </>
      )}

      {/* Task list — outside the tabs, so switching to the library doesn't
          hide an upload that is still running. */}
      {tasks.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border bg-surface">
          <ul className="divide-y divide-border/70">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onRetry={() => retry([task.id])} />
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/50 px-3 py-2">
            <span className="text-[11px] tabular-nums text-subtle">
              {busy && `进行中 ${tasks.filter((t) => t.status === 'running').length} · 待处理 ${tasks.filter((t) => t.status === 'pending').length} · `}
              成功 {succeeded.length} · 失败 {failed.length}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {failed.some((task) => task.source.kind === 'url') && (
                <button
                  type="button"
                  onClick={copyFailed}
                  className="rounded-sm px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
                >
                  复制失败链接
                </button>
              )}
              {failed.length > 0 && !busy && (
                <button
                  type="button"
                  onClick={() => retry(failed.map((task) => task.id))}
                  className="rounded-sm px-2 py-1 text-[11px] font-medium text-brand transition-colors hover:bg-tint"
                >
                  重试失败项（{failed.length}）
                </button>
              )}
              {!busy && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className="rounded-sm px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
                >
                  清空
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One queue entry: what it is, where it got to, and why it stopped. */
function TaskRow({ task, onRetry }: { task: Task; onRetry: () => void }) {
  const statusText =
    task.status === 'ok'
      ? '已完成'
      : task.status === 'error'
        ? '失败'
        : task.status === 'pending'
          ? '等待中'
          : task.phase
            ? PHASE_LABELS[task.phase]
            : '上传中';

  // Resolving and AI stages have no measurable fraction, so the bar animates
  // instead of claiming a percentage it doesn't have.
  const indeterminate =
    task.status === 'running' && (task.phase === 'resolving' || task.phase === 'ai');

  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={task.status} />
          <span className="truncate text-[12px] text-ink" title={task.label}>
            {task.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          {task.detail && <span className="text-subtle">{task.detail}</span>}
          <span
            className={
              task.status === 'error'
                ? 'text-danger'
                : task.status === 'ok'
                  ? 'text-success'
                  : 'text-muted'
            }
          >
            {statusText}
          </span>
          {task.status === 'running' && !indeterminate && (
            <span className="w-9 text-right font-mono text-muted">{task.percent}%</span>
          )}
        </div>
      </div>

      {task.status === 'running' && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-surface-2">
          <div
            className={`h-full rounded-pill bg-brand ${
              indeterminate ? 'w-1/3 animate-pulse' : 'transition-all'
            }`}
            style={indeterminate ? undefined : { width: `${task.percent}%` }}
          />
        </div>
      )}

      {task.status === 'error' && (
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-danger">{task.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-brand transition-colors hover:bg-tint"
          >
            重试
          </button>
        </div>
      )}
    </li>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'ok') {
    return (
      <svg className="shrink-0 text-success" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <svg className="shrink-0 text-danger" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  if (status === 'running') {
    return (
      <svg className="shrink-0 animate-spin text-brand" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.2-8.6" />
      </svg>
    );
  }
  return (
    <svg className="shrink-0 text-subtle" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

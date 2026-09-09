'use client';

// app/admin/(shell)/articles/_components/AssetManager.tsx
// Asset inventory for article images and videos.
//
// The column that matters is 引用 — which articles actually reference an asset.
// It's derived by scanning article text, not by a join table, because the
// author edits Markdown freely: they delete an image, paste its URL into a
// second post, or move it between articles, and none of that passes through an
// API we could hook. Anything unreferenced is dead weight, and this is where it
// gets reclaimed.

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { cleanupUnreferencedAssets, deleteAssets, setAssetShared } from '../actions';
import { formatBytes, type ArticleAsset } from '@/lib/article/assets';
import { responsiveImage } from '@/lib/article/image-srcset';
import { MediaPicker } from './MediaPicker';

export interface ArticleOption {
  id: string;
  title: string;
  status: 'draft' | 'published';
}

type Filter = 'all' | 'unused' | 'shared' | 'image' | 'video';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unused', label: '未引用' },
  { key: 'shared', label: '已公开' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
];

function formatDate(date: Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AssetManager({
  articles,
  assets,
  totalBytes,
  sweepableCount,
  sweepableBytes,
  siteOrigin,
}: {
  /** Upload targets — an asset row is foreign-keyed to an article. */
  articles: ArticleOption[];
  assets: ArticleAsset[];
  totalBytes: number;
  sweepableCount: number;
  sweepableBytes: number;
  /** Empty in dev — the browser's own origin is used then. */
  siteOrigin: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(articles[0]?.id ?? '');
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);

  const visible = useMemo(() => {
    switch (filter) {
      case 'unused':
        return assets.filter((a) => a.referencedBy.length === 0);
      case 'shared':
        return assets.filter((a) => a.shared);
      case 'image':
        return assets.filter((a) => a.type === 'image');
      case 'video':
        return assets.filter((a) => a.type === 'video');
      default:
        return assets;
    }
  }, [assets, filter]);

  const absoluteUrl = (path: string) =>
    siteOrigin
      ? `${siteOrigin}${path}`
      : typeof window !== 'undefined'
        ? `${window.location.origin}${path}`
        : path;

  const copyLink = async (asset: ArticleAsset) => {
    // Only a shared asset has a URL that works for someone else. An unshared
    // one is reachable solely through the signed link the article page mints,
    // so copying it would hand out something that 404s.
    if (!asset.shared) {
      setMessage({
        kind: 'error',
        text: '这个素材未公开分享，链接只在文章页内有效。先点「公开分享」再复制。',
      });
      return;
    }
    const url = absoluteUrl(asset.url);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId((current) => (current === asset.id ? null : current)), 2000);
    } catch {
      // Clipboard needs a secure context; show the URL so it can be copied by hand.
      setMessage({ kind: 'error', text: `无法访问剪贴板，链接：${url}` });
    }
  };

  const toggleShare = (asset: ArticleAsset) => {
    startTransition(async () => {
      const result = await setAssetShared({ mediaId: asset.id, shared: !asset.shared });
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? '设置失败' });
      else {
        setMessage({
          kind: 'ok',
          text: asset.shared ? '已取消公开分享' : '已开启公开分享，链接现在任何人都能访问',
        });
        router.refresh();
      }
    });
  };

  const removeOne = (asset: ArticleAsset) => {
    const inUse = asset.referencedBy.length > 0;
    const prompt = inUse
      ? `这个素材正被 ${asset.referencedBy.length} 篇文章引用，删除后那些文章里会变成坏图。确定删除？`
      : '删除后无法恢复，确定删除这个素材？';
    if (!confirm(prompt)) return;

    startTransition(async () => {
      // requireUnreferenced=false: the admin can see it's in use and said yes.
      const result = await deleteAssets({ mediaIds: [asset.id], requireUnreferenced: false });
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? '删除失败' });
      else {
        setMessage({
          kind: 'ok',
          text: `已删除，释放 ${formatBytes(result.bytes ?? 0)}${(result.warnings ?? []).join('；')}`,
        });
        router.refresh();
      }
    });
  };

  // ── selection ──
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleIds = visible.map((a) => a.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  // ── batch download ──
  //
  // One request per file, driven from the browser, rather than a server-side
  // zip. Zipping would mean streaming every selected video through a function
  // and holding the archive somewhere — for files that are already a few
  // hundred megabytes each, that is the slow and fragile option. Downloading
  // them individually costs the user one permission prompt and nothing else.
  const downloadSelected = useCallback(async () => {
    const targets = assets.filter((a) => selected.has(a.id));
    if (targets.length === 0) return;

    setDownloading({ done: 0, total: targets.length });
    for (const [index, asset] of targets.entries()) {
      const anchor = document.createElement('a');
      anchor.href = absoluteUrl(asset.url);
      anchor.download = asset.filename ?? `${asset.id}`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setDownloading({ done: index + 1, total: targets.length });
      // Fire them slightly apart: browsers drop downloads triggered in a tight
      // loop, and Chrome shows a single "allow multiple downloads" prompt.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setDownloading(null);
    setMessage({ kind: 'ok', text: `已开始下载 ${targets.length} 个文件` });
  }, [assets, selected, siteOrigin]);

  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`删除选中的 ${ids.length} 个素材？删除后无法恢复，正在被引用的也会一并删除。`)) return;
    startTransition(async () => {
      const result = await deleteAssets({ mediaIds: ids, requireUnreferenced: false });
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? '删除失败' });
      else {
        setSelected(new Set());
        setMessage({
          kind: 'ok',
          text: `已删除 ${result.count} 个素材，释放 ${formatBytes(result.bytes ?? 0)}`,
        });
        router.refresh();
      }
    });
  };

  const sweep = () => {
    if (
      !confirm(
        `将删除 ${sweepableCount} 个未被任何文章引用的素材，释放约 ${formatBytes(sweepableBytes)}。\n` +
          '24 小时内上传的素材不在此列（可能正在编辑中）。\n\n删除后无法恢复，确定继续？',
      )
    )
      return;

    startTransition(async () => {
      const result = await cleanupUnreferencedAssets();
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? '清理失败' });
      else {
        const warnings = (result.warnings ?? []).join('；');
        setMessage({
          kind: 'ok',
          text:
            result.count === 0
              ? warnings || '没有可清理的素材'
              : `已清理 ${result.count} 个素材，释放 ${formatBytes(result.bytes ?? 0)}${warnings ? `（${warnings}）` : ''}`,
        });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── 统计条 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="素材总数" value={String(assets.length)} />
        <Stat label="占用空间" value={formatBytes(totalBytes)} />
        <Stat
          label="未引用"
          value={String(assets.filter((a) => a.referencedBy.length === 0).length)}
          tone={assets.some((a) => a.referencedBy.length === 0) ? 'warn' : 'normal'}
        />
        <Stat
          label="可清理"
          value={sweepableCount > 0 ? `${sweepableCount} · ${formatBytes(sweepableBytes)}` : '0'}
          tone={sweepableCount > 0 ? 'warn' : 'normal'}
        />
      </div>

      {message && (
        <div
          className={`rounded-md border px-4 py-2.5 text-sm ${
            message.kind === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── 上传 ── */}
      {showUpload && (
        <div className="ds-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted">上传到文章</label>
            <select
              value={uploadTarget}
              onChange={(e) => setUploadTarget(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand"
            >
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.title}
                  {article.status === 'draft' ? '（草稿）' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
            素材必须归属于某篇文章。这里上传的不会自动插入正文——上传后复制它的链接，
            或直接在文章编辑器里插入。
          </p>

          <div className="mt-3">
            {articles.length === 0 ? (
              <p className="text-[13px] text-muted">还没有文章，请先创建一篇再上传素材。</p>
            ) : (
              <MediaPicker
                // This page already is the library — a grid of the same assets
                // inside its own upload panel would pick into nothing.
                showLibrary={false}
                ensureArticleId={async () => uploadTarget || null}
                onPicked={(items) => {
                  setMessage({ kind: 'ok', text: `已上传 ${items.length} 个素材` });
                  router.refresh();
                }}
                onClose={() => setShowUpload(false)}
                onError={(text) => setMessage({ kind: 'error', text })}
              />
            )}
          </div>
        </div>
      )}

      {/* ── 批量操作 ── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-tint/50 px-4 py-2.5">
          <span className="text-[13px] font-medium text-ink">
            已选 {selected.size} 项
            <span className="ml-2 font-normal text-muted">
              {formatBytes(
                assets.filter((a) => selected.has(a.id)).reduce((sum, a) => sum + a.size, 0),
              )}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void downloadSelected()}
              disabled={downloading !== null}
              className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {downloading ? `下载中 ${downloading.done}/${downloading.total}` : '下载选中'}
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={pending || downloading !== null}
              className="rounded-sm border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              删除选中
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      {/* ── 筛选 + 清理 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-xs px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === item.key ? 'bg-brand text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowUpload((open) => !open)}
          className={`rounded-sm border px-3.5 py-2 text-xs font-medium transition-colors ${
            showUpload
              ? 'border-brand bg-tint text-brand'
              : 'border-border bg-surface text-ink hover:bg-surface-2'
          }`}
        >
          上传素材
        </button>

        <button
          type="button"
          onClick={sweep}
          disabled={pending || sweepableCount === 0}
          title={
            sweepableCount === 0
              ? '没有可清理的素材（24 小时内上传的不参与清理）'
              : undefined
          }
          className="rounded-sm border border-danger/30 px-3.5 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? '处理中…' : `一键清理未引用素材${sweepableCount > 0 ? `（${sweepableCount}）` : ''}`}
        </button>
        </div>
      </div>

      {/* ── 列表 ── */}
      {visible.length === 0 ? (
        <div className="ds-card p-10 text-center text-sm text-muted">
          {assets.length === 0 ? '还没有上传过素材。' : '当前筛选下没有素材。'}
        </div>
      ) : (
        <div className="ds-card">
          <label className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-brand"
            />
            全选当前筛选（{visible.length} 项）
          </label>

          <div className="divide-y divide-border">
          {visible.map((asset) => (
            <div key={asset.id} className="flex items-start gap-3 p-4">
              <input
                type="checkbox"
                checked={selected.has(asset.id)}
                onChange={() => toggleOne(asset.id)}
                aria-label={`选择 ${asset.filename ?? asset.id}`}
                className="mt-6 h-4 w-4 shrink-0 accent-brand"
              />

              {/* 缩略图 */}
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-border">
                {asset.type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    {...responsiveImage(asset.url, '96px')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : asset.hasPoster ? (
                  // A frame captured at upload time — a plain image, so it costs
                  // one small request instead of pulling video bytes.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${asset.url}?poster=1`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full bg-black object-cover"
                  />
                ) : (
                  // No captured frame (imported from a URL, or uploaded before
                  // posters existed): let the browser decode one itself. It
                  // range-requests just the head of the file to do so.
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={asset.url}
                    preload="metadata"
                    muted
                    playsInline
                    className="h-full w-full bg-black object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {asset.filename || `${asset.type === 'video' ? '视频' : '图片'}素材`}
                  </span>
                  {asset.shared && (
                    <span className="shrink-0 rounded-pill bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                      已公开
                    </span>
                  )}
                  {asset.referencedBy.length === 0 && (
                    <span
                      className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                        asset.withinGracePeriod
                          ? 'bg-surface-2 text-muted'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {asset.withinGracePeriod ? '未引用 · 新上传' : '未引用'}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                  <span>{formatBytes(asset.size)}</span>
                  <span>{asset.contentType || asset.type}</span>
                  <span>{formatDate(asset.createdAt)}</span>
                </div>

                <div className="mt-1.5 text-xs text-muted">
                  {asset.referencedBy.length > 0 ? (
                    <span>
                      引用于{' '}
                      {asset.referencedBy.map((article, index) => (
                        <span key={article.id}>
                          {index > 0 && '、'}
                          <Link
                            href={`/admin/articles/${article.id}`}
                            className="text-brand hover:underline"
                          >
                            {article.title}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>
                      上传于{' '}
                      <Link
                        href={`/admin/articles/${asset.ownerArticleId}`}
                        className="text-brand hover:underline"
                      >
                        {asset.ownerArticleTitle}
                      </Link>
                      ，但正文中已无引用
                    </span>
                  )}
                </div>

                <div className="mt-2 truncate font-mono text-[11px] text-subtle">{asset.url}</div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyLink(asset)}
                    title={asset.shared ? undefined : '未公开的素材链接只在文章页内有效'}
                    className={`rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 ${
                      asset.shared ? 'text-ink' : 'text-subtle'
                    }`}
                  >
                    {copiedId === asset.id ? '已复制' : '复制链接'}
                  </button>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    打开
                  </a>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggleShare(asset)}
                    className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    {asset.shared ? '取消公开' : '公开分享'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeOne(asset)}
                    className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-danger disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-subtle">
        未公开的素材只能通过文章页面访问——页面渲染时会给它的地址附上一个几小时有效的签名，
        直接打开裸链接会 404。点「公开分享」后链接才对任何人长期有效，也才能复制出去。
        （管理员已登录，「打开」「下载」在任何时候都能用。）
        <br />
        批量下载是逐个触发的，浏览器会问一次「允许下载多个文件」——服务端打包 zip 意味着几百 MB
        的视频要整个流经函数再存一份，对这个体量不划算。
        <br />
        「引用」按文章正文与封面中出现的素材链接统计，草稿里的引用同样算数。
        一键清理只处理无人引用、且上传超过 24 小时的素材——刚拖进编辑器还没保存的内容不会被误删，
        需要立即删除可用单条「删除」。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <div className="ds-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 font-display text-lg font-bold ${
          tone === 'warn' ? 'text-warning' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

'use client';

// app/admin/(shell)/articles/_components/MediaLibrary.tsx
// The picker's library tab: everything already uploaded, as a grid to choose from.
//
// Until now the only way to put media in an article was to upload it again.
// That is fine the first time and wrong every time after: an image uploaded
// into a draft last month, or one whose article was rewritten and dropped the
// reference, was stranded — visible in 素材管理 as dead weight, reachable from
// nowhere. Re-uploading it made a second copy with a second URL, and the
// original stayed unreferenced until the sweep deleted it.
//
// So the grid is site-wide, not scoped to the open article, and 「未引用」 is a
// first-class filter — the stranded ones are precisely what this is for.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { listMediaLibrary, type MediaLibraryItem } from '../actions';
import { responsiveImage } from '@/lib/article/image-srcset';
import { formatBytes } from '@/lib/article/assets';

type LibraryFilter = 'all' | 'unused' | 'image' | 'video';

const FILTERS: Array<{ key: LibraryFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unused', label: '未引用' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
];

/** How many are shown before the grid asks to be told to show more. */
const PAGE_SIZE = 36;

export function MediaLibrary({
  accept,
  multiple,
  onPick,
  /** Bumped by the parent after an upload, to pull the new items in. */
  reloadKey = 0,
}: {
  accept: 'all' | 'image';
  multiple: boolean;
  onPick: (items: Array<{ url: string; kind: 'image' | 'video'; label: string }>) => void;
  reloadKey?: number;
}) {
  const [items, setItems] = useState<MediaLibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listMediaLibrary();
    if (result.ok && result.items) {
      setItems(result.items);
      setTruncated(result.truncated === true);
    } else {
      setError(result.error ?? '读取素材库失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const visible = useMemo(() => {
    if (!items) return [];
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      // A cover field can only take an image; showing videos it would refuse is
      // just an invitation to click one.
      if (accept === 'image' && item.type !== 'image') return false;
      if (filter === 'unused' && item.referenced) return false;
      if (filter === 'image' && item.type !== 'image') return false;
      if (filter === 'video' && item.type !== 'video') return false;
      if (!query) return true;
      return (
        (item.filename ?? '').toLowerCase().includes(query) ||
        item.ownerArticleTitle.toLowerCase().includes(query)
      );
    });
  }, [items, accept, filter, search]);

  const page = visible.slice(0, shown);

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      return multiple ? [...current, id] : [id];
    });
  };

  const insert = () => {
    if (!items || selected.length === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    // Insertion order follows the order they were clicked, not grid order —
    // for a batch that becomes an image grid in the body, that is the one the
    // author was actually thinking about.
    const picked = selected
      .map((id) => byId.get(id))
      .filter((item): item is MediaLibraryItem => Boolean(item))
      .map((item) => ({
        url: item.url,
        kind: item.type,
        label: (item.filename ?? '').replace(/\.[^.]+$/, '') || '素材',
      }));
    setSelected([]);
    onPick(picked);
  };

  return (
    <div className="mt-1 border-t border-border/70 pt-3">
      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(PAGE_SIZE);
          }}
          placeholder="搜索文件名或所属文章"
          className="ds-input h-8 flex-1 min-w-[140px] text-[12px]"
        />
        <div className="flex shrink-0 items-center gap-1">
          {FILTERS.filter((entry) => !(accept === 'image' && entry.key === 'video')).map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setFilter(entry.key);
                setShown(PAGE_SIZE);
              }}
              className={`rounded-sm px-2 py-1 text-[11px] transition-colors ${
                filter === entry.key
                  ? 'bg-tint font-medium text-brand'
                  : 'text-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="刷新素材库"
            aria-label="刷新素材库"
            className="rounded-sm px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={loading ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-2.6-6.4" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="mt-3">
        {error ? (
          <p className="py-8 text-center text-[12px] text-danger">{error}</p>
        ) : items === null ? (
          <p className="py-8 text-center text-[12px] text-subtle">正在读取素材库…</p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-subtle">
            {items.length === 0
              ? '还没有上传过素材。'
              : '没有符合条件的素材。'}
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {page.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  selected={selected.includes(item.id)}
                  order={multiple ? selected.indexOf(item.id) + 1 : 0}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </ul>

            {visible.length > shown && (
              <button
                type="button"
                onClick={() => setShown((current) => current + PAGE_SIZE)}
                className="mt-2.5 w-full rounded-md border border-border py-1.5 text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                显示更多（还有 {visible.length - shown} 个）
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-subtle">
          {items && `共 ${visible.length} 个素材`}
          {truncated && '（仅显示最近 500 个）'}
          {selected.length > 0 && ` · 已选 ${selected.length}`}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink"
            >
              取消选择
            </button>
          )}
          <button
            type="button"
            onClick={insert}
            disabled={selected.length === 0}
            className="ds-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {multiple && selected.length > 1 ? `插入选中（${selected.length}）` : '插入选中'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One thumbnail. Videos show their captured frame rather than pulling bytes. */
function LibraryTile({
  item,
  selected,
  order,
  onToggle,
}: {
  item: MediaLibraryItem;
  selected: boolean;
  /** 1-based click position, shown when a batch is being assembled. */
  order: number;
  onToggle: () => void;
}) {
  const caption = item.filename || (item.type === 'video' ? '视频素材' : '图片素材');

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        title={`${caption}\n${item.ownerArticleTitle} · ${formatBytes(item.size)}`}
        className={`group relative block aspect-square w-full overflow-hidden rounded-md ring-1 transition-all ${
          selected ? 'ring-2 ring-brand' : 'ring-border hover:ring-brand/50'
        }`}
      >
        {item.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            {...responsiveImage(item.url, '160px')}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full bg-surface-2 object-cover"
          />
        ) : item.hasPoster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${item.url}?poster=1`}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full bg-black object-cover"
          />
        ) : (
          // No captured frame (imported from a URL, or uploaded before posters
          // existed): the browser decodes one itself, range-requesting only the
          // head of the file.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={item.url}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full bg-black object-cover"
          />
        )}

        {/* Video marker */}
        {item.type === 'video' && (
          <span className="pointer-events-none absolute left-1 top-1 rounded-xs bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
            视频
          </span>
        )}

        {/* Unreferenced marker — the reason most of these are worth finding. */}
        {!item.referenced && (
          // A tinted background like 素材管理 uses would sit on an arbitrary
          // photo here, so the badge carries its own dark plate.
          <span className="pointer-events-none absolute right-1 top-1 rounded-xs bg-black/65 px-1 py-0.5 text-[9px] font-medium text-warning">
            未引用
          </span>
        )}

        {selected && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand/25">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white tabular-nums">
              {order > 0 ? (
                order
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
          </span>
        )}

        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] text-white">
          {caption}
        </span>
      </button>
    </li>
  );
}

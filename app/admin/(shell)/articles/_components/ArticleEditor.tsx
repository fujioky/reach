'use client';

// app/admin/(shell)/articles/_components/ArticleEditor.tsx
// Markdown editor for self-authored articles.
//
// A textarea plus a live preview, not a WYSIWYG: the body is stored as
// Markdown, and a rich-text surface would have to round-trip through it on
// every keystroke — which is where such editors usually start mangling content.
// The preview uses the very same ArticleBody component the public page renders
// with, so what the preview shows is what visitors get.
//
// Uploads need an article id (media rows are foreign-keyed to it), so a brand
// new post is saved as a draft the moment the first file arrives. That's what
// ensureArticleId() does — the author never has to "save first" to paste an
// image.

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { ArticleBody } from '@/app/_components/article/ArticleBody';
import { generateRandomSlug } from '@/lib/article/slug';
import { saveArticle } from '../actions';
import { MediaPicker, type PickedMedia } from './MediaPicker';
import { PasswordSetting } from './PasswordSetting';
import type { PasswordMode } from '@/lib/content/password';

export interface ArticleDraft {
  id: string | null;
  title: string;
  body: string;
  excerpt: string;
  slug: string;
  coverImageUrl: string;
  authorName: string;
  status: 'draft' | 'published';
  commentsEnabled: boolean;
  listed: boolean;
  passwordMode: PasswordMode;
  hasStoredPassword: boolean;
  coverStyle: 'above' | 'hero';
}

type ViewMode = 'write' | 'split' | 'preview';

/** Toolbar actions expressed as a text transform around the selection. */
const TOOLBAR: Array<{
  label: string;
  title: string;
  before: string;
  after: string;
  placeholder: string;
  /** Block-level actions apply at the start of the line. */
  block?: boolean;
}> = [
  { label: 'B', title: '粗体', before: '**', after: '**', placeholder: '粗体' },
  { label: 'I', title: '斜体', before: '*', after: '*', placeholder: '斜体' },
  { label: 'H2', title: '二级标题', before: '## ', after: '', placeholder: '标题', block: true },
  { label: 'H3', title: '三级标题', before: '### ', after: '', placeholder: '标题', block: true },
  { label: '链接', title: '链接', before: '[', after: '](https://)', placeholder: '链接文字' },
  { label: '引用', title: '引用', before: '> ', after: '', placeholder: '引用内容', block: true },
  { label: '列表', title: '无序列表', before: '- ', after: '', placeholder: '列表项', block: true },
  { label: '代码', title: '代码块', before: '```\n', after: '\n```', placeholder: '代码' },
  { label: '分隔', title: '分隔线', before: '\n---\n', after: '', placeholder: '' },
];

export function ArticleEditor({
  initial,
  sitePasswordConfigured,
}: {
  initial: ArticleDraft;
  sitePasswordConfigured: boolean;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [articleId, setArticleId] = useState(initial.id);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [slug, setSlug] = useState(initial.slug);
  const [coverImageUrl, setCoverImageUrl] = useState(initial.coverImageUrl);
  const [authorName, setAuthorName] = useState(initial.authorName);
  const [commentsEnabled, setCommentsEnabled] = useState(initial.commentsEnabled);
  const [listed, setListed] = useState(initial.listed);
  const [passwordMode, setPasswordMode] = useState<PasswordMode>(initial.passwordMode);
  const [password, setPassword] = useState('');
  const [coverStyle, setCoverStyle] = useState<'above' | 'hero'>(initial.coverStyle);
  const [status, setStatus] = useState<'draft' | 'published'>(initial.status);

  const [view, setView] = useState<ViewMode>('split');
  const [showBodyPicker, setShowBodyPicker] = useState(false);
  /** Files dropped or pasted into the editor, forwarded to the media panel. */
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // ── saving ─────────────────────────────────────────────────────────

  const persist = useCallback(
    async (nextStatus: 'draft' | 'published') => {
      if (!title.trim()) {
        setMessage({ kind: 'error', text: '请先填写标题' });
        return null;
      }
      const result = await saveArticle({
        id: articleId ?? undefined,
        title,
        body,
        excerpt,
        slug,
        coverImageUrl,
        authorName,
        status: nextStatus,
        commentsEnabled,
        listed,
        passwordMode,
        password,
        coverStyle,
      });
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error ?? '保存失败' });
        return null;
      }
      setArticleId(result.id!);
      setSlug(result.slug!);
      setStatus(nextStatus);
      return result.id!;
    },
    [
      articleId,
      title,
      body,
      excerpt,
      slug,
      coverImageUrl,
      authorName,
      commentsEnabled,
      listed,
      passwordMode,
      password,
      coverStyle,
    ],
  );

  const handleSave = (nextStatus: 'draft' | 'published') => {
    startTransition(async () => {
      const isNew = !articleId;
      const id = await persist(nextStatus);
      if (!id) return;
      setMessage({
        kind: 'ok',
        text: nextStatus === 'published' ? '已发布' : '草稿已保存',
      });
      // A new post lives at /articles/new until it has an id; move to its own
      // URL so a refresh doesn't create a second copy.
      if (isNew) router.replace(`/admin/articles/${id}`);
      else router.refresh();
    });
  };

  /** Uploads need a persisted article — save a draft on demand. */
  const ensureArticleId = useCallback(async (): Promise<string | null> => {
    if (articleId) return articleId;
    const id = await persist('draft');
    if (id) router.replace(`/admin/articles/${id}`);
    return id;
  }, [articleId, persist, router]);

  // ── text insertion ─────────────────────────────────────────────────

  const insertAtCursor = useCallback(
    (before: string, after = '', placeholder = '') => {
      const textarea = textareaRef.current;
      if (!textarea) {
        setBody((current) => `${current}${before}${placeholder}${after}`);
        return;
      }
      const { selectionStart, selectionEnd, value } = textarea;
      const selected = value.slice(selectionStart, selectionEnd) || placeholder;
      const next = `${value.slice(0, selectionStart)}${before}${selected}${after}${value.slice(selectionEnd)}`;
      setBody(next);

      // Restore focus with the inserted text selected, so typing replaces the
      // placeholder — the behaviour every Markdown editor has trained for.
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(
          selectionStart + before.length,
          selectionStart + before.length + selected.length,
        );
      });
    },
    [],
  );

  // ── media ─────────────────────────────────────────────────────────

  /**
   * Insert picked media into the body.
   *
   * Several items go in as one paragraph (single newlines) so the reader
   * renders them as an image grid; a blank line between them would split the
   * paragraph into separate figures.
   */
  /** Hand files from a drop or paste to the panel, opening it if needed. */
  const acceptFiles = useCallback((files: File[]) => {
    const media = files.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
    );
    if (media.length === 0) return;
    setShowBodyPicker(true);
    setDroppedFiles(media);
  }, []);

  const insertPicked = useCallback(
    (items: PickedMedia[]) => {
      const markdown = items.map((item) => `![${item.label}](${item.url})`).join('\n');
      insertAtCursor(`\n${markdown}\n`, '', '');
      setMessage({
        kind: 'ok',
        text:
          items.length > 1
            ? `已插入 ${items.length} 个素材（同段落将显示为图组）`
            : '素材已插入',
      });
    },
    [insertAtCursor],
  );

  const publicUrl = slug ? `/p/${slug}` : null;
  const busy = pending;

  return (
    <div className="flex flex-col gap-5">
      {/* ── 顶部操作条 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${
              status === 'published'
                ? 'bg-success/12 text-success'
                : 'bg-surface-2 text-muted'
            }`}
          >
            {status === 'published' ? '已发布' : '草稿'}
          </span>
          {publicUrl && status === 'published' && (
            <Link
              href={publicUrl}
              target="_blank"
              className="text-[13px] text-brand hover:underline"
            >
              查看公开页 ↗
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="mr-1 flex rounded-md border border-border bg-surface p-0.5">
            {(['write', 'split', 'preview'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`rounded-xs px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === mode ? 'bg-brand text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {mode === 'write' ? '编辑' : mode === 'split' ? '分栏' : '预览'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => handleSave('draft')}
            disabled={busy}
            className="rounded-sm border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={() => handleSave('published')}
            disabled={busy}
            className="ds-btn-primary text-sm disabled:opacity-50"
          >
            {status === 'published' ? '更新发布' : '发布'}
          </button>
        </div>
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


      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── 主编辑区 ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题"
            className="w-full rounded-md border border-border bg-surface px-4 py-3 font-display text-xl font-bold text-ink outline-none transition-colors placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-subtle focus:border-brand"
          />

          <div className="ds-card overflow-hidden">
            {/* 工具栏 */}
            <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2/50 px-2 py-1.5">
              {TOOLBAR.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  title={item.title}
                  onClick={() => insertAtCursor(item.before, item.after, item.placeholder)}
                  className="rounded-xs px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  {item.label}
                </button>
              ))}

              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

              <button
                type="button"
                onClick={() => setShowBodyPicker((open) => !open)}
                aria-expanded={showBodyPicker}
                className={`inline-flex items-center gap-1 rounded-xs px-2 py-1 text-xs font-medium transition-colors ${
                  showBodyPicker ? 'bg-tint text-brand' : 'text-brand hover:bg-tint'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                插入素材
              </button>
            </div>

            {showBodyPicker && (
              <div className="border-b border-border bg-surface-2/30 p-3">
                <MediaPicker
                  ensureArticleId={ensureArticleId}
                  onPicked={insertPicked}
                  onClose={() => setShowBodyPicker(false)}
                  onError={(text) => setMessage({ kind: 'error', text })}
                  incomingFiles={droppedFiles}
                  onIncomingHandled={() => setDroppedFiles(null)}
                />
              </div>
            )}

            {/* 编辑 / 预览 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length > 0) {
                  acceptFiles(Array.from(e.dataTransfer.files));
                }
              }}
              className={`relative grid ${view === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}
            >
              {dragging && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-b-xl border-2 border-dashed border-brand bg-tint/80 text-sm font-semibold text-brand">
                  松手即可上传图片或视频
                </div>
              )}

              {view !== 'preview' && (
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length > 0) {
                      e.preventDefault();
                      acceptFiles(files);
                    }
                  }}
                  placeholder={
                    '在此撰写正文，支持 Markdown 语法。\n\n' +
                    '拖拽或粘贴图片、视频即可直接插入。'
                  }
                  spellCheck={false}
                  className={`min-h-[28rem] w-full resize-y bg-surface px-5 py-4 font-mono text-[13.5px] leading-[1.75] text-ink outline-none placeholder:text-subtle ${
                    view === 'split' ? 'lg:border-r lg:border-border' : ''
                  }`}
                />
              )}

              {view !== 'write' && (
                <div className="min-h-[28rem] overflow-x-auto bg-surface px-5 py-4">
                  {body.trim() ? (
                    <ArticleBody markdown={body} />
                  ) : (
                    <p className="text-sm text-subtle">预览会在这里显示。</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 设置侧栏 ── */}
        <aside className="flex flex-col gap-4">
          <div className="ds-card p-4">
            <h2 className="text-sm font-bold text-ink">发布设置</h2>

            <div className="mt-4 text-xs font-medium text-muted">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="article-slug">公开链接</label>
                <button
                  type="button"
                  onClick={() => setSlug(generateRandomSlug())}
                  className="font-normal text-brand transition-opacity hover:opacity-75"
                >
                  换一个
                </button>
              </div>
              <div className="mt-1.5 flex items-center overflow-hidden rounded-md border border-border bg-surface focus-within:border-brand">
                <span className="shrink-0 border-r border-border bg-surface-2 px-2.5 py-2 font-mono text-xs text-subtle">
                  /p/
                </span>
                <input
                  id="article-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="留空则随机生成"
                  className="w-full bg-transparent px-2.5 py-2 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-subtle"
                />
              </div>
              <p className="mt-1.5 font-normal leading-relaxed text-subtle">
                留空保存时会随机生成一串短字符。已发布文章留空则保持原链接不变。
              </p>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={listed}
                onChange={(e) => setListed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                在「所思所记」中展示
                <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
                  取消勾选后文章不出现在归档列表，但公开链接照常可读——适合只想定向发出去的文章。
                </span>
              </span>
            </label>

            <label className="mt-4 block text-xs font-medium text-muted">
              摘要
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                rows={3}
                placeholder="留空则自动摘取正文开头"
                className="ds-input mt-1.5 resize-y text-[13px]"
              />
            </label>

            <label className="mt-4 block text-xs font-medium text-muted">
              作者署名
              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="默认使用当前账号"
                className="ds-input mt-1.5 text-[13px]"
              />
            </label>

            <label className="mt-4 flex items-center gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={commentsEnabled}
                onChange={(e) => setCommentsEnabled(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              允许访客评论
            </label>

            <PasswordSetting
              mode={passwordMode}
              onModeChange={setPasswordMode}
              password={password}
              onPasswordChange={setPassword}
              hasStoredPassword={initial.hasStoredPassword}
              sitePasswordConfigured={sitePasswordConfigured}
            />
          </div>

          <div className="ds-card p-4">
            <h2 className="text-sm font-bold text-ink">封面图</h2>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              显示在文章列表。留空则自动取正文第一张图。
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                { value: 'above', label: '正文上方', hint: '标题下方一张横幅' },
                { value: 'hero', label: '标题背景', hint: '铺在标题区，加深色蒙版' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCoverStyle(option.value)}
                  className={`rounded-md border p-2.5 text-left transition-colors ${
                    coverStyle === option.value
                      ? 'border-brand bg-brand/5'
                      : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <span className="block text-xs font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-subtle">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
            {coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImageUrl}
                alt="封面预览"
                className="mt-3 aspect-[16/9] w-full rounded-md object-cover ring-1 ring-border"
              />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCoverPicker((open) => !open)}
                aria-expanded={showCoverPicker}
                className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                  showCoverPicker
                    ? 'border-brand bg-tint text-brand'
                    : 'border-border bg-surface text-ink hover:bg-surface-2'
                }`}
              >
                {coverImageUrl ? '更换封面' : '选择封面'}
              </button>
              {coverImageUrl && (
                <button
                  type="button"
                  onClick={() => setCoverImageUrl('')}
                  className="rounded-sm px-2 py-1.5 text-xs text-muted transition-colors hover:text-danger"
                >
                  移除
                </button>
              )}
            </div>

            {showCoverPicker && (
              <div className="mt-3">
                <MediaPicker
                  accept="image"
                  multiple={false}
                  ensureArticleId={ensureArticleId}
                  onPicked={(items) => {
                    if (items[0]) setCoverImageUrl(items[0].url);
                  }}
                  onClose={() => setShowCoverPicker(false)}
                  onError={(text) => setMessage({ kind: 'error', text })}
                />
              </div>
            )}
          </div>

          <div className="ds-card p-4">
            <h2 className="text-sm font-bold text-ink">Markdown 速查</h2>
            <ul className="mt-2.5 space-y-1.5 font-mono text-[11.5px] leading-relaxed text-muted">
              <li># 一级标题 · ## 二级标题</li>
              <li>**粗体** · *斜体* · ~~删除~~</li>
              <li>- 列表 · 1. 有序列表</li>
              <li>&gt; 引用 · `行内代码`</li>
              <li>[文字](链接) · ![图](图片链接)</li>
              <li>| 表格 | 用竖线分列 |</li>
              <li>- [ ] 待办 · - [x] 已完成</li>
              <li className="pt-1 font-sans text-[11px] leading-relaxed text-subtle">
                多张图片写在相邻行（中间不空行）会显示为图组；空行隔开则各自单独成图。
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

// app/p/_components/CommentSection.tsx
// Comment block under an article: the existing conversation, then the form.
//
// A Server Component so the comments ship in the initial HTML — they are part
// of the page's content, not an afterthought loaded on hydration. The challenge
// is minted here too, once per render.

import { createChallenge } from '@/lib/article/captcha';
import { listVisibleComments } from '@/lib/article/comments';
import { CommentForm } from './CommentForm';

function formatTime(date: Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Deterministic avatar tint from the name, so a commenter looks consistent. */
function avatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

export async function CommentSection({
  contentItemId,
  slug,
  commentsEnabled,
}: {
  contentItemId: string;
  slug: string;
  commentsEnabled: boolean;
}) {
  const comments = await listVisibleComments(contentItemId);

  return (
    <section id="comments" className="mt-14 scroll-mt-20 border-t border-border pt-10">
      <h2 className="font-display text-lg font-bold text-ink">
        评论
        {comments.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted">{comments.length}</span>
        )}
      </h2>

      {comments.length > 0 ? (
        <ul className="mt-6 flex flex-col divide-y divide-border/70">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3 py-5 first:pt-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{
                  backgroundColor: `hsl(${avatarHue(comment.authorName)} 55% 52%)`,
                }}
                aria-hidden="true"
              >
                {comment.authorName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink">{comment.authorName}</span>
                  <time
                    dateTime={new Date(comment.createdAt).toISOString()}
                    className="text-xs text-subtle"
                  >
                    {formatTime(comment.createdAt)}
                  </time>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-muted">
          {commentsEnabled ? '还没有评论，来说第一句。' : '暂无评论。'}
        </p>
      )}

      {commentsEnabled ? (
        <div className="mt-8 rounded-xl border border-border bg-surface/60 p-5">
          <h3 className="mb-4 text-sm font-bold text-ink">发表评论</h3>
          <CommentForm slug={slug} challenge={createChallenge()} />
        </div>
      ) : (
        <p className="mt-8 rounded-md border border-border bg-surface-2/60 px-4 py-3 text-[13px] text-muted">
          这篇文章已关闭评论。
        </p>
      )}
    </section>
  );
}

'use client';

// app/admin/(shell)/articles/_components/CommentModeration.tsx
// Comment moderation for one article.
//
// Comments publish immediately, so this is the cleanup surface: hide a comment
// (reversible, keeps the record) or delete it outright (for spam that isn't
// worth storing).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { moderateComments } from '../actions';
import type { AdminComment } from '@/lib/article/comments';

function formatTime(date: Date): string {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CommentModeration({ comments }: { comments: AdminComment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (commentIds: string[], action: 'hide' | 'show' | 'delete') => {
    if (action === 'delete' && !confirm('删除后无法恢复，确定删除这条评论吗？')) return;
    startTransition(async () => {
      const result = await moderateComments({ commentIds, action });
      if (!result.ok) setError(result.error ?? '操作失败');
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  if (comments.length === 0) {
    return (
      <div className="ds-card p-6 text-center text-sm text-muted">还没有访客评论。</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="ds-card divide-y divide-border">
        {comments.map((comment) => (
          <div key={comment.id} className="flex items-start gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white">
              {comment.authorName.charAt(0)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{comment.authorName}</span>
                {comment.authorEmail && (
                  <span className="text-xs text-subtle">{comment.authorEmail}</span>
                )}
                <span className="text-xs text-subtle">{formatTime(comment.createdAt)}</span>
                {comment.status === 'hidden' && (
                  <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
                    已隐藏
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                {comment.body}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => run([comment.id], comment.status === 'hidden' ? 'show' : 'hide')}
                className="rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {comment.status === 'hidden' ? '恢复' : '隐藏'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run([comment.id], 'delete')}
                className="rounded-sm px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-danger disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

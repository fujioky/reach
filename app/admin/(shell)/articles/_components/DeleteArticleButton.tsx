'use client';

// app/admin/(shell)/articles/_components/DeleteArticleButton.tsx
// Deletes an article along with its media and comments. Irreversible, so it
// asks first and names the article in the prompt.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { deleteArticle } from '../actions';

export function DeleteArticleButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onDelete = () => {
    if (!confirm(`删除《${title}》？其中的图片、视频和全部评论都会一并删除，无法恢复。`)) return;
    startTransition(async () => {
      const result = await deleteArticle(id);
      if (!result.ok) setError(result.error ?? '删除失败');
      else router.push('/admin/articles');
    });
  };

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-sm border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
      >
        {pending ? '删除中…' : '删除文章'}
      </button>
    </div>
  );
}

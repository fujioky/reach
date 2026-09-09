'use client';

// app/s/[token]/_components/CommentListClient.tsx
// Renders the comment list. Translation is controlled globally by
// PageTranslationShell — no local toggle here.

import { TranslatedBody } from './TranslatedBody';

interface CommentAuthor {
  name: string;
  handle: string;
  avatarUrl?: string;
}

export interface CommentData {
  id: string;
  author: CommentAuthor;
  text: string;
  /** Server-prefetched translations from DB cache. May be partial or empty. */
  initialTranslations: Record<string, string>;
}

interface CommentListClientProps {
  comments: CommentData[];
}

function proxyAvatar(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-avatar?url=${encodeURIComponent(url)}`;
}

export function CommentListClient({ comments }: CommentListClientProps) {
  if (comments.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-muted">
        暂无精选评论
      </div>
    );
  }

  return (
    <div>
      {comments.map((comment, index) => (
        <div
          key={comment.id}
          className={`flex gap-3 py-4 ${index < comments.length - 1 ? 'border-b border-border/60' : ''}`}
        >
          {comment.author.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxyAvatar(comment.author.avatarUrl)}
              alt={comment.author.name}
              className="h-9 w-9 shrink-0 rounded-full ring-1 ring-border/50"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">
                {comment.author.name}
              </span>
              <span className="text-sm text-subtle">
                @{comment.author.handle}
              </span>
            </div>
            <TranslatedBody
              text={comment.text}
              className="mt-1 text-sm text-ink"
              splitByParagraph={false}
              initialTranslations={comment.initialTranslations}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

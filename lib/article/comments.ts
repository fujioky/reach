// lib/article/comments.ts
// Visitor comment validation, rate limiting and queries for articles.
//
// Kept separate from lib/mirror/comments.ts: that module reshapes comments
// scraped from X/YouTube for storage, this one guards a public write path.

import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db, articleComments } from '@/lib/db';

/** Length bounds — generous enough for real comments, bounded for abuse. */
export const NAME_MAX_LENGTH = 32;
export const BODY_MIN_LENGTH = 2;
export const BODY_MAX_LENGTH = 2000;
export const EMAIL_MAX_LENGTH = 254;

/** Per-IP window: at most RATE_LIMIT_MAX comments per RATE_LIMIT_WINDOW_MS. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
/** Minimum spacing between two comments from the same IP. */
const MIN_INTERVAL_MS = 30 * 1000;

export interface CommentInput {
  authorName: string;
  authorEmail?: string;
  body: string;
}

export type ValidationResult =
  | { ok: true; value: { authorName: string; authorEmail: string | null; body: string } }
  | { ok: false; error: string };

/**
 * Validate and normalize a submission.
 *
 * Whitespace is collapsed in the name but preserved in the body — paragraph
 * breaks are meaningful there. Runs of more than two blank lines are squeezed
 * so a comment can't stretch the page vertically.
 */
export function validateComment(input: CommentInput): ValidationResult {
  const authorName = input.authorName.replace(/\s+/g, ' ').trim();
  if (!authorName) return { ok: false, error: '请填写昵称' };
  if (authorName.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `昵称最长 ${NAME_MAX_LENGTH} 字` };
  }

  const body = input.body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length < BODY_MIN_LENGTH) return { ok: false, error: '评论内容太短了' };
  if (body.length > BODY_MAX_LENGTH) {
    return { ok: false, error: `评论最长 ${BODY_MAX_LENGTH} 字` };
  }

  const rawEmail = input.authorEmail?.trim() ?? '';
  let authorEmail: string | null = null;
  if (rawEmail) {
    if (rawEmail.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return { ok: false, error: '邮箱格式不正确' };
    }
    authorEmail = rawEmail.toLowerCase();
  }

  return { ok: true, value: { authorName, authorEmail, body } };
}

export type RateLimitVerdict = { ok: true } | { ok: false; error: string };

/**
 * Per-IP rate limit, evaluated against the comments already stored.
 *
 * No separate counter store: the article_comments table is indexed on
 * (ip_hash, created_at), so the two checks are one cheap query each and they
 * survive a serverless restart, which an in-memory limiter would not.
 * An unknown IP (no x-forwarded-for) is not limited — it would otherwise
 * throttle every such visitor as if they were one person.
 */
export async function checkRateLimit(ipHash: string | null): Promise<RateLimitVerdict> {
  if (!ipHash) return { ok: true };

  const [recent] = await db
    .select({ latest: sql<Date | null>`max(${articleComments.createdAt})`, total: count() })
    .from(articleComments)
    .where(
      and(
        eq(articleComments.ipHash, ipHash),
        gte(articleComments.createdAt, new Date(Date.now() - RATE_LIMIT_WINDOW_MS)),
      ),
    );

  if (recent && recent.total >= RATE_LIMIT_MAX) {
    return { ok: false, error: '评论太频繁了，请稍后再来' };
  }
  if (recent?.latest && Date.now() - new Date(recent.latest).getTime() < MIN_INTERVAL_MS) {
    return { ok: false, error: '请稍候片刻再发下一条' };
  }
  return { ok: true };
}

export interface PublicComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

/** Visible comments for an article, oldest first (reads like a conversation). */
export async function listVisibleComments(contentItemId: string): Promise<PublicComment[]> {
  const rows = await db
    .select({
      id: articleComments.id,
      authorName: articleComments.authorName,
      body: articleComments.body,
      createdAt: articleComments.createdAt,
    })
    .from(articleComments)
    .where(
      and(
        eq(articleComments.contentItemId, contentItemId),
        eq(articleComments.status, 'visible'),
      ),
    )
    .orderBy(asc(articleComments.createdAt));
  return rows;
}

export interface AdminComment extends PublicComment {
  authorEmail: string | null;
  status: string;
}

/** All comments for an article including hidden ones, newest first (moderation). */
export async function listAllComments(contentItemId: string): Promise<AdminComment[]> {
  return db
    .select({
      id: articleComments.id,
      authorName: articleComments.authorName,
      authorEmail: articleComments.authorEmail,
      body: articleComments.body,
      status: articleComments.status,
      createdAt: articleComments.createdAt,
    })
    .from(articleComments)
    .where(eq(articleComments.contentItemId, contentItemId))
    .orderBy(desc(articleComments.createdAt));
}

/** Visible-comment counts for a set of articles, in one query (no N+1). */
export async function countVisibleComments(
  contentItemIds: string[],
): Promise<Map<string, number>> {
  if (contentItemIds.length === 0) return new Map();
  const rows = await db
    .select({ contentItemId: articleComments.contentItemId, total: count() })
    .from(articleComments)
    .where(eq(articleComments.status, 'visible'))
    .groupBy(articleComments.contentItemId);

  const wanted = new Set(contentItemIds);
  const result = new Map<string, number>();
  for (const row of rows) {
    if (wanted.has(row.contentItemId)) result.set(row.contentItemId, row.total);
  }
  return result;
}

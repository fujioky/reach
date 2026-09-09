// lib/article/queries.ts
// Read paths for self-authored articles.
//
// Articles live in content_items alongside mirrors (type='article'), so every
// query here is scoped by that discriminator. The mirror pages must never show
// an article and vice versa — the two have different URLs, different chrome and
// different comment models.

import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db, contentItems } from '@/lib/db';

/** Author blob stored on an article row. */
export interface ArticleAuthor {
  name: string;
  handle?: string;
  avatarUrl?: string;
}

export interface ArticleRow {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  status: string | null;
  author: ArticleAuthor;
  publishedAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  commentsEnabled: boolean;
  listed: boolean;
  passwordMode: string | null;
  passwordHash: string | null;
  coverStyle: string | null;
}

const ARTICLE_COLUMNS = {
  id: contentItems.id,
  slug: contentItems.slug,
  title: contentItems.title,
  body: contentItems.body,
  excerpt: contentItems.excerpt,
  coverImageUrl: contentItems.coverImageUrl,
  status: contentItems.status,
  author: contentItems.author,
  publishedAt: contentItems.publishedAt,
  updatedAt: contentItems.updatedAt,
  createdAt: contentItems.createdAt,
  createdBy: contentItems.createdBy,
  commentsEnabled: contentItems.commentsEnabled,
  listed: contentItems.listed,
  passwordMode: contentItems.passwordMode,
  passwordHash: contentItems.passwordHash,
  coverStyle: contentItems.coverStyle,
} as const;

/** Rows are typed loosely by Drizzle because `author` is jsonb. */
function toArticleRow(row: Record<string, unknown>): ArticleRow {
  return { ...row, author: (row.author ?? { name: '' }) as ArticleAuthor } as ArticleRow;
}

/** `type='article'` — the scope every query below shares. */
export const isArticle = eq(contentItems.type, 'article');

/**
 * `NOT type='article'` for the mirror pages.
 *
 * Rows created before the `type` column was populated have type NULL, and
 * `ne(type,'article')` drops them (NULL comparisons are never true) — those are
 * all mirrors, so they have to be explicitly kept.
 */
export const isNotArticle = or(ne(contentItems.type, 'article'), isNull(contentItems.type))!;

/**
 * Published articles for the public archive, newest first.
 *
 * Scoped to `listed` — an unlisted article stays fully readable at its own URL,
 * it just doesn't appear in the index. Pass includeUnlisted for surfaces that
 * should show everything (currently none on the public side).
 */
export async function listPublishedArticles(
  limit = 50,
  includeUnlisted = false,
): Promise<ArticleRow[]> {
  const rows = await db
    .select(ARTICLE_COLUMNS)
    .from(contentItems)
    .where(
      and(
        isArticle,
        eq(contentItems.status, 'published'),
        ...(includeUnlisted ? [] : [eq(contentItems.listed, true)]),
      ),
    )
    .orderBy(desc(sql`coalesce(${contentItems.publishedAt}, ${contentItems.createdAt})`))
    .limit(limit);
  return rows.map(toArticleRow);
}

/** A published article by slug. Drafts are invisible here — the admin previews by id. */
export async function getPublishedArticleBySlug(slug: string): Promise<ArticleRow | null> {
  const [row] = await db
    .select(ARTICLE_COLUMNS)
    .from(contentItems)
    .where(and(isArticle, eq(contentItems.status, 'published'), eq(contentItems.slug, slug)))
    .limit(1);
  return row ? toArticleRow(row) : null;
}

/** Any article by id, draft included — admin surfaces only. */
export async function getArticleById(id: string): Promise<ArticleRow | null> {
  const [row] = await db
    .select(ARTICLE_COLUMNS)
    .from(contentItems)
    .where(and(isArticle, eq(contentItems.id, id)))
    .limit(1);
  return row ? toArticleRow(row) : null;
}

/** All articles for the admin list, newest activity first. */
export async function listAllArticles(limit = 100): Promise<ArticleRow[]> {
  const rows = await db
    .select(ARTICLE_COLUMNS)
    .from(contentItems)
    .where(isArticle)
    .orderBy(desc(contentItems.createdAt))
    .limit(limit);
  return rows.map(toArticleRow);
}

/** True when another article already owns this slug. */
export async function isSlugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.slug, slug))
    .limit(2);
  return rows.some((row) => row.id !== exceptId);
}

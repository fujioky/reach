// lib/mirror/versioning.ts
// Plan 05-03, Task 2 — mirror version snapshot, change detection, prune, rollback (D-53).
//
// createSnapshot(): assembles contentItem + media + comments into a
//   MirrorSnapshot jsonb object for rollback.
// detectSubstantialChange(): compares body/comments/media ONLY — NOT stats
//   (Pitfall 5: stats-only changes don't trigger a new version).
// pruneVersions(): keeps max 3 versions, deletes oldest (subquery — no DELETE LIMIT).
// rollbackVersion(): writes snapshot back to content_items + media + comments
//   in a transaction.
//
// KNOWN LIMITATION (research Open Question 3): if old Blob images were
//   cleaned up during a subsequent refresh, rollback may show broken images.
//   For MVP, Vercel Blob doesn't auto-delete, so old Blob URLs still exist.
//   Old Blob image cleanup is deferred to v2 (research Open Question 2).

import { eq, desc, notInArray, and, sql } from 'drizzle-orm';
import { db, contentItems, media, comments, mirrorVersions } from '@/lib/db';
import type { FetchedContent } from '@/lib/fetcher/types';

// ─── MirrorSnapshot (research Pattern 3) ────────────────────────

/**
 * Complete content snapshot for version history + rollback (D-53).
 * Captures the display-relevant state of contentItem + media + comments.
 * Stored as jsonb in mirror_versions.snapshot.
 */
export interface MirrorSnapshot {
  contentItem: {
    title: string;
    body: string;
    author: unknown; // jsonb — Author object
    publishedAt: string | null; // ISO 8601
    stats: unknown; // jsonb — EngagementStats
    platformData: unknown; // jsonb
    fetchedAt: string | null; // ISO 8601
  };
  media: Array<{
    type: string;
    originalUrl: string;
    blobUrl: string | null;
    size: number | null;
    meta: unknown; // jsonb
  }>;
  comments: Array<{
    platformCommentId: string | null;
    author: unknown; // jsonb — Author object
    text: string;
    postedAt: string | null; // ISO 8601
    likes: number;
    retained: boolean;
  }>;
}

// ─── createSnapshot ─────────────────────────────────────────────

// Drizzle transaction object passed to db.transaction(callback) — compatible
// with the same select()/from()/where() interface used here.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Assemble a MirrorSnapshot for the given contentItemId by querying
 * contentItems + media + comments. Used by refreshMirror() to capture
 * the current state BEFORE writing new data (Pitfall 4).
 *
 * Accepts an optional transaction object so it can be called inside
 * createMirror's db.transaction for the initial v0 snapshot.
 */
export async function createSnapshot(
  contentItemId: string,
  tx?: Tx,
): Promise<MirrorSnapshot> {
  const q = tx ?? db;

  // 1. Query contentItem
  const [item] = await q
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);

  if (!item) {
    throw new Error(`createSnapshot: contentItem ${contentItemId} not found`);
  }

  // 2. Query media
  const mediaRows = await q
    .select()
    .from(media)
    .where(eq(media.contentItemId, contentItemId));

  // 3. Query comments
  const commentRows = await q
    .select()
    .from(comments)
    .where(eq(comments.contentItemId, contentItemId));

  return {
    contentItem: {
      title: item.title,
      body: item.body,
      author: item.author,
      publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
      stats: item.stats,
      platformData: item.platformData,
      fetchedAt: item.fetchedAt ? item.fetchedAt.toISOString() : null,
    },
    media: mediaRows.map((m) => ({
      type: m.type ?? 'image',
      originalUrl: m.originalUrl,
      blobUrl: m.blobUrl,
      size: m.size,
      meta: m.meta,
    })),
    comments: commentRows.map((c) => ({
      platformCommentId: c.platformCommentId,
      author: c.author,
      text: c.text,
      postedAt: c.postedAt ? c.postedAt.toISOString() : null,
      likes: c.likes ?? 0,
      retained: c.retained,
    })),
  };
}

// ─── detectSubstantialChange (Pitfall 5) ────────────────────────

/**
 * Detect whether a re-fetch produced a substantial change (D-53).
 * Compares ONLY: body text, comment list, media list.
 * EXCLUDES: stats, fetchedAt, refreshedAt, likes — data updates that
 * don't trigger a new version (Pitfall 5).
 */
export function detectSubstantialChange(
  snapshot: MirrorSnapshot,
  newContent: FetchedContent,
): boolean {
  // 1. Body text (string equality)
  if (snapshot.contentItem.body !== newContent.body) {
    return true;
  }

  // 2. Comment list — compare sorted { platformCommentId, text } tuples
  const oldComments = snapshot.comments
    .map((c) => ({ id: c.platformCommentId ?? '', text: c.text }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const newComments = newContent.comments
    .map((c) => ({ id: c.id, text: c.content }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(oldComments) !== JSON.stringify(newComments)) {
    return true;
  }

  // 3. Media list — compare sorted { type, originalUrl } tuples
  const oldMedia = snapshot.media
    .map((m) => ({ type: m.type, originalUrl: m.originalUrl }))
    .sort((a, b) =>
      a.type === b.type
        ? a.originalUrl.localeCompare(b.originalUrl)
        : a.type.localeCompare(b.type),
    );
  const newMedia = newContent.media
    .map((m) => ({ type: m.type, originalUrl: m.originalUrl }))
    .sort((a, b) =>
      a.type === b.type
        ? a.originalUrl.localeCompare(b.originalUrl)
        : a.type.localeCompare(b.type),
    );
  if (JSON.stringify(oldMedia) !== JSON.stringify(newMedia)) {
    return true;
  }

  return false;
}

// ─── pruneVersions (D-53: max 3) ────────────────────────────────

/**
 * Prune version snapshots to keep at most `maxVersions` (default 3).
 * Deletes the oldest versions when count exceeds the limit.
 * Uses a subquery approach (Postgres doesn't support DELETE LIMIT —
 * research Assumption A4): query all versions ordered by versionNumber
 * DESC, compute the top N version numbers, then delete the rest.
 */
export async function pruneVersions(
  contentItemId: string,
  maxVersions = 3,
): Promise<void> {
  // Query all versions ordered by versionNumber DESC
  const versions = await db
    .select({
      versionNumber: mirrorVersions.versionNumber,
    })
    .from(mirrorVersions)
    .where(eq(mirrorVersions.contentItemId, contentItemId))
    .orderBy(desc(mirrorVersions.versionNumber));

  if (versions.length <= maxVersions) {
    return; // No pruning needed
  }

  // Keep the top N version numbers, delete the rest
  const topVersionNumbers = versions
    .slice(0, maxVersions)
    .map((v) => v.versionNumber);

  await db
    .delete(mirrorVersions)
    .where(
      and(
        eq(mirrorVersions.contentItemId, contentItemId),
        notInArray(mirrorVersions.versionNumber, topVersionNumbers),
      ),
    );
}

// ─── rollbackVersion (D-53: write snapshot back) ────────────────

/**
 * Roll back a mirror to a previous version by writing the snapshot data
 * back to content_items + media + comments in a transaction (D-53).
 *
 * KNOWN LIMITATION (research Open Question 3): if old Blob images were
 * cleaned up during a subsequent refresh, rollback may show broken images.
 * For MVP, Vercel Blob doesn't auto-delete, so old Blob URLs still exist.
 * Old Blob image cleanup is deferred to v2 (research Open Question 2).
 */
export async function rollbackVersion(
  contentItemId: string,
  versionNumber: number,
): Promise<void> {
  // 1. Query the snapshot for the given version
  const [version] = await db
    .select()
    .from(mirrorVersions)
    .where(
      and(
        eq(mirrorVersions.contentItemId, contentItemId),
        eq(mirrorVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);

  if (!version) {
    throw new Error(`Version ${versionNumber} not found for content item ${contentItemId}`);
  }

  const snapshot = version.snapshot as MirrorSnapshot;

  // 2. Write snapshot back to all 3 tables in a transaction
  await db.transaction(async (tx) => {
    // 2a. Update content_items with snapshot fields
    await tx
      .update(contentItems)
      .set({
        title: snapshot.contentItem.title,
        body: snapshot.contentItem.body,
        author: snapshot.contentItem.author,
        publishedAt: snapshot.contentItem.publishedAt
          ? new Date(snapshot.contentItem.publishedAt)
          : null,
        stats: snapshot.contentItem.stats,
        platformData: snapshot.contentItem.platformData,
        fetchedAt: snapshot.contentItem.fetchedAt
          ? new Date(snapshot.contentItem.fetchedAt)
          : null,
      })
      .where(eq(contentItems.id, contentItemId));

    // 2b. Delete old media rows and insert snapshot media rows
    await tx.delete(media).where(eq(media.contentItemId, contentItemId));
    for (const m of snapshot.media) {
      await tx.insert(media).values({
        contentItemId,
        type: m.type,
        originalUrl: m.originalUrl,
        blobUrl: m.blobUrl,
        size: m.size,
        meta: m.meta,
      });
    }

    // 2c. Delete old comments and insert snapshot comment rows
    await tx.delete(comments).where(eq(comments.contentItemId, contentItemId));
    for (const c of snapshot.comments) {
      await tx.insert(comments).values({
        contentItemId,
        platformCommentId: c.platformCommentId,
        author: c.author,
        text: c.text,
        postedAt: c.postedAt ? new Date(c.postedAt) : null,
        likes: c.likes,
        retained: c.retained,
      });
    }
  });
}

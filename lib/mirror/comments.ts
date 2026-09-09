// lib/mirror/comments.ts
// Pure function for mapping fetched comments → DB-ready records with retained flag.
// Plan 03-04, Task 2 — implements D-24/D-25/D-27 comment retention logic.
//
// D-24: default all retained=true when all parent IDs are selected.
// D-25: replies follow their parent — unselecting a parent marks the parent
//       AND all its replies as retained=false. Replies are not individually
//       selectable.
// D-27: all comments (including unselected ones and all replies) are stored
//       in the comments table. The `retained` boolean marks which ones the
//       admin kept. Phase 4 visitor rendering shows only retained=true.

import type { Comment, Author } from '@/lib/fetcher/types';

/**
 * A single comment record ready for DB insertion.
 * Maps the FetchedContent Comment structure to the comments table columns.
 */
export interface CommentRecord {
  id: string;                 // platform comment ID (for dedup / reference)
  platformCommentId: string;  // same as id — stored in comments.platform_comment_id
  author: Author;             // stored as JSONB
  text: string;               // comment content
  postedAt: string;           // ISO 8601 UTC
  likes: number;              // from stats.likes
  retained: boolean;          // D-27: true if admin kept this comment
}

/**
 * Build DB-ready comment records from fetched comments, marking which are
 * retained based on the admin's selection.
 *
 * @param comments             the fetched comment tree (may have nested replies)
 * @param selectedParentIds    IDs of parent comments the admin chose to retain.
 *                             Accepts a Set<string> or string[]. If omitted,
 *                             all comments default to retained=true (D-24).
 * @returns                    flattened array of CommentRecord (all comments,
 *                             including replies, regardless of retained — D-27)
 *
 * Retained rules (D-25):
 *   - A parent comment's retained = whether its ID is in selectedParentIds.
 *   - A reply's retained = its parent's retained (replies are not individually
 *     selectable — they follow the parent).
 */
export function buildCommentRecords(
  comments: Comment[],
  selectedParentIds: Set<string> | string[],
): CommentRecord[] {
  // Normalize to Set for O(1) lookup
  const selectedSet =
    selectedParentIds instanceof Set
      ? selectedParentIds
      : new Set(selectedParentIds);

  const records: CommentRecord[] = [];

  /**
   * Recursively flatten a comment and its replies, applying the retained flag.
   * @param comment   the current comment
   * @param retained  the retained value inherited from the parent (for top-level
   *                  comments, this is computed from selectedSet; for replies,
   *                  it's passed down from the parent)
   */
  function flatten(comment: Comment, retained: boolean): void {
    records.push({
      id: comment.id,
      platformCommentId: comment.id,
      author: comment.author,
      text: comment.content,
      postedAt: comment.createdAt,
      likes: comment.stats.likes,
      retained,
    });

    // Recurse into replies — they inherit the parent's retained flag (D-25)
    if (comment.replies && comment.replies.length > 0) {
      for (const reply of comment.replies) {
        flatten(reply, retained);
      }
    }
  }

  // Top-level comments: retained = whether ID is in the selected set (D-24)
  for (const comment of comments) {
    const retained = selectedSet.has(comment.id);
    flatten(comment, retained);
  }

  return records;
}

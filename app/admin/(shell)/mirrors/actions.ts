// app/admin/mirrors/actions.ts
// Server Actions for the mirror admin pages. Creation itself lives in
// lib/mirror/create.ts, shared with the quick-share API; these actions add the
// session check and the wizard's two-step flow on top.
//
// Auth: every action calls auth() for defense-in-depth (not just proxy.ts).

'use server';

import { z } from 'zod';
import { auth } from '@/auth';
import { fetchContent } from '@/lib/fetcher';
import { FetcherError } from '@/lib/fetcher/errors';
import { db, contentItems, media, comments, shares, refreshPreviews } from '@/lib/db';
import { eq, and, asc, sql } from 'drizzle-orm';
import { isNotArticle } from '@/lib/article/queries';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { prefetchMissingReplies } from '@/lib/mirror/x-thread-expand';
import type { FetchedContent } from '@/lib/fetcher/types';
import {
  accessControlSchema,
  createMirrorFromUrl,
  insertShare,
  platformUrlSchema,
  uploadMirrorVideos,
} from '@/lib/mirror/create';

// ─── Result Types ────────────────────────────────────────────────────

export interface PreviewResult {
  ok: boolean;
  content?: FetchedContent;
  error?: string;
  kind?: string;
  retryable?: boolean;
}

export interface CreateMirrorResult {
  ok: boolean;
  mirrorId?: string;
  shareToken?: string; // the client builds {origin}/s/{token} from this
  warnings: string[];
  error?: string;
}

// ─── previewMirror ───────────────────────────────────────────────────
// Step 1 of the two-step flow: fetch for preview — no Blob upload, no DB
// writes. The admin reviews the preview, selects comments, then calls
// createMirror.

export async function previewMirror(url: string): Promise<PreviewResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized', kind: 'auth_required' };
  }

  const parsed = platformUrlSchema.safeParse(url);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid URL',
      kind: 'invalid_url',
    };
  }

  try {
    const content = await fetchContent(parsed.data);
    return { ok: true, content };
  } catch (err) {
    if (err instanceof FetcherError) {
      return {
        ok: false,
        error: err.message,
        kind: err.kind,
        retryable: err.retryable ?? false,
      };
    }
    return {
      ok: false,
      error: (err as Error).message,
      kind: 'unknown',
    };
  }
}

// ─── createMirror ────────────────────────────────────────────────────
// Step 2: payload is { url, selectedCommentIds, accessControl } only — the
// content is fetched again server-side rather than posted back. The wizard
// waits for the video upload so it can show its warnings.

const createMirrorSchema = z.object({
  url: platformUrlSchema,
  selectedCommentIds: z.array(z.string()),
  accessControl: accessControlSchema.optional(),
});

export async function createMirror(
  input: z.input<typeof createMirrorSchema>,
): Promise<CreateMirrorResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, warnings: [], error: 'Unauthorized' };
  }

  const parsed = createMirrorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: [],
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const created = await createMirrorFromUrl({
    ...parsed.data,
    createdBy: session.user.name ?? null,
  });
  if (!created.ok) {
    return { ok: false, warnings: created.warnings, error: created.error };
  }

  const videoWarnings = await uploadMirrorVideos(created.mirrorId);
  after(() => prefetchMissingReplies(created.mirrorId));
  return {
    ok: true,
    mirrorId: created.mirrorId,
    shareToken: created.shareToken,
    warnings: [...created.warnings, ...videoWarnings],
  };
}

// ─── deleteMirror ────────────────────────────────────────────────────
// Deletes a mirror and its child rows (media, comments).
//
// T-03-11: auth() self-check (defense-in-depth).
// T-03-12 / Review #13: mirrorId validated with zod z.string().uuid()
//   to prevent injection / unauthorized deletion.
//
// FK no-action: media and comments have ON DELETE NO ACTION on
// content_items. We must delete child rows first inside a transaction
// before deleting the parent content_items row (Open Q2 / 阶段假设 4).
// We do NOT alter the existing migration's cascade semantics.

const mirrorIdSchema = z.string().uuid();

export interface DeleteMirrorResult {
  ok: boolean;
  error?: string;
}

export async function deleteMirror(
  mirrorId: string,
): Promise<DeleteMirrorResult> {
  // 1. Auth self-check (T-03-11 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate mirrorId (T-03-12 / Review #13: zod uuid)
  const parsed = mirrorIdSchema.safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid mirrorId' };
  }
  const id = parsed.data;

  // 3. Delete in transaction: child rows first, then parent
  //    (FK ON DELETE NO ACTION — must remove children before parent)
  try {
    await db.transaction(async (tx) => {
      // 3a. Delete shares rows for this content item (FK ON DELETE NO ACTION
      //     — must delete before parent; PATTERNS landmine #1)
      await tx.delete(shares).where(eq(shares.contentItemId, id));
      // 3b. Delete media rows for this content item
      await tx.delete(media).where(eq(media.contentItemId, id));
      // 3c. Delete comments rows for this content item
      await tx.delete(comments).where(eq(comments.contentItemId, id));
      // 3d. Delete the content_items row
      await tx.delete(contentItems).where(eq(contentItems.id, id));
    });
  } catch (err) {
    return {
      ok: false,
      error: `Delete failed: ${(err as Error).message}`,
    };
  }

  // 4. Revalidate the list page
  revalidatePath('/admin/mirrors');

  return { ok: true };
}

// ─── refreshMirror (Plan 05-03, MIRR-05, D-53) ──────────────────────
// Admin clicks '重新抓取' to re-fetch content, comments, and media.
// Delegates to lib/mirror/refresh.ts — snapshot → re-fetch → detect
// change → version or stats-only update (Pitfall 4).
//
// T-05-09: re-fetch uses the existing sourceUrl from content_items
//   (already validated at createMirror with platform whitelist) — no
//   user-supplied URL at refresh time, so no new SSRF risk.
// T-05-10: auth() self-check + zod validation (contentItemId uuid).

export interface RefreshMirrorActionResult {
  ok: boolean;
  changed?: boolean;
  version?: number;
  error?: string;
}

export async function refreshMirror(
  contentItemId: string,
): Promise<RefreshMirrorActionResult> {
  // 1. Auth self-check (T-05-10 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate contentItemId (zod uuid)
  const parsed = z.string().uuid().safeParse(contentItemId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid contentItemId' };
  }

  // 3. Call refreshMirror() lib function
  const { refreshMirror: refreshMirrorLib } = await import('@/lib/mirror/refresh');
  const result = await refreshMirrorLib(parsed.data);

  if (result.error) {
    return { ok: false, error: result.error };
  }
  after(() => prefetchMissingReplies(parsed.data));

  // 4. Revalidate the list + detail pages
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${parsed.data}`);

  return {
    ok: true,
    changed: result.changed,
    version: result.version,
  };
}

// ─── rollbackMirror (Plan 05-03, D-53) ──────────────────────────────
// Admin rolls back a mirror to a previous version. Delegates to
// rollbackVersion() from lib/mirror/versioning.ts — writes the snapshot
// back to content_items + media + comments in a transaction.
//
// T-05-10: auth() self-check + zod validation (contentItemId uuid +
//   versionNumber positive int).

export interface RollbackMirrorActionResult {
  ok: boolean;
  error?: string;
}

const rollbackSchema = z.object({
  contentItemId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
});

export async function rollbackMirror(
  contentItemId: string,
  versionNumber: number,
): Promise<RollbackMirrorActionResult> {
  // 1. Auth self-check (T-05-10 defense-in-depth)
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // 2. Validate input (zod uuid + positive int)
  const parsed = rollbackSchema.safeParse({ contentItemId, versionNumber });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  // 3. Call rollbackVersion() lib function
  const { rollbackVersion } = await import('@/lib/mirror/versioning');
  try {
    await rollbackVersion(parsed.data.contentItemId, parsed.data.versionNumber);
  } catch (err) {
    return {
      ok: false,
      error: `Rollback failed: ${(err as Error).message}`,
    };
  }

  // 4. Revalidate the list + detail pages
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${parsed.data.contentItemId}`);

  return { ok: true };
}

// ─── createShare ─────────────────────────────────────────────────────
// 为已有内容新增一个分享链接（内容详情页"新增分享"按钮调用）。
// auth() self-check + zod contentItemId uuid 验证。

const createShareSchema = z.object({
  contentItemId: z.string().uuid(),
  accessControl: accessControlSchema.optional(),
});

export interface CreateShareResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export async function createShare(
  input: z.input<typeof createShareSchema>,
): Promise<CreateShareResult> {
  // 1. Auth
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };

  // 2. Validate
  const parsed = createShareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { contentItemId, accessControl } = parsed.data;

  // 3. Insert share
  let token: string;
  try {
    token = await insertShare(db, contentItemId, accessControl);
  } catch (err) {
    return { ok: false, error: `Create share failed: ${(err as Error).message}` };
  }

  // 4. Revalidate
  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${contentItemId}`);

  return { ok: true, token };
}

// ─── setMirrorPassword ───────────────────────────────────────────────
// Password gate for a mirror. Stored on the content item, so it applies to
// every share link pointing at it — the password protects the content, while
// expiry / view caps / burn-after-read are properties of an individual link.

const mirrorPasswordSchema = z.object({
  contentItemId: z.string().uuid(),
  mode: z.enum(['none', 'inherit', 'custom']),
  password: z.string().max(200).optional(),
});

export async function setMirrorPassword(input: {
  contentItemId: string;
  mode: 'none' | 'inherit' | 'custom';
  password?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };

  const parsed = mirrorPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' };
  }
  const { contentItemId, mode, password } = parsed.data;

  const [existing] = await db
    .select({ passwordHash: contentItems.passwordHash })
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .limit(1);
  if (!existing) return { ok: false, error: '内容不存在' };

  // Blank keeps the stored password; leaving 'custom' drops it so no stale
  // secret survives the mode change.
  let passwordHash: string | null = null;
  if (mode === 'custom') {
    if (password?.trim()) {
      const { hashPassword } = await import('@/lib/content/password');
      passwordHash = await hashPassword(password.trim());
    } else if (existing.passwordHash) {
      passwordHash = existing.passwordHash;
    } else {
      return { ok: false, error: '选择「单独设置密码」时需要填写密码' };
    }
  }

  try {
    await db
      .update(contentItems)
      .set({ passwordMode: mode, passwordHash })
      .where(eq(contentItems.id, contentItemId));
  } catch (err) {
    return { ok: false, error: `保存失败：${(err as Error).message}` };
  }

  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${contentItemId}`);
  return { ok: true };
}

// ─── previewRefresh + applyRefresh (D-53 extension) ───────────────────
// Two-step refresh flow: preview first, then apply. The admin sees the diff
// and chooses which comments to keep before the new version is written.

export interface PreviewRefreshActionResult {
  ok: boolean;
  previewId?: string;
  changed?: boolean;
  message?: string;
  error?: string;
}

export interface ApplyRefreshActionResult {
  ok: boolean;
  version?: number;
  error?: string;
}

const previewRefreshSchema = z.string().uuid();
const applyRefreshSchema = z.object({
  mirrorId: z.string().uuid(),
  previewId: z.string().uuid(),
  selectedCommentIds: z.array(z.string()),
});

/**
 * Server Action: start a refresh preview.
 * Fetches the source, compares with current mirror, and either:
 *   - returns { changed: false } if nothing substantial changed, or
 *   - returns { previewId } so the client can redirect to the preview page.
 */
export async function previewRefreshAction(
  mirrorId: string,
): Promise<PreviewRefreshActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = previewRefreshSchema.safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid mirror id' };
  }

  const { previewRefresh } = await import('@/lib/mirror/refresh');
  const result = await previewRefresh(parsed.data);
  after(() => prefetchMissingReplies(parsed.data));

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.changed === false) {
    revalidatePath('/admin/mirrors');
    revalidatePath(`/admin/mirrors/${mirrorId}`);
    return { ok: true, changed: false, message: result.message };
  }

  return { ok: true, changed: true, previewId: result.previewId };
}

/**
 * Server Action: apply a refresh preview.
 * Downloads images, writes the new content, creates a version snapshot, and
 * deletes the preview. Then revalidates the mirror pages.
 */
export async function applyRefreshAction(
  input: {
    mirrorId: string;
    previewId: string;
    selectedCommentIds: string[];
  },
): Promise<ApplyRefreshActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = applyRefreshSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { mirrorId, previewId, selectedCommentIds } = parsed.data;

  const { applyRefresh } = await import('@/lib/mirror/refresh');
  const result = await applyRefresh(mirrorId, previewId, selectedCommentIds);
  after(() => prefetchMissingReplies(mirrorId));

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/mirrors');
  revalidatePath(`/admin/mirrors/${mirrorId}`);

  return { ok: true, version: result.version };
}

/**
 * Server Action: discard a refresh preview without applying it.
 */
export async function discardRefreshAction(
  mirrorId: string,
  previewId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const idParsed = z.string().uuid().safeParse(mirrorId);
  const previewParsed = z.string().uuid().safeParse(previewId);
  if (!idParsed.success || !previewParsed.success) {
    return { ok: false, error: 'Invalid ids' };
  }

  try {
    await db
      .delete(refreshPreviews)
      .where(
        and(eq(refreshPreviews.id, previewParsed.data), eq(refreshPreviews.contentItemId, idParsed.data)),
      );
  } catch (err) {
    return { ok: false, error: `Discard failed: ${(err as Error).message}` };
  }

  return { ok: true };
}

// ─── refreshTranscriptAction — 字幕单独刷新 ────────────────────────────
// Re-fetches the source and updates only platformData.transcript(/Lang).
// No version snapshot, no preview flow (subtitles are outside
// substantial-change detection by design).

export interface RefreshTranscriptActionResult {
  ok: boolean;
  found?: boolean;
  lang?: string;
  error?: string;
}

export async function refreshTranscriptAction(
  mirrorId: string,
): Promise<RefreshTranscriptActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = z.string().uuid().safeParse(mirrorId);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid mirror id' };
  }

  const { refreshTranscript } = await import('@/lib/mirror/refresh');
  const result = await refreshTranscript(parsed.data);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/mirrors/${parsed.data}`);
  return { ok: true, found: result.found, lang: result.lang };
}

// ─── listXMirrorIds ──────────────────────────────────────────────────
// Every X mirror, oldest refresh first, for 「刷新全部 X 镜像」: the list page
// shows only 50, and the client refreshes them one by one with refreshMirror
// so no single request outlives the function timeout.

export async function listXMirrorIds(): Promise<{ ok: boolean; ids?: string[]; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Unauthorized' };
  const rows = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.platform, 'x'), isNotArticle))
    .orderBy(asc(sql`coalesce(${contentItems.refreshedAt}, ${contentItems.createdAt})`));
  return { ok: true, ids: rows.map((r) => r.id) };
}

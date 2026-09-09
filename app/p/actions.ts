// app/p/actions.ts
// Public write path: visitor comments on articles.
//
// Comments appear immediately (no review queue), so everything that keeps this
// endpoint from becoming a spam sink runs here, in order of cost: honeypot
// (free) → signed arithmetic challenge (free) → shape validation (free) →
// per-IP rate limit (one indexed query) → insert.

'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { db, articleComments, contentItems } from '@/lib/db';
import { extractVisitorIp } from '@/lib/access/visitor';
import { createChallenge, hashIp, verifyChallenge, type Challenge } from '@/lib/article/captcha';
import { checkRateLimit, validateComment } from '@/lib/article/comments';
import { checkUnlocked } from '@/lib/content/password';

export interface CommentFormState {
  ok: boolean;
  error?: string;
  /** Set after a successful insert so the form can reset and thank the visitor. */
  submitted?: boolean;
  /**
   * A fresh challenge for the next attempt.
   *
   * A challenge is single-use in practice — after a failed submit the visitor
   * would otherwise be re-answering a question whose token may already have
   * expired, and after a successful one the form needs a new question anyway.
   * Handing it back with the result avoids a round trip to fetch one.
   */
  nextChallenge?: Challenge;
}

/** Shorthand: every return path carries a usable next challenge. */
function reply(state: Omit<CommentFormState, 'nextChallenge'>): CommentFormState {
  return { ...state, nextChallenge: createChallenge() };
}

/**
 * Handle a comment submission.
 *
 * Shaped as a useActionState reducer: it takes the previous state and the form
 * data, and returns the next state. Errors come back as text for the visitor
 * rather than thrown, since every failure mode here is a user-correctable one.
 */
export async function submitArticleComment(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return reply({ ok: false, error: '提交信息不完整，请刷新页面重试' });

  // Honeypot — a field hidden from humans via CSS. Anything that fills it is
  // a form-filling bot. Answer as if it worked so the bot doesn't learn.
  if (String(formData.get('website') ?? '').trim() !== '') {
    return reply({ ok: true, submitted: true });
  }

  const verdict = verifyChallenge(
    String(formData.get('challengeToken') ?? ''),
    String(formData.get('challengeAnswer') ?? ''),
  );
  if (!verdict.ok) {
    return reply({
      ok: false,
      error:
        verdict.reason === 'expired'
          ? '验证已过期，请重新作答后提交'
          : '验证答案不正确，请再试一次',
    });
  }

  const validation = validateComment({
    authorName: String(formData.get('authorName') ?? ''),
    authorEmail: String(formData.get('authorEmail') ?? ''),
    body: String(formData.get('body') ?? ''),
  });
  if (!validation.ok) return reply({ ok: false, error: validation.error });

  // Resolve the article by slug — the client sends a slug, never an id, so a
  // draft or a mirror can't be targeted by guessing a uuid.
  const [article] = await db
    .select({
      id: contentItems.id,
      status: contentItems.status,
      type: contentItems.type,
      commentsEnabled: contentItems.commentsEnabled,
      passwordMode: contentItems.passwordMode,
      passwordHash: contentItems.passwordHash,
    })
    .from(contentItems)
    .where(eq(contentItems.slug, slug))
    .limit(1);

  if (!article || article.type !== 'article' || article.status !== 'published') {
    return reply({ ok: false, error: '文章不存在或已下线' });
  }
  if (!article.commentsEnabled) {
    return reply({ ok: false, error: '这篇文章已关闭评论' });
  }

  // The form is only reachable from the article page, but the action is a POST
  // endpoint anyone can call with a slug — so the gate is re-checked here.
  const unlock = await checkUnlocked(article);
  if (unlock.required && !unlock.unlocked) {
    return reply({ ok: false, error: '请先输入访问密码' });
  }

  const ip = await extractVisitorIp();
  const ipHash = ip === 'unknown' ? null : hashIp(ip);

  const rateLimit = await checkRateLimit(ipHash);
  if (!rateLimit.ok) return reply({ ok: false, error: rateLimit.error });

  const headerList = await headers();
  const userAgent = headerList.get('user-agent')?.slice(0, 500) ?? null;

  try {
    await db.insert(articleComments).values({
      contentItemId: article.id,
      authorName: validation.value.authorName,
      authorEmail: validation.value.authorEmail,
      body: validation.value.body,
      status: 'visible',
      ipHash,
      userAgent,
    });
  } catch (err) {
    return reply({ ok: false, error: `提交失败：${(err as Error).message}` });
  }

  revalidatePath(`/p/${slug}`);
  revalidatePath('/post'); // the archive shows a per-article comment count
  return reply({ ok: true, submitted: true });
}

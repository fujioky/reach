'use client';

// app/p/_components/CommentForm.tsx
// Visitor comment form.
//
// Three things stand between this form and a spam flood, none of which asks the
// visitor to solve a puzzle they can't read: a honeypot field that only a bot
// fills, a signed arithmetic question, and a per-IP rate limit on the server.
//
// The fields are controlled rather than left to the DOM. React resets a form
// after its action resolves, which would throw away a written comment every
// time the arithmetic answer was wrong — the one moment the text is most
// annoying to lose. Holding the values in state means only a successful post
// clears them.

import { useActionState, useEffect, useState } from 'react';
import { submitArticleComment, type CommentFormState } from '../actions';
import type { Challenge } from '@/lib/article/captcha';
import { BODY_MAX_LENGTH, NAME_MAX_LENGTH } from '@/lib/article/comments';

export function CommentForm({
  slug,
  challenge,
}: {
  slug: string;
  challenge: Challenge;
}) {
  const [state, formAction, pending] = useActionState<CommentFormState, FormData>(
    submitArticleComment,
    { ok: false },
  );

  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [body, setBody] = useState('');
  const [answer, setAnswer] = useState('');

  const active = state.nextChallenge ?? challenge;

  // Every response carries a fresh question, so the previous answer is stale
  // whether the submission succeeded or failed.
  useEffect(() => {
    setAnswer('');
  }, [active.token]);

  // Only a successful post clears what the visitor wrote.
  useEffect(() => {
    if (state.submitted) {
      setAuthorName('');
      setAuthorEmail('');
      setBody('');
    }
  }, [state.submitted]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="challengeToken" value={active.token} />

      {/* Honeypot — off-screen and out of the tab order, invisible to humans. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          请勿填写此项
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted">
          昵称 <span className="text-danger">*</span>
          <input
            name="authorName"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            required
            maxLength={NAME_MAX_LENGTH}
            placeholder="怎么称呼你"
            className="ds-input mt-1.5"
          />
        </label>
        <label className="text-xs font-medium text-muted">
          邮箱（选填，不会公开）
          <input
            name="authorEmail"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            className="ds-input mt-1.5"
          />
        </label>
      </div>

      <label className="text-xs font-medium text-muted">
        评论内容 <span className="text-danger">*</span>
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          maxLength={BODY_MAX_LENGTH}
          placeholder="说点什么…"
          className="ds-input mt-1.5 resize-y leading-relaxed"
        />
      </label>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs font-medium text-muted">
          {active.question}
          <input
            name="challengeAnswer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            inputMode="numeric"
            autoComplete="off"
            placeholder="填数字"
            className="ds-input mt-1.5 w-32"
          />
        </label>

        <button type="submit" disabled={pending} className="ds-btn-primary disabled:opacity-60">
          {pending ? '提交中…' : '发表评论'}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state.submitted && !state.error && (
        <p role="status" className="text-[13px] text-success">
          评论已发表，感谢参与。
        </p>
      )}
    </form>
  );
}

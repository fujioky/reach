// app/s/[token]/layout.tsx
// Visitor-side layout — Reach 外壳包裹（D-71/D-72）。
//
// The session recorder lives here rather than in the page so one recording
// follows the reader across the share: opening a post from the thread
// (/s/<token>/x/<id>) and coming back keep the same session, and a replay
// shows the whole path. It only records once the visitor is past the gates
// the page enforces (human check, a viewable share, the password); the
// access check is read-only, so it never spends a view.

import { eq } from 'drizzle-orm';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { Recorder } from '@/app/_components/analytics/Recorder';
import { db, contentItems } from '@/lib/db';
import { checkShareMediaAccess } from '@/lib/access/share-media';
import { extractVisitorIp, getVisitorCookie } from '@/lib/access/visitor';
import { checkUnlocked } from '@/lib/content/password';
import { turnstileGateRequired } from '@/lib/turnstile';

async function recordingTarget(token: string) {
  if (await turnstileGateRequired()) return null;
  const visitorCookie = await getVisitorCookie();
  // Like the media endpoints: a burn-after-read share burned by this very
  // visit (the page renders in parallel) still records its one reader.
  const access = await checkShareMediaAccess(token, visitorCookie, await extractVisitorIp());
  if (!access.allowed) return null;
  const [item] = await db
    .select({ id: contentItems.id, passwordMode: contentItems.passwordMode, passwordHash: contentItems.passwordHash })
    .from(contentItems)
    .where(eq(contentItems.id, access.share.contentItemId))
    .limit(1);
  if (!item) return null;
  const unlock = await checkUnlocked(item);
  if (unlock.required && !unlock.unlocked) return null;
  return { contentItemId: item.id, shareId: access.share.id, visitorId: visitorCookie ?? 'anonymous' };
}

export default async function VisitorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const target = await recordingTarget((await params).token);
  const content = <div className="relative">{children}</div>;
  return (
    <div className="relative min-h-screen bg-paper font-sans text-ink">
      <PageBackground intensity="subtle" />
      {target ? <Recorder {...target}>{content}</Recorder> : content}
    </div>
  );
}

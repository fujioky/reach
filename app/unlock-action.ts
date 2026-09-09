// app/unlock-action.ts
// Server Action behind the password prompt, shared by articles and mirrors.
//
// The form sends what the visitor is trying to open (slug or share token), not
// the hash or mode — those are looked up here. A client that lies about the
// identifier just gets asked for that other item's password instead.

'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, contentItems, shares } from '@/lib/db';
import { attemptUnlock } from '@/lib/content/password';

export interface UnlockFormState {
  ok: boolean;
  error?: string;
}

/** Deliberately vague: never confirm that an item exists or is protected. */
const GENERIC_ERROR = '密码不正确';

export async function unlockContent(
  _prev: UnlockFormState,
  formData: FormData,
): Promise<UnlockFormState> {
  const kind = String(formData.get('kind') ?? '');
  const identifier = String(formData.get('identifier') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!identifier || !password) return { ok: false, error: GENERIC_ERROR };

  let item: { passwordMode: string | null; passwordHash: string | null } | undefined;

  if (kind === 'article') {
    [item] = await db
      .select({
        passwordMode: contentItems.passwordMode,
        passwordHash: contentItems.passwordHash,
      })
      .from(contentItems)
      .where(eq(contentItems.slug, identifier))
      .limit(1);
  } else if (kind === 'mirror') {
    // A mirror is addressed by share token; the gate lives on the content item.
    const [row] = await db
      .select({
        passwordMode: contentItems.passwordMode,
        passwordHash: contentItems.passwordHash,
      })
      .from(shares)
      .innerJoin(contentItems, eq(shares.contentItemId, contentItems.id))
      .where(eq(shares.token, identifier))
      .limit(1);
    item = row;
  }

  if (!item) return { ok: false, error: GENERIC_ERROR };

  const result = await attemptUnlock(item, password);
  if (!result.ok) return { ok: false, error: GENERIC_ERROR };

  // Re-render the page the visitor is on; the cookie is now set, so the gate
  // gives way to the content.
  revalidatePath(kind === 'article' ? `/p/${identifier}` : `/s/${identifier}`);
  return { ok: true };
}

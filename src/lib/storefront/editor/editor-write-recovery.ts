import { classifyAuthFailure } from "@/lib/auth/auth-failure";
import type { EditorWriteVerification } from "./editor-write-gate";

/**
 * Asks whether the account that opened this editor may write to it again.
 *
 * Three questions, in order, each able to stop the answer:
 *
 * 1. Is anyone signed in? A session read that fails is no answer at all, and
 *    says so, rather than guessing either way.
 * 2. Is it the same account? Unsaved work belongs to whoever made it; sent as
 *    someone else, it would be attributed to them and carry their permissions.
 * 3. May that account still edit this Theme? Read through the same guarded
 *    call the editor loads the Theme with, so the server decides — by the
 *    same rule its writes will be checked against — and a store or Theme that
 *    has gone meanwhile is caught here rather than by the first save.
 *
 * Nothing is sent. Passing all three only lets the author choose to save.
 */
export async function verifyEditorWriter({
  ownerUserId,
  readSession,
  readTheme,
}: {
  ownerUserId: string;
  readSession: () => Promise<{ user?: { id?: string } | null } | null>;
  readTheme: () => Promise<{ success: boolean }>;
}): Promise<EditorWriteVerification> {
  let session: Awaited<ReturnType<typeof readSession>>;
  try {
    session = await readSession();
  } catch {
    return "unanswered";
  }
  const userId = session?.user?.id;
  if (!userId) return "signed-out";
  if (userId !== ownerUserId) return "different-account";

  try {
    const theme = await readTheme();
    // A Theme the server will not hand back — gone, or no longer this
    // store's — is one this editor cannot save to.
    return theme.success ? "verified" : "access-denied";
  } catch (error) {
    const code = classifyAuthFailure(error);
    if (code === "AUTH_REQUIRED") return "signed-out";
    if (code === "ACCESS_DENIED") return "access-denied";
    return "unanswered";
  }
}

/**
 * The template a pending content key belongs to.
 *
 * Keys are `${templateId}:${sectionId}`, and a template id can itself contain
 * a colon (`route-template:/about`), so the id is what is left once the
 * entry's own section id is taken off the end — never a split on ":".
 */
export function templateIdOfPendingContentKey(
  key: string,
  sectionId: string,
): string | null {
  const suffix = `:${sectionId}`;
  if (!key.endsWith(suffix) || key.length === suffix.length) return null;
  return key.slice(0, key.length - suffix.length);
}

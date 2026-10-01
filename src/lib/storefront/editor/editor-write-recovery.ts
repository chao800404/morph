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
    if (code === "ACCOUNT_CHANGED") return "different-account";
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

/**
 * Settles one file held while writes were paused, once the author confirms.
 *
 * The server is asked what it holds first, because a save whose answer was
 * lost may have landed. Two rules about the draft, which can change while
 * that question is out:
 *
 * - Only the content that matched is recorded as saved. `markLanded` is
 *   expected to keep anything newer unsaved (the workspace's `markSaved`
 *   compares against the content it holds at that moment).
 * - What is sent is the draft as it is when sending, read after the answer —
 *   never the copy read before it.
 *
 * A file in a version conflict is left to the conflict's own resolution.
 *
 * A server that cannot be asked is no answer: nothing is sent, and the file
 * stays held ("unanswered"), rather than sending on a guess.
 */
export async function settleHeldFile<TLatest extends { content: string }>({
  readDraft,
  readLatest,
  markLanded,
  save,
}: {
  readDraft: () => { localContent: string; conflict?: unknown } | undefined;
  readLatest: () => Promise<TLatest | null>;
  markLanded: (latest: TLatest) => void;
  save: (content: string) => Promise<unknown>;
}): Promise<"landed" | "sent" | "skipped" | "unanswered"> {
  const asked = readDraft();
  if (!asked || asked.conflict) return "skipped";
  // The value, not the object: the draft may change while the server answers.
  const askedContent = asked.localContent;
  let latest: TLatest | null;
  try {
    latest = await readLatest();
  } catch {
    return "unanswered";
  }
  if (latest && latest.content === askedContent) {
    markLanded(latest);
    return "landed";
  }
  const now = readDraft();
  if (!now || now.conflict) return "skipped";
  await save(now.localContent);
  return "sent";
}

/**
 * Whether a save refused earlier (see `EditorWriteRefusedEarlier`) still
 * describes the file: the edit it carried is unsaved, and nothing has been
 * saved over the version it was sent against.
 *
 * A save of the file that landed since — or the edit discarded — is newer
 * than this refusal, and is not undone by it.
 */
export function earlierRefusalStillApplies(
  sentAgainst: { serverFileId: string | null; serverVersion: number | null },
  now:
    | {
        serverFileId: string | null;
        serverVersion: number | null;
        dirty: boolean;
      }
    | undefined,
): boolean {
  return Boolean(
    now &&
    now.dirty &&
    now.serverFileId === sentAgainst.serverFileId &&
    now.serverVersion === sentAgainst.serverVersion,
  );
}

/**
 * Finds out whether a save that was sent and never answered landed.
 *
 * A dropped connection or a cut-off answer says nothing about the write: the
 * server may have made it. The version precondition would stop a resend from
 * overwriting someone else, but cannot say whether the first one landed, so
 * the server is asked what it holds before anything is sent again.
 *
 * - The server holds exactly the content that was sent: it landed, and that
 *   version is recorded (`markLanded`) so the next save is made against it.
 * - It holds something else, or no file: either it did not land, or someone
 *   saved over it since. Both are left to the ordinary save, whose version
 *   check turns the second into a conflict rather than an overwrite.
 * - The server cannot be asked: this throws, and nothing is decided.
 *
 * `readLatest` resolves `null` only when the server says there is no such
 * file, and throws when it gave no answer.
 */
export async function confirmLostSave<TLatest extends { content: string }>({
  unconfirmedContent,
  readLatest,
  markLanded,
}: {
  unconfirmedContent: string;
  readLatest: () => Promise<TLatest | null>;
  markLanded: (latest: TLatest) => void;
}): Promise<"landed" | "not-landed"> {
  const latest = await readLatest();
  if (latest && latest.content === unconfirmedContent) {
    markLanded(latest);
    return "landed";
  }
  return "not-landed";
}

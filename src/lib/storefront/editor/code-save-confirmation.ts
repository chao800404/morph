/**
 * What a Code save's answer is allowed to say about the editor's buffer.
 *
 * A save sends the buffer as it was at that moment. The author keeps typing,
 * undoing and redoing while it is out, so by the time the answer arrives the
 * buffer may hold something else. The answer confirms the text that was sent
 * — it becomes the new server baseline — and nothing the author did after.
 *
 * Getting this wrong once looked like this: the author pressed Enter, the
 * autosave sent that, the author pressed Ctrl+Z back to the old baseline, and
 * the answer arrived. The buffer equalled the *old* baseline, so it looked
 * clean, and the editor replaced it with the server's copy: the undo was
 * reverted, Monaco's undo stack was wiped, and the server kept the text the
 * author had undone.
 *
 * A save that got no answer at all is confirmed the same way, only later:
 * when a reload of the file list or `confirmLostSave` finds the server holds
 * it. Until then it stays tracked (`lost`), so that confirmation, too, covers
 * that write and nothing typed, undone or redone after it.
 *
 * Kept free of React and Monaco so these rules can be stated as tests.
 */

/** A write the Code workspace has sent and not yet heard back about. */
export type SentCodeWrite = { readonly path: string; readonly content: string };

/**
 * The writes still awaiting their answer, so a change to the server baseline
 * can be recognised as one of them being confirmed rather than as a change
 * made elsewhere.
 *
 * Entries are identities, not values: two writes of the same text are two
 * entries, and answering one leaves the other awaiting.
 */
export type SentCodeWrites = {
  sent: (write: SentCodeWrite) => void;
  answered: (write: SentCodeWrite) => void;
  /** Whether a write of exactly `content` to `path` is still awaiting its answer. */
  awaitsAnswer: (path: string, content: string) => boolean;
  /**
   * The write got no answer at all, and the workspace store now holds it as
   * unconfirmed (`unconfirmedContent`). Its outcome is found out later — by a
   * reload of the file list or by `confirmLostSave` before the next save — so
   * it stays tracked until then.
   */
  lost: (write: SentCodeWrite) => void;
  /**
   * Removes and returns the lost writes whose outcome is now known: those the
   * store no longer holds as unconfirmed. Called on every store change, so it
   * runs as the store changes and before the editor renders on it.
   */
  settleLost: (
    stillUnconfirmed: (write: SentCodeWrite) => boolean,
  ) => SentCodeWrite[];
};

export function createSentCodeWrites(): SentCodeWrites {
  const awaiting = new Set<SentCodeWrite>();
  const lost = new Set<SentCodeWrite>();
  return {
    sent: (write) => {
      awaiting.add(write);
    },
    answered: (write) => {
      awaiting.delete(write);
    },
    lost: (write) => {
      awaiting.delete(write);
      lost.add(write);
    },
    settleLost: (stillUnconfirmed) => {
      const settled: SentCodeWrite[] = [];
      for (const write of lost) {
        if (stillUnconfirmed(write)) continue;
        lost.delete(write);
        settled.push(write);
      }
      return settled;
    },
    awaitsAnswer: (path, content) => {
      for (const write of awaiting) {
        if (write.path === path && write.content === content) return true;
      }
      return false;
    },
  };
}

/**
 * The buffer's state once the server has confirmed a write of `sent`, landing
 * as `saved`.
 *
 * - `untouched`: the workspace holds no buffer for the file; nothing to decide.
 * - `clean`: the buffer still shows exactly what was sent, so the server holds
 *   what is shown. However many edits came in between — an undo and a redo
 *   back to the sent text — there is nothing left to save.
 * - `dirty`: the buffer moved on after the write was sent. Those edits stand,
 *   and they are unsaved against the new baseline unless they happen to
 *   arrive back at exactly what the server now holds.
 */
export function draftAfterConfirmedWrite(args: {
  sent: string;
  saved: string;
  draft: string | undefined;
}): "untouched" | "clean" | "dirty" {
  if (args.draft === undefined) return "untouched";
  if (args.draft === args.sent || args.draft === args.saved) return "clean";
  return "dirty";
}

/**
 * The buffer's state once a lost write's outcome is known (see `settleLost`).
 *
 * Found to have landed — the server baseline is now its content — it is
 * confirmed like any answered write, and confirms nothing the author did
 * after it was sent. Not landed, or saved over since, it says nothing about
 * the buffer: the save that moved the baseline, or the conflict, decides.
 */
export function draftAfterLostWriteSettled(args: {
  lost: string;
  serverContent: string | undefined;
  draft: string | undefined;
}): "untouched" | "clean" | "dirty" {
  if (args.serverContent !== args.lost) return "untouched";
  return draftAfterConfirmedWrite({
    sent: args.lost,
    saved: args.serverContent,
    draft: args.draft,
  });
}

/**
 * Whether a change of the server baseline may replace the buffer shown.
 *
 * It may only when the author has nothing of their own in the buffer: no
 * unsaved edit, and the change is not the answer to one of the workspace's
 * own writes. That answer confirms the write it belongs to; if the buffer no
 * longer shows that write, the difference is the author's later edit, and it
 * stays — as an unsaved draft against the new baseline.
 */
export function syncBufferToServer(args: {
  serverContent: string;
  buffer: string;
  draftDirty: boolean;
  ownWriteAwaitingAnswer: boolean;
}): "in-sync" | "keep-draft" | "keep-later-edits" | "replace" {
  if (args.buffer === args.serverContent) return "in-sync";
  if (args.draftDirty) return "keep-draft";
  if (args.ownWriteAwaitingAnswer) return "keep-later-edits";
  return "replace";
}

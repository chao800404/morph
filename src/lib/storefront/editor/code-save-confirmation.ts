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
 * Kept free of React and Monaco so both rules can be stated as tests.
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
};

export function createSentCodeWrites(): SentCodeWrites {
  const awaiting = new Set<SentCodeWrite>();
  return {
    sent: (write) => {
      awaiting.add(write);
    },
    answered: (write) => {
      awaiting.delete(write);
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

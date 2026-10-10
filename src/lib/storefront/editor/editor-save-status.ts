/**
 * Whether the author's edits are stored, kept apart from whether the stored
 * Theme is published.
 *
 * The toolbar used to show one word for both, and "Unpublished" was what it
 * showed while an edit was still waiting out its debounce: nothing had been
 * sent, yet the word that stood there is the one that follows a save. An
 * author who read it and left lost the edit. So the save state is decided
 * first, from what is actually pending, and the publish state is only shown
 * once nothing is.
 *
 * Every input is a fact about what is held now — a timer still waiting, a
 * request still out, a draft still unsent — never "a response arrived". A
 * response to an older write proves nothing about a newer one, so it cannot
 * make this answer "saved" while the newer one is held.
 */
export type EditorSaveState =
  | "saved"
  /** Changed here and not sent yet: waiting out a debounce, held, or a draft. */
  | "unsaved"
  /** Sent, and not yet answered. */
  | "saving"
  /** Refused because the document moved; the edit is kept for a rebase. */
  | "out-of-date"
  | "failed";

export function resolveEditorSaveState(facts: {
  saving: boolean;
  outOfDate: boolean;
  failed: boolean;
  unsaved: boolean;
}): EditorSaveState {
  if (facts.saving) return "saving";
  if (facts.outOfDate) return "out-of-date";
  if (facts.failed) return "failed";
  if (facts.unsaved) return "unsaved";
  return "saved";
}

/** The toolbar's one word: the save state, or the publish state once saved. */
export function editorSaveStatusLabel(args: {
  publishing: boolean;
  saveState: EditorSaveState;
  /** The first source save error, shown after "Save failed". */
  failure?: string;
  hasUnpublishedChanges: boolean;
}): string {
  if (args.publishing) return "Publishing…";
  switch (args.saveState) {
    case "saving":
      return "Saving…";
    case "out-of-date":
      // Not "Save failed": the author's edit is intact, and the word next to
      // it says what happened to it.
      return "Out of date";
    case "failed":
      return args.failure
        ? `Save failed: ${args.failure.slice(0, 30)}…`
        : "Save failed";
    case "unsaved":
      return "Unsaved";
    case "saved":
      // One word each, and the same word stem, so the two states read as a
      // pair the eye can tell apart at a glance.
      return args.hasUnpublishedChanges ? "Unpublished" : "Published";
  }
}

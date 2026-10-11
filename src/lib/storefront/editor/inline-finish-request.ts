/**
 * Which inline commit is the answer to the editor asking the preview to
 * finish an open edit.
 *
 * A navigation waiting on the author is cancelled by any new input, because
 * input means the author is still here. One commit is not that: the one the
 * author asked for by choosing "finish editing" — its text is what the
 * navigation is about to save. Exactly that one is let through, and the
 * decision is the editor's alone. The preview echoes the request's id, but
 * the id only says which request a commit claims to answer; whether it does
 * is checked against what the editor recorded when it asked:
 *
 * - the same preview document (a replaced frame's edit went with it),
 * - the same field the author was editing,
 * - a request still open, answered once — a repeat or a late arrival is
 *   ordinary input again.
 *
 * Kept free of React so each of those can be stated as a test.
 */

export type InlineFinishRequest = Readonly<{
  id: number;
  /** The preview document the edit was open in. */
  previewKey: string;
  sectionId: string;
  fieldKey: string;
  fieldPath: string;
}>;

export function isRequestedInlineFinishCommit(
  request: InlineFinishRequest | null,
  commit: Readonly<{
    sectionId: string;
    fieldKey: string;
    fieldPath: string;
    finishRequestId?: number;
  }>,
  currentPreviewKey: string | null,
): boolean {
  return (
    request !== null &&
    commit.finishRequestId === request.id &&
    currentPreviewKey === request.previewKey &&
    commit.sectionId === request.sectionId &&
    commit.fieldKey === request.fieldKey &&
    commit.fieldPath === request.fieldPath
  );
}

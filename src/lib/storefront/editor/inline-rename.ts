export type InlineRenameOutcome =
  /** Already decided by an earlier Enter or Escape; do nothing. */
  | { action: "ignore" }
  /** Close the field without writing: nothing changed, or it was abandoned. */
  | { action: "close" }
  | { action: "save"; note: string };

/**
 * What leaving or confirming an inline rename should do.
 *
 * Extracted because the three ways an edit ends are easy to get subtly wrong
 * and hard to see: closing the field also blurs it, so Enter and Escape are
 * each followed by a second handler run, and without a guard that run commits a
 * value the person rejected or sends the same rename twice.
 */
export function resolveInlineRename(input: {
  /** An earlier Enter or Escape already decided this edit. */
  settled: boolean;
  /** What is currently in the field. */
  draft: string;
  /** What the record holds now, if anything. */
  current: string | null;
}): InlineRenameOutcome {
  if (input.settled) return { action: "ignore" };

  const note = input.draft.trim();
  // An unchanged value is not an edit. Writing it would spend a request and a
  // toast to record that nothing happened.
  if (note === (input.current ?? "")) return { action: "close" };

  return { action: "save", note };
}

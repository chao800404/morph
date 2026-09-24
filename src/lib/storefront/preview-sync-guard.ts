/**
 * Refusing preview writes made from an out-of-date copy of a file.
 *
 * Every tab an author has open on a Theme writes into the same preview
 * container, and each tab writes from its own copy of the files. A tab that
 * last loaded a file before another tab saved a newer version still holds the
 * old one, and writing it rewound the preview for every tab — while the
 * database, guarded by its own compare-and-set, kept the newer version. So a
 * preview write now names the saved version each file was edited from, and a
 * file that would replace what is saved with something edited from an older
 * version is not written.
 *
 * This compares against the database when the request is checked. It does not
 * order two writes that pass the check at the same time: a request checked
 * before a newer save lands can still write after it. Closing that needs the
 * preview's writes to be serialised or fenced, which this does not do.
 */

export type PreviewSyncFile = Readonly<{
  path: string;
  content: string;
  /**
   * The saved version this copy was edited from, or `null` for a file that
   * this tab has never seen saved.
   */
  baseVersion: number | null;
}>;

export type SavedThemeFile = Readonly<{ version: number; content: string }>;

/** The files whose write would rewind what is saved. */
export function stalePreviewSyncPaths(
  files: readonly PreviewSyncFile[],
  saved: ReadonlyMap<string, SavedThemeFile>,
): string[] {
  const stale: string[] = [];
  for (const file of files) {
    const current = saved.get(file.path);
    if (!current) {
      // Deleted since this copy was loaded, if it was ever saved at all.
      if (file.baseVersion !== null) stale.push(file.path);
      continue;
    }
    // Writing what is saved rewinds nothing, whatever this copy was based on:
    // a tab putting back its own failed edit, or taking the version another
    // tab won with, is catching up rather than going back.
    if (file.content === current.content) continue;
    // Anything else must be an edit of the saved version, not of one before it.
    if (file.baseVersion === null || file.baseVersion < current.version) {
      stale.push(file.path);
    }
  }
  return stale;
}

export type ThemeSourceDiff =
  | { changed: false }
  | {
      changed: true;
      /** Why, in the words the toolbar can show without more lookup. */
      reason: "never-published" | "added" | "removed" | "modified";
      path?: string;
    };

type ComparableFile = { path: string; content: string };

/**
 * Whether the working theme source differs from what was last published.
 *
 * Returns the reason rather than a boolean because this decides whether Publish
 * is enabled, and "Publish is lit but I changed nothing" is unfalsifiable from
 * the outside — there is no way to ask the editor which file it thinks differs.
 *
 * A theme with no published snapshot has never shipped, so everything it holds
 * is unpublished. That is a property of the snapshot, not of the files: the
 * previous test asked whether any file had `version > 1`, which is "was ever
 * edited" and never becomes false again — so once a snapshot was unavailable,
 * Publish stayed enabled forever. It was also wrong the other way: a theme that
 * had never been published but whose files were all still at version 1 reported
 * no changes, which disabled Publish on a store that had never gone live.
 */
export function describeThemeSourceChanges(
  files: readonly ComparableFile[],
  publishedSnapshot: ReadonlyMap<string, string> | null,
): ThemeSourceDiff {
  if (!publishedSnapshot) {
    return files.length > 0
      ? { changed: true, reason: "never-published" }
      : { changed: false };
  }

  for (const file of files) {
    const published = publishedSnapshot.get(file.path);
    if (published === undefined) {
      return { changed: true, reason: "added", path: file.path };
    }
    if (published !== file.content) {
      return { changed: true, reason: "modified", path: file.path };
    }
  }

  // Checked by name rather than by count: equal counts with one file renamed
  // would otherwise compare as unchanged.
  if (files.length !== publishedSnapshot.size) {
    const present = new Set(files.map((file) => file.path));
    for (const path of publishedSnapshot.keys()) {
      if (!present.has(path)) {
        return { changed: true, reason: "removed", path };
      }
    }
  }

  return { changed: false };
}

/** One line naming what Publish would ship, for a tooltip or a log. */
export function describeUnpublishedChanges(
  diff: ThemeSourceDiff,
  hasTemplateChanges: boolean,
): string {
  if (hasTemplateChanges && !diff.changed) return "Page content edited";
  if (!diff.changed) return "Nothing to publish";

  switch (diff.reason) {
    case "never-published":
      return "This theme has never been published";
    case "added":
      return `Added ${diff.path}`;
    case "removed":
      return `Removed ${diff.path}`;
    case "modified":
      return `Edited ${diff.path}`;
  }
}

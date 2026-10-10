export type ThemeSourceDiff =
  | { changed: false }
  | {
      changed: true;
      /** Why, in the words the toolbar can show without more lookup. */
      reason: "never-published" | "added" | "removed" | "modified";
      path?: string;
    };

import type { ThemeRevisionFile } from "@/lib/storefront/dto/storefront-theme-file.dto";

/**
 * A working file as it compares: source by its text, a binary file by the
 * digest of its bytes — which is what a revision records for one.
 */
export type ComparableFile =
  | Readonly<{ path: string; content: string }>
  | Readonly<{ path: string; digest: string }>;

/** What the last published revision held at a path. */
export type PublishedFileState =
  | Readonly<{ kind: "text"; content: string }>
  | Readonly<{ kind: "binary"; digest: string }>;

/**
 * The published revision's files, by path, as they compare.
 *
 * An empty snapshot is not a published theme with no files — a theme with no
 * files cannot be published at all. It means the contents were not resolved,
 * and comparing against it would make every file look newly added, so it
 * reads as no snapshot.
 */
export function publishedFileStates(
  snapshot: readonly ThemeRevisionFile[] | null | undefined,
): Map<string, PublishedFileState> | null {
  if (!snapshot?.length) return null;
  const states = new Map<string, PublishedFileState>();
  for (const item of snapshot) {
    states.set(
      item.path,
      item.encoding === "binary"
        ? { kind: "binary", digest: item.blobDigest }
        : { kind: "text", content: item.content },
    );
  }
  return states;
}

function sameAsPublished(
  file: ComparableFile,
  published: PublishedFileState,
): boolean {
  // A path that changed kind — source replaced by an image, or the reverse —
  // is a change, whatever the values.
  return "digest" in file
    ? published.kind === "binary" && published.digest === file.digest
    : published.kind === "text" && published.content === file.content;
}

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
  publishedSnapshot: ReadonlyMap<string, PublishedFileState> | null,
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
    if (!sameAsPublished(file, published)) {
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

/** A template's draft and published revisions, as the editor context has them. */
export type TemplatePublishState = Readonly<{
  id: string;
  draftRevisionId?: string | null;
  publishedRevisionId?: string | null;
}>;

export type ContentPublishDiff =
  { changed: false } | { changed: true; reason: "page" | "layout" };

function hasUnpublishedDraft(template: TemplatePublishState): boolean {
  return Boolean(
    template.draftRevisionId &&
    template.draftRevisionId !== template.publishedRevisionId,
  );
}

/**
 * Whether a publish from this page would seal content that is not live.
 *
 * The same scope `publishTemplate` seals: the page being published, and the
 * shared layout's draft, which has no URL of its own and so travels with
 * whatever page is published (`pendingShell`, by the same comparison). Other
 * pages' drafts are not in it — they keep their published revisions and are
 * published from their own page — so they do not count here; lighting Publish
 * for them would ship nothing of theirs.
 *
 * Only the layout used to be missing: a Header or Footer edit saved a layout
 * draft that this page's Publish never offered to ship, so the toolbar said
 * "Published" over an edit the storefront did not have.
 */
export function describeContentChanges(scope: {
  page: TemplatePublishState | null | undefined;
  layout: TemplatePublishState | null | undefined;
}): ContentPublishDiff {
  if (scope.page && hasUnpublishedDraft(scope.page)) {
    return { changed: true, reason: "page" };
  }
  if (
    scope.layout &&
    scope.layout.id !== scope.page?.id &&
    hasUnpublishedDraft(scope.layout)
  ) {
    return { changed: true, reason: "layout" };
  }
  return { changed: false };
}

/** One line naming what Publish would ship, for a tooltip or a log. */
export function describeUnpublishedChanges(
  diff: ThemeSourceDiff,
  content: ContentPublishDiff,
): string {
  if (content.changed && !diff.changed) {
    return content.reason === "layout"
      ? "Shared layout edited"
      : "Page content edited";
  }
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

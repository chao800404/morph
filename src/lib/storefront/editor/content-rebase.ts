/**
 * Rebasing a content edit onto newer server state, as a rule rather than a hook.
 *
 * Two places need the same answer to "which keys are the author's, and which
 * belong to the server now?" The Inspector needs it whenever a refetch lands
 * while someone is typing. The shell's content write path needs it when a save
 * comes back as an OCC conflict: the author's edit is still valid, but the
 * document it was written against has moved, so what gets re-sent has to carry
 * whatever the other writer changed. Re-sending the stale snapshot instead — or
 * simply reloading — either overwrites them or throws the author's work away.
 *
 * The rule is one line of intent: a key whose local value differs from the
 * baseline is the author's, and every other key takes the server's value. Kept
 * here so both callers share it rather than each growing its own copy.
 */

export type ContentProps = Record<string, unknown>;

/**
 * Compare stored content structurally.
 *
 * Refetched JSON objects are new references even when their contents did not
 * change. Structural comparison is what lets a rebase treat a refetch as the
 * server's value rather than mistaking every one of them for a local edit.
 */
export function sameContentValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => sameContentValue(item, b[index]))
    );
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      sameContentValue(aRecord[key], bRecord[key]),
  );
}

/**
 * The props to hold after the server answers with `incoming`.
 *
 * `baseline` is the server state the local edits were made against, so it is
 * what says which of them are edits at all. Keys the server has since dropped
 * are dropped too, unless the author changed them — an author's value outlives
 * a server key only because they are actively asserting it.
 */
/**
 * Lists that both the author and the other writer changed since the edit's
 * baseline, to different results.
 *
 * `rebaseContentProps` lets the author's value of a key win. For one value
 * that is the choice "keep mine" names. For a list it is not: the author's
 * copy is the whole array as their panel last drew it, and writing it would
 * remove the rows the other writer added, undo their reorder, and put the
 * author's row edits back at indexes that may now hold other rows. There is no
 * safe automatic answer, so such a list is reported and nothing is sent.
 */
export function conflictingListKeys({
  incoming,
  baseline,
  local,
}: {
  incoming: ContentProps;
  baseline: ContentProps;
  local: ContentProps;
}): string[] {
  return Object.keys(local).filter(
    (key) =>
      [local[key], incoming[key], baseline[key]].some(Array.isArray) &&
      !sameContentValue(local[key], baseline[key]) &&
      !sameContentValue(incoming[key], baseline[key]) &&
      !sameContentValue(local[key], incoming[key]),
  );
}

/**
 * What to tell an author whose content is held by a conflict, before
 * something that needs it saved (publishing, building, leaving) can go on.
 *
 * One answer for every place that asks. A list both sides changed is not
 * saved by "Load latest, keep mine" — that is the point of stopping it — so
 * pointing the author at that button would send them round in a circle. The
 * editor knows which way out each held list has (the user's rule, Task 41
 * 31-B): the list's own discard control beside it in the Content panel, or,
 * where there is none, "Discard mine…" for its whole section. The message
 * names the one that applies, and what it discards.
 */
export function heldContentMessage({
  hasListConflict,
  listExits = { pathScoped: true, generic: false },
}: {
  /** A section held because a list in it was changed on both sides. */
  hasListConflict: boolean;
  /**
   * Which ways out the held lists have: a list-only discard beside the list
   * (`pathScoped`), and/or "Discard mine…" for a section whose list has none.
   */
  listExits?: Readonly<{
    pathScoped: boolean;
    generic: boolean;
    /** A held list is on another page, and is discarded from there (R3-1). */
    otherPage?: boolean;
  }>;
}): string {
  if (!hasListConflict) {
    return "Content is out of date with the document. Load the latest version and keep your changes before continuing.";
  }
  const lead =
    "A list you edited was also changed elsewhere, so your version cannot be saved over it. Your changes are kept.";
  const elsewhere = listExits.otherPage
    ? listExits.pathScoped || listExits.generic
      ? " A list on another page is held too: open that page to discard it there."
      : " That list is on another page. Open that page to discard your changes to it there."
    : "";
  if (listExits.generic && listExits.pathScoped) {
    return `${lead} Select its section and use Discard unsaved changes beside the list in the Content panel to discard only your changes to that list, or use Discard mine… in the toolbar for a section whose list has no such control; it discards all of your unsaved changes to that section and loads the latest version.${elsewhere}`;
  }
  if (listExits.generic) {
    return `${lead} Use Discard mine… in the toolbar; it discards all of your unsaved changes to that section and loads the latest version.${elsewhere}`;
  }
  if (!listExits.pathScoped && listExits.otherPage) return `${lead}${elsewhere}`;
  return `${lead} Select its section and use Discard unsaved changes beside the list in the Content panel; it discards only your changes to that list and loads its latest version.${elsewhere}`;
}

/** Content held after its save failed: the author tries again. */
export const HELD_FAILED_CONTENT_MESSAGE =
  "Content changed while saving. Retry before continuing.";

/**
 * Why a step that saves one document's content first (publish, build, a
 * structural edit) stopped, read from that document's own held entries
 * only. Another document's conflict says nothing about this one: a plain
 * failure here is still told as one, and only a conflict on one of these
 * entries (a list one included) points at the conflict's way out.
 */
export function heldFlushMessage({
  heldKeys,
  conflicts,
  listConflicts,
  genericListConflictKeys = [],
  otherPageListConflictKeys = [],
}: {
  /** The keys of this document's content still held after the flush. */
  heldKeys: readonly string[];
  conflicts: Readonly<Record<string, unknown>>;
  listConflicts: Readonly<Record<string, unknown>>;
  /** List conflicts with no list-only discard: "Discard mine…" is theirs. */
  genericListConflictKeys?: readonly string[];
  /** List conflicts of another page, discarded from that page. */
  otherPageListConflictKeys?: readonly string[];
}): string {
  const refused = heldKeys.filter(
    (key) => key in conflicts || key in listConflicts,
  );
  if (refused.length === 0) return HELD_FAILED_CONTENT_MESSAGE;
  const heldLists = refused.filter((key) => key in listConflicts);
  return heldContentMessage({
    hasListConflict: heldLists.length > 0,
    listExits: {
      pathScoped: heldLists.some(
        (key) =>
          !genericListConflictKeys.includes(key) &&
          !otherPageListConflictKeys.includes(key),
      ),
      generic: heldLists.some((key) => genericListConflictKeys.includes(key)),
      otherPage: heldLists.some((key) =>
        otherPageListConflictKeys.includes(key),
      ),
    },
  });
}

export function rebaseContentProps({
  incoming,
  baseline,
  local,
}: {
  /** Server props as they are now. */
  incoming: ContentProps;
  /** Server props the local edits were made against. */
  baseline: ContentProps;
  /** Props as the author currently holds them. */
  local: ContentProps;
}): ContentProps {
  const rebased: ContentProps = { ...incoming };
  for (const key of Object.keys(local)) {
    if (!sameContentValue(local[key], baseline[key])) {
      rebased[key] = local[key];
    }
  }
  return rebased;
}

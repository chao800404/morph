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

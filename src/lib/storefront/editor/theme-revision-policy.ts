/**
 * When a workspace mutation is worth recording as a source revision.
 *
 * History is what makes a deletion survivable, so the decision cannot be left
 * to whichever client happens to be writing: a caller that never asks for a
 * revision would produce a workspace with no way back, and that is exactly the
 * state a theme reaches by being edited normally.
 *
 * The two kinds of mutation want opposite answers. A deletion is the one act
 * with nothing left behind to reconstruct from, so it is always recorded. A
 * save happens on every keystroke burst, so recording each one would bury the
 * useful points in thousands of identical ones — it is throttled instead, and
 * the throttle is a floor on time rather than a count so a long editing
 * session leaves a readable trail rather than an exhaustive one.
 */
export type ThemeRevisionReason =
  /** A file's content was written. */
  | "save"
  /** A file or folder was removed. */
  | "delete"
  /** The caller stated it wants this recorded — a rename, a copy, an upgrade. */
  | "explicit";

/**
 * How quiet the history has to be before another save is recorded.
 *
 * Half a minute is short enough that little work is ever at risk and long
 * enough that a session of continuous typing produces a list a person can
 * read. It is deliberately not tied to the debounce the editor already
 * applies to saves: that one exists to reduce writes, this one to keep the
 * history legible, and letting one imply the other would mean a client could
 * change what history gets kept by changing how often it saves.
 */
export const THEME_REVISION_MIN_INTERVAL_MS = 30_000;

export function shouldRecordThemeRevision(args: {
  reason: ThemeRevisionReason;
  /** Now, in epoch milliseconds. */
  now: number;
  /** When the newest revision was taken, or null when there is none. */
  lastRevisionAt: number | null;
  minIntervalMs?: number;
}): boolean {
  if (args.reason === "delete" || args.reason === "explicit") return true;
  if (args.lastRevisionAt === null) return true;
  const interval = args.minIntervalMs ?? THEME_REVISION_MIN_INTERVAL_MS;
  // A clock that appears to run backwards — a differing server clock, a
  // revision written a moment ahead — is treated as "recently recorded"
  // rather than as licence to record on every save.
  if (args.lastRevisionAt > args.now) return false;
  return args.now - args.lastRevisionAt >= interval;
}

/** Parses a stored timestamp into epoch milliseconds, or null. */
export function parseRevisionTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
